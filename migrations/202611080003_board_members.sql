-- Compartilhamento privado: revisao e testes obrigatorios antes de aplicar.
-- Esta etapa nao habilita links publicos nem envio de anexos por editores.
begin;

create table public.entrelinhas_board_members (
  board_id uuid not null references public.entrelinhas_sync_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  permission text not null check (permission in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table public.entrelinhas_board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.entrelinhas_sync_boards(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1),
  permission text not null check (permission in ('editor', 'viewer')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  declined_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.entrelinhas_board_members enable row level security;
alter table public.entrelinhas_board_invitations enable row level security;
revoke all on public.entrelinhas_board_members from public, anon, authenticated;
revoke all on public.entrelinhas_board_invitations from public, anon, authenticated;

-- A consulta ignora RLS apenas dentro da funcao e sempre usa a sessao atual.
create function public.entrelinhas_board_access(p_board_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when b.owner_id = auth.uid() then 'owner'
    when b.document->'deleted' = 'true'::jsonb then null
    else (select m.permission from public.entrelinhas_board_members m
          where m.board_id = b.id and m.user_id = auth.uid())
  end
  from public.entrelinhas_sync_boards b
  where b.id = p_board_id and auth.uid() is not null;
$$;
revoke all on function public.entrelinhas_board_access(uuid) from public, anon, authenticated;
grant execute on function public.entrelinhas_board_access(uuid) to authenticated;

create policy "sync_boards_member_read"
  on public.entrelinhas_sync_boards for select to authenticated
  using (public.entrelinhas_board_access(id) in ('editor', 'viewer'));

create function public.entrelinhas_member_can_read_file(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.entrelinhas_sync_boards b
    join public.entrelinhas_board_members m on m.board_id = b.id and m.user_id = auth.uid()
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(b.document->'files') = 'array'
           then b.document->'files' else '[]'::jsonb end
    ) f
    where b.document->'deleted' is distinct from 'true'::jsonb
      and f->>'path' = p_path
      and p_path ~ ('^' || b.owner_id::text || '/[0-9a-f]{64}$')
  );
$$;
revoke all on function public.entrelinhas_member_can_read_file(text) from public, anon, authenticated;
grant execute on function public.entrelinhas_member_can_read_file(text) to authenticated;

create policy "sync_objects_member_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'entrelinhas-sync-private' and public.entrelinhas_member_can_read_file(name));

create function public.entrelinhas_invite_member(p_board_id uuid, p_email text, p_permission text, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  result uuid;
  normalized text := lower(btrim(p_email));
begin
  perform 1 from public.entrelinhas_sync_boards where id = p_board_id for update;
  if public.entrelinhas_board_access(p_board_id) is distinct from 'owner' then
    raise exception 'Somente o proprietario pode convidar' using errcode = '42501';
  end if;
  if exists (select 1 from public.entrelinhas_sync_boards b
             where b.id = p_board_id and b.document->'deleted' = 'true'::jsonb) then
    raise exception 'Quadro excluido' using errcode = '22023';
  end if;
  if normalized is null or length(normalized) not between 3 and 320 or position('@' in normalized) <= 1
     or p_permission is null or p_permission not in ('editor', 'viewer')
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'Convite invalido' using errcode = '22023';
  end if;
  insert into public.entrelinhas_board_invitations (board_id, email, permission, expires_at)
  values (p_board_id, normalized, p_permission, p_expires_at) returning id into result;
  return result;
end;
$$;

create function public.entrelinhas_accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  invite public.entrelinhas_board_invitations;
  target_board uuid;
  verified_email text;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Autenticacao necessaria' using errcode = '42501';
  end if;
  select lower(btrim(u.email)) into verified_email
  from auth.users u where u.id = current_user_id and u.email_confirmed_at is not null;
  select board_id into target_board from public.entrelinhas_board_invitations where id = p_invitation_id;
  perform 1 from public.entrelinhas_sync_boards where id = target_board for update;
  select * into invite from public.entrelinhas_board_invitations where id = p_invitation_id for update;
  if not found or verified_email is null or invite.email <> verified_email or
     invite.revoked_at is not null or invite.accepted_at is not null or invite.declined_at is not null
     or invite.expires_at <= now()
     or not exists (select 1 from public.entrelinhas_sync_boards b where b.id = invite.board_id
                    and b.document->'deleted' is distinct from 'true'::jsonb) then
    raise exception 'Convite indisponivel para esta conta' using errcode = '42501';
  end if;
  if exists (select 1 from public.entrelinhas_sync_boards b
             where b.id = invite.board_id and b.owner_id = current_user_id) then
    raise exception 'Proprietario ja tem acesso' using errcode = '22023';
  end if;
  insert into public.entrelinhas_board_members (board_id, user_id, permission)
  values (invite.board_id, current_user_id, invite.permission)
  on conflict (board_id, user_id) do nothing;
  update public.entrelinhas_board_invitations
  set accepted_at = now(), accepted_by = current_user_id where id = invite.id;
  return invite.board_id;
end;
$$;

create function public.entrelinhas_decline_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  verified_email text;
begin
  select lower(btrim(u.email)) into verified_email
  from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if verified_email is null then
    raise exception 'Convite indisponivel para esta conta' using errcode = '42501';
  end if;
  update public.entrelinhas_board_invitations i set declined_at = now()
  where i.id = p_invitation_id and i.email = verified_email
    and i.revoked_at is null and i.accepted_at is null and i.declined_at is null
    and i.expires_at > now();
  if not found then raise exception 'Convite indisponivel para esta conta' using errcode = '42501'; end if;
end;
$$;

create function public.entrelinhas_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.entrelinhas_board_invitations i set revoked_at = now()
  where i.id = p_invitation_id and i.revoked_at is null and i.accepted_at is null and i.declined_at is null
    and public.entrelinhas_board_access(i.board_id) = 'owner';
  if not found then raise exception 'Convite indisponivel' using errcode = '42501'; end if;
end;
$$;

create function public.entrelinhas_remove_member(p_board_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.entrelinhas_sync_boards where id = p_board_id for update;
  if public.entrelinhas_board_access(p_board_id) is distinct from 'owner' then
    raise exception 'Somente o proprietario pode remover membros' using errcode = '42501';
  end if;
  delete from public.entrelinhas_board_members where board_id = p_board_id and user_id = p_user_id;
  if not found then raise exception 'Membro indisponivel' using errcode = '22023'; end if;
  update public.entrelinhas_board_invitations i set revoked_at = now()
  where i.board_id = p_board_id and i.accepted_at is null and i.revoked_at is null
    and i.email = (select lower(btrim(u.email)) from auth.users u where u.id = p_user_id);
end;
$$;

create function public.entrelinhas_set_member_permission(p_board_id uuid, p_user_id uuid, p_permission text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.entrelinhas_sync_boards where id = p_board_id for update;
  if public.entrelinhas_board_access(p_board_id) is distinct from 'owner' then
    raise exception 'Somente o proprietario pode alterar permissoes' using errcode = '42501';
  end if;
  if p_permission is null or p_permission not in ('editor', 'viewer') then
    raise exception 'Permissao invalida' using errcode = '22023';
  end if;
  update public.entrelinhas_board_members set permission = p_permission
  where board_id = p_board_id and user_id = p_user_id;
  if not found then raise exception 'Membro indisponivel' using errcode = '22023'; end if;
end;
$$;

revoke all on function public.entrelinhas_invite_member(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.entrelinhas_accept_invitation(uuid) from public, anon, authenticated;
revoke all on function public.entrelinhas_decline_invitation(uuid) from public, anon, authenticated;
revoke all on function public.entrelinhas_revoke_invitation(uuid) from public, anon, authenticated;
revoke all on function public.entrelinhas_remove_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.entrelinhas_set_member_permission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.entrelinhas_invite_member(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.entrelinhas_accept_invitation(uuid) to authenticated;
grant execute on function public.entrelinhas_decline_invitation(uuid) to authenticated;
grant execute on function public.entrelinhas_revoke_invitation(uuid) to authenticated;
grant execute on function public.entrelinhas_remove_member(uuid, uuid) to authenticated;
grant execute on function public.entrelinhas_set_member_permission(uuid, uuid, text) to authenticated;

-- Editores podem modificar o documento existente com CAS, mas nao trocar seu
-- manifesto de anexos nem excluir o quadro nesta etapa.
create or replace function public.entrelinhas_sync_save(
  p_expected_owner_id uuid, p_board_id uuid, p_expected_revision bigint, p_document jsonb
)
returns public.entrelinhas_sync_boards
language plpgsql security definer set search_path = ''
as $$
declare
  saved public.entrelinhas_sync_boards;
  previous public.entrelinhas_sync_boards;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Autenticacao necessaria' using errcode = '42501'; end if;
  if p_board_id is null or p_document is null or jsonb_typeof(p_document) <> 'object'
     or (p_expected_revision is not null and p_expected_revision < 0) then
    raise exception 'Quadro, revisao ou documento invalido' using errcode = '22023';
  end if;
  if p_expected_revision is null then
    if p_expected_owner_id is distinct from current_user_id then
      raise exception 'A conta conectada mudou' using errcode = '42501';
    end if;
    insert into public.entrelinhas_sync_boards (id, owner_id, document, revision)
    values (p_board_id, current_user_id, p_document, 0) returning * into saved;
  else
    select * into previous from public.entrelinhas_sync_boards where id = p_board_id for update;
    if not found or previous.owner_id is distinct from p_expected_owner_id or
       previous.revision <> p_expected_revision then
      raise exception 'Quadro indisponivel ou conflito de revisao' using errcode = '40001';
    end if;
    if previous.owner_id <> current_user_id then
      if public.entrelinhas_board_access(p_board_id) is distinct from 'editor' then
        raise exception 'Acesso negado' using errcode = '42501';
      end if;
      if p_document->'files' is distinct from previous.document->'files'
         or p_document->'deleted' is distinct from previous.document->'deleted'
         or p_document->>'format' is distinct from previous.document->>'format'
         or p_document->'board'->>'id' is distinct from previous.document->'board'->>'id' then
        raise exception 'Editor nao pode alterar identidade, anexos ou exclusao' using errcode = '42501';
      end if;
    end if;
    update public.entrelinhas_sync_boards
    set document = p_document, revision = revision + 1, updated_at = now()
    where id = p_board_id returning * into saved;
  end if;
  insert into public.entrelinhas_sync_history (board_id, owner_id, revision, document)
  values (saved.id, saved.owner_id, saved.revision, saved.document);
  return saved;
end;
$$;
commit;
