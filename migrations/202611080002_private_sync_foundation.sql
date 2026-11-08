-- Base para sincronizacao privada. Revisar; nao executar automaticamente.
-- Independente do esquema legado de compartilhamento.
begin;

create table public.entrelinhas_sync_boards (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entrelinhas_sync_history (
  board_id uuid not null references public.entrelinhas_sync_boards(id),
  owner_id uuid not null references auth.users(id),
  revision bigint not null check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  primary key (board_id, revision)
);

alter table public.entrelinhas_sync_boards enable row level security;
alter table public.entrelinhas_sync_history enable row level security;

revoke all on public.entrelinhas_sync_boards from public, anon, authenticated;
revoke all on public.entrelinhas_sync_history from public, anon, authenticated;
grant select on public.entrelinhas_sync_boards to authenticated;
grant select on public.entrelinhas_sync_history to authenticated;

create policy "sync_boards_owner_read"
  on public.entrelinhas_sync_boards for select to authenticated
  using (owner_id = auth.uid());

create policy "sync_history_owner_read"
  on public.entrelinhas_sync_history for select to authenticated
  using (owner_id = auth.uid());

-- NULL cria uma nova identidade; uma revisao numerica atualiza apenas a
-- versao esperada. Historico e atualizacao fazem parte da mesma transacao.
create function public.entrelinhas_sync_save(
  p_expected_owner_id uuid,
  p_board_id uuid,
  p_expected_revision bigint,
  p_document jsonb
)
returns public.entrelinhas_sync_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.entrelinhas_sync_boards;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Autenticacao necessaria' using errcode = '42501';
  end if;
  if p_expected_owner_id is distinct from current_user_id then
    raise exception 'A conta conectada mudou' using errcode = '42501';
  end if;
  if p_board_id is null or p_document is null or jsonb_typeof(p_document) <> 'object'
     or (p_expected_revision is not null and p_expected_revision < 0) then
    raise exception 'Quadro, revisao ou documento invalido' using errcode = '22023';
  end if;

  if p_expected_revision is null then
    insert into public.entrelinhas_sync_boards (id, owner_id, document, revision)
    values (p_board_id, current_user_id, p_document, 0)
    returning * into saved;
  else
    update public.entrelinhas_sync_boards
    set document = p_document, revision = revision + 1, updated_at = now()
    where id = p_board_id and owner_id = current_user_id and revision = p_expected_revision
    returning * into saved;
    if not found then
      raise exception 'Quadro indisponivel ou conflito de revisao' using errcode = '40001';
    end if;
  end if;

  insert into public.entrelinhas_sync_history (board_id, owner_id, revision, document)
  values (saved.id, saved.owner_id, saved.revision, saved.document);
  return saved;
end;
$$;

revoke all on function public.entrelinhas_sync_save(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.entrelinhas_sync_save(uuid, uuid, bigint, jsonb) to authenticated;

-- Objetos seguem <uuid-do-proprietario>/<sha256>. Nao conceder UPDATE ou
-- DELETE: uma tentativa repetida deve verificar o objeto ja existente.
insert into storage.buckets (id, name, public)
values ('entrelinhas-sync-private', 'entrelinhas-sync-private', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'entrelinhas-sync-private' and public = false
  ) then
    raise exception 'O bucket de sincronizacao existente nao e privado';
  end if;
end;
$$;

create policy "sync_objects_owner_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'entrelinhas-sync-private'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{64}$')
  );

create policy "sync_objects_owner_create"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'entrelinhas-sync-private'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{64}$')
  );

commit;
