-- Complementa supabase-setup.sql; requer suas tabelas e funcoes existentes.
-- Revisar antes de executar no projeto.
begin;

create policy "entrelinhas_delete_own_boards"
  on public.entrelinhas_boards for delete to authenticated
  using (owner_id = auth.uid());

grant delete on public.entrelinhas_boards to authenticated;

commit;
