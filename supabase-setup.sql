-- Entrelinhas: execute uma vez no SQL Editor do projeto Supabase.
-- Este script prepara o banco; ele nao conecta o site ao Supabase.
begin;

create table public.entrelinhas_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  document jsonb not null default '{"title":"Novo quadro","cards":[],"connections":[]}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entrelinhas_board_document_object check (jsonb_typeof(document) = 'object')
);

create table public.entrelinhas_invitations (
  board_id uuid not null references public.entrelinhas_boards(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (board_id, email),
  constraint entrelinhas_invitation_email_normalized
    check (email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1)
);

alter table public.entrelinhas_boards enable row level security;
alter table public.entrelinhas_invitations enable row level security;

-- A consulta a auth.users usa o e-mail confirmado pelo servidor, nao dados
-- editaveis do perfil ou apenas o endereco informado pelo cliente.
create function public.entrelinhas_can_edit(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.entrelinhas_boards b
    where b.id = p_board_id
      and (
        b.owner_id = auth.uid()
        or exists (
          select 1
          from public.entrelinhas_invitations i
          join auth.users u on u.id = auth.uid()
          where i.board_id = b.id
            and u.email_confirmed_at is not null
            and lower(u.email) = i.email
        )
      )
  );
$$;

create function public.entrelinhas_is_owner(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.entrelinhas_boards b
    where b.id = p_board_id and b.owner_id = auth.uid()
  );
$$;

revoke all on function public.entrelinhas_can_edit(uuid) from public, anon, authenticated;
revoke all on function public.entrelinhas_is_owner(uuid) from public, anon, authenticated;
grant execute on function public.entrelinhas_can_edit(uuid) to authenticated;
grant execute on function public.entrelinhas_is_owner(uuid) to authenticated;

create policy "entrelinhas_read_boards"
  on public.entrelinhas_boards for select to authenticated
  using (public.entrelinhas_can_edit(id));

create policy "entrelinhas_create_own_boards"
  on public.entrelinhas_boards for insert to authenticated
  with check (owner_id = auth.uid() and revision = 0);

create policy "entrelinhas_read_invitations_as_owner"
  on public.entrelinhas_invitations for select to authenticated
  using (public.entrelinhas_is_owner(board_id));

create policy "entrelinhas_invite_as_owner"
  on public.entrelinhas_invitations for insert to authenticated
  with check (public.entrelinhas_is_owner(board_id));

create policy "entrelinhas_revoke_as_owner"
  on public.entrelinhas_invitations for delete to authenticated
  using (public.entrelinhas_is_owner(board_id));

revoke all on public.entrelinhas_boards from public, anon, authenticated;
revoke all on public.entrelinhas_invitations from public, anon, authenticated;
grant select, insert on public.entrelinhas_boards to authenticated;
grant select, insert, delete on public.entrelinhas_invitations to authenticated;

-- Escritas exigem a revisao lida pelo cliente. Uma edicao concorrente
-- retorna erro, em vez de apagar silenciosamente o trabalho de outra pessoa.
create function public.entrelinhas_save_board(
  p_board_id uuid,
  p_expected_revision bigint,
  p_document jsonb
)
returns public.entrelinhas_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.entrelinhas_boards;
begin
  if not public.entrelinhas_can_edit(p_board_id) then
    raise exception 'Acesso negado ao quadro' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'Documento ou revisao invalida' using errcode = '22023';
  end if;

  update public.entrelinhas_boards
  set document = p_document, revision = revision + 1, updated_at = now()
  where id = p_board_id and revision = p_expected_revision
  returning * into saved;

  if not found then
    raise exception 'Conflito de revisao: recarregue o quadro antes de salvar'
      using errcode = '40001';
  end if;
  return saved;
end;
$$;

revoke all on function public.entrelinhas_save_board(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.entrelinhas_save_board(uuid, bigint, jsonb) to authenticated;

-- Nao altera um bucket ja existente. Interrompe a transacao se ele for publico.
insert into storage.buckets (id, name, public)
values ('entrelinhas-arquivos', 'entrelinhas-arquivos', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'entrelinhas-arquivos' and public = false
  ) then
    raise exception 'O bucket entrelinhas-arquivos existente nao e privado';
  end if;
end;
$$;

-- Os caminhos seguem <uuid-do-quadro>/<nome-do-arquivo>.
create function public.entrelinhas_can_access_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  board_part text := split_part(p_name, '/', 1);
begin
  if p_name is null or position('/' in p_name) = 0
    or board_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(p_name, '/', 2) = '' then
    return false;
  end if;
  return public.entrelinhas_can_edit(board_part::uuid);
end;
$$;

revoke all on function public.entrelinhas_can_access_object(text) from public, anon, authenticated;
grant execute on function public.entrelinhas_can_access_object(text) to authenticated;

create policy "entrelinhas_storage_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'entrelinhas-arquivos' and public.entrelinhas_can_access_object(name));

create policy "entrelinhas_storage_create"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'entrelinhas-arquivos' and public.entrelinhas_can_access_object(name));

create policy "entrelinhas_storage_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'entrelinhas-arquivos' and public.entrelinhas_can_access_object(name))
  with check (bucket_id = 'entrelinhas-arquivos' and public.entrelinhas_can_access_object(name));

create policy "entrelinhas_storage_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'entrelinhas-arquivos' and public.entrelinhas_can_access_object(name));

-- Habilita notificacoes das alteracoes; o acesso continua sujeito ao RLS.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'entrelinhas_boards'
     ) then
    alter publication supabase_realtime add table public.entrelinhas_boards;
  end if;
end;
$$;

commit;
