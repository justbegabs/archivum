// Banco descartável em memória; não acessa o projeto Supabase.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const packagePath = process.env.PGLITE_PACKAGE_DIR;
const PGlite = packagePath ? require(packagePath).PGlite : null;
const options = { skip: packagePath ? false : "Defina PGLITE_PACKAGE_DIR para executar os testes PostgreSQL isolados." };
const migration = (name) => fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const editor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const viewer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stranger = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const unverified = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const board = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

test("membros, convite verificado, revisão e revogação em PostgreSQL isolado", options, async () => {
  const db = new PGlite();
  const role = async (id, name = "authenticated") => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role ${name}`);
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const file = `${owner}/${"a".repeat(64)}`;
  const privateFile = `${owner}/${"b".repeat(64)}`;
  const doc = JSON.stringify({ format: "entrelinhas-import-v1", board: { id: "local", title: "inicial", cards: [], connections: [] }, files: [{ path: file }] });
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      insert into auth.users values ('${owner}','owner@example.test',now()), ('${editor}','editor@example.test',now()),
        ('${viewer}','viewer@example.test',now()), ('${stranger}','other@example.test',now()),
        ('${unverified}','unverified@example.test',null);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text not null, public boolean not null);
      create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
      grant usage, select on sequence storage.objects_id_seq to anon, authenticated;
    `);
    await db.exec(migration("202611080002_private_sync_foundation.sql"));
    await db.exec(migration("202611080003_board_members.sql"));
    await role(owner);
    await rows("select public.entrelinhas_sync_save($1,$2,null,$3::jsonb)", [owner, board, doc]);
    await rows("select public.entrelinhas_sync_save($1,$2,null,$3::jsonb)", [owner, other, doc]);
    await rows("insert into storage.objects (bucket_id,name) values ('entrelinhas-sync-private',$1),('entrelinhas-sync-private',$2)", [file, privateFile]);
    const invite = async (email, permission) => (await rows(
      "select public.entrelinhas_invite_member($1,$2,$3,now()+interval '1 day') as id",
      [board, email, permission]))[0].id;
    const editorInvite = await invite("EDITOR@example.test", "editor");
    const anotherEditorInvite = await invite("editor@example.test", "editor");
    const viewerInvite = await invite("viewer@example.test", "viewer");
    const unverifiedInvite = await invite("unverified@example.test", "viewer");
    const revokedInvite = await invite("other@example.test", "viewer");
    const expiredInvite = await invite("other@example.test", "viewer");
    const declinedInvite = await invite("other@example.test", "viewer");
    await rows("select public.entrelinhas_revoke_invitation($1)", [revokedInvite]);
    await db.exec("reset role");
    await rows("update public.entrelinhas_board_invitations set expires_at = now() - interval '1 minute' where id=$1", [expiredInvite]);
    await role(stranger);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [editorInvite]), /indisponivel/i);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [revokedInvite]), /indisponivel/i);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [expiredInvite]), /indisponivel/i);
    await assert.rejects(rows("select public.entrelinhas_decline_invitation($1)", [viewerInvite]), /indisponivel/i);
    await rows("select public.entrelinhas_decline_invitation($1)", [declinedInvite]);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [declinedInvite]), /indisponivel/i);
    assert.equal((await rows("select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 0);
    await role(unverified);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [unverifiedInvite]), /indisponivel/i);
    await role(editor);
    await rows("select public.entrelinhas_accept_invitation($1)", [editorInvite]);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [editorInvite]), /indisponivel/i);
    assert.equal((await rows("select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 1);
    assert.deepEqual((await rows("select name from storage.objects")).map((row) => row.name), [file]);
    await assert.rejects(rows("insert into storage.objects (bucket_id,name) values ('entrelinhas-sync-private',$1)", [`${owner}/${"c".repeat(64)}`]), /row-level security/i);
    await assert.rejects(rows("select public.entrelinhas_invite_member($1,$2,$3,now()+interval '1 day')", [board, "other@example.test", "editor"]), /proprietario/i);
    const edited = JSON.parse(doc); edited.board.title = "alterado";
    await rows("select public.entrelinhas_sync_save($1,$2,0,$3::jsonb)", [owner, board, JSON.stringify(edited)]);
    await assert.rejects(rows("select public.entrelinhas_sync_save($1,$2,0,$3::jsonb)", [owner, board, doc]), /conflito/i);
    const badFiles = structuredClone(edited); badFiles.files = [{ path: "outro" }];
    await assert.rejects(rows("select public.entrelinhas_sync_save($1,$2,1,$3::jsonb)", [owner, board, JSON.stringify(badFiles)]), /anexos/i);
    await role(viewer);
    await rows("select public.entrelinhas_accept_invitation($1)", [viewerInvite]);
    assert.equal((await rows("select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 1);
    assert.deepEqual((await rows("select name from storage.objects")).map((row) => row.name), [file]);
    await assert.rejects(rows("select public.entrelinhas_sync_save($1,$2,1,$3::jsonb)", [owner, board, doc]), /negado/i);
    await assert.rejects(rows("select public.entrelinhas_remove_member($1,$2)", [board, editor]), /proprietario/i);
    await assert.rejects(rows("select public.entrelinhas_set_member_permission($1,$2,$3)", [board, viewer, "editor"]), /proprietario/i);
    await role(owner);
    await assert.rejects(rows("select public.entrelinhas_set_member_permission($1,$2,$3)", [board, viewer, "owner"]), /invalida/i);
    await rows("select public.entrelinhas_set_member_permission($1,$2,$3)", [board, editor, "viewer"]);
    await role(editor);
    await assert.rejects(rows("select public.entrelinhas_sync_save($1,$2,1,$3::jsonb)", [owner, board, doc]), /negado/i);
    await role(owner);
    await rows("select public.entrelinhas_set_member_permission($1,$2,$3)", [board, editor, "editor"]);
    await rows("select public.entrelinhas_remove_member($1,$2)", [board, editor]);
    await role(editor);
    assert.equal((await rows("select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 0);
    assert.equal((await rows("select count(*)::int as n from storage.objects"))[0].n, 0);
    await assert.rejects(rows("select public.entrelinhas_accept_invitation($1)", [anotherEditorInvite]), /indisponivel/i);
    await assert.rejects(rows("select public.entrelinhas_sync_save($1,$2,1,$3::jsonb)", [owner, board, doc]), /negado/i);
    await role(owner);
    const deleted = structuredClone(edited); deleted.deleted = true;
    await rows("select public.entrelinhas_sync_save($1,$2,1,$3::jsonb)", [owner, board, JSON.stringify(deleted)]);
    await assert.rejects(rows("select public.entrelinhas_invite_member($1,$2,$3,now()+interval '1 day')", [board, "other@example.test", "viewer"]), /excluido/i);
    await role(viewer);
    assert.equal((await rows("select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 0);
    assert.equal((await rows("select count(*)::int as n from storage.objects"))[0].n, 0);
    await role("", "anon");
    await assert.rejects(rows("select * from public.entrelinhas_sync_boards"), /permission denied/i);
  } finally { await db.close(); }
});
