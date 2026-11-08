// Executar apenas em PGlite descartável, nunca conectado ao projeto Supabase.
// PGLITE_PACKAGE_DIR deve apontar para a instalação local de @electric-sql/pglite.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packagePath = process.env.PGLITE_PACKAGE_DIR;
const PGlite = packagePath ? require(packagePath).PGlite : null;
const options = { skip: packagePath ? false : "Defina PGLITE_PACKAGE_DIR para executar os testes PostgreSQL isolados." };
const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "202611080002_private_sync_foundation.sql"), "utf8");

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const board = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hash = "a".repeat(64);

async function setup(db, publicBucket = false) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${userA}'), ('${userB}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null);
    create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant usage, select on sequence storage.objects_id_seq to anon, authenticated;
    ${publicBucket ? "insert into storage.buckets values ('entrelinhas-sync-private', 'existente', true);" : ""}
  `);
}

async function role(db, roleName, userId = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role ${roleName};`);
}

async function rows(db, query) {
  return (await db.query(query)).rows;
}

test("migração: privilégios, RLS, revisões e Storage em PostgreSQL isolado", options, async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await db.exec(sql);
    await role(db, "authenticated", userA);
    const create = `select (public.entrelinhas_sync_save('${userA}', '${board}', null, '{"title":"inicial"}')).revision as revision`;
    assert.equal((await rows(db, create))[0].revision, 0);
    assert.equal((await rows(db, "select count(*)::int as n from public.entrelinhas_sync_history"))[0].n, 1);
    assert.equal((await rows(db, `select (public.entrelinhas_sync_save('${userA}', '${board}', 0, '{"title":"editado"}')).revision as revision`))[0].revision, 1);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', 0, '{"title":"antigo"}')`), /conflito de revisao/i);
    assert.equal((await rows(db, "select document->>'title' as title from public.entrelinhas_sync_boards"))[0].title, "editado");
    assert.equal((await rows(db, "select count(*)::int as n from public.entrelinhas_sync_history"))[0].n, 2);
    await assert.rejects(db.exec(create), /duplicate key/i);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userB}', '${board}', 1, '{}')`), /conta conectada mudou/i);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', -1, '{}')`), /invalido/i);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', 1, '[]')`), /invalido/i);
    await assert.rejects(db.exec(`update public.entrelinhas_sync_boards set document = '{}'`), /permission denied/i);
    await assert.rejects(db.exec(`insert into public.entrelinhas_sync_history (board_id, owner_id, revision, document) values ('${board}', '${userA}', 2, '{}')`), /permission denied/i);

    await db.exec(`reset role;
      create function public.test_fail_history() returns trigger language plpgsql
      as $$ begin raise exception 'historico indisponivel'; end $$;
      create trigger test_fail_history before insert on public.entrelinhas_sync_history
      for each row execute function public.test_fail_history();`);
    await role(db, "authenticated", userA);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', 1, '{"title":"nao gravar"}')`), /historico indisponivel/i);
    assert.deepEqual((await rows(db, "select revision::int, document->>'title' as title from public.entrelinhas_sync_boards"))[0], { revision: 1, title: "editado" });
    await db.exec("reset role; drop trigger test_fail_history on public.entrelinhas_sync_history; drop function public.test_fail_history();");
    await role(db, "authenticated", userA);

    await db.exec(`insert into storage.objects (bucket_id, name) values ('entrelinhas-sync-private', '${userA}/${hash}')`);
    await assert.rejects(db.exec(`insert into storage.objects (bucket_id, name) values ('entrelinhas-sync-private', '${userB}/${hash}')`), /row-level security/i);
    await assert.rejects(db.exec(`insert into storage.objects (bucket_id, name) values ('entrelinhas-sync-private', '${userA}/invalid')`), /row-level security/i);
    assert.equal((await rows(db, `select count(*)::int as n from storage.objects`))[0].n, 1);
    assert.equal((await rows(db, `delete from storage.objects returning id`)).length, 0);
    assert.equal((await rows(db, `update storage.objects set name = 'other' returning id`)).length, 0);

    await role(db, "authenticated", userB);
    assert.equal((await rows(db, "select count(*)::int as n from public.entrelinhas_sync_boards"))[0].n, 0);
    assert.equal((await rows(db, "select count(*)::int as n from public.entrelinhas_sync_history"))[0].n, 0);
    assert.equal((await rows(db, "select count(*)::int as n from storage.objects"))[0].n, 0);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userB}', '${board}', 1, '{}')`), /conflito de revisao/i);
    await role(db, "authenticated");
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', 1, '{}')`), /autenticacao necessaria/i);
    await role(db, "anon");
    await assert.rejects(db.exec(`select * from public.entrelinhas_sync_boards`), /permission denied/i);
    await assert.rejects(db.exec(`select public.entrelinhas_sync_save('${userA}', '${board}', 1, '{}')`), /permission denied/i);
    assert.equal((await rows(db, "select count(*)::int as n from storage.objects"))[0].n, 0);
  } finally {
    await db.close();
  }
});

test("política permissiva preexistente pode ampliar acesso ao Storage", options, async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await db.exec(`create policy broad_existing_read on storage.objects for select to authenticated using (true);`);
    await db.exec(sql);
    await role(db, "authenticated", userA);
    await db.exec(`insert into storage.objects (bucket_id, name) values ('entrelinhas-sync-private', '${userA}/${hash}')`);
    await role(db, "authenticated", userB);
    assert.equal((await rows(db, "select count(*)::int as n from storage.objects"))[0].n, 1);
  } finally {
    await db.close();
  }
});

test("bucket público existente interrompe e reverte a migração", options, async () => {
  const db = new PGlite();
  try {
    await setup(db, true);
    await assert.rejects(db.exec(sql), /existente nao e privado/i);
    await db.exec("rollback");
    assert.equal((await rows(db, "select to_regclass('public.entrelinhas_sync_boards') as name"))[0].name, null);
    assert.equal((await rows(db, "select public from storage.buckets where id = 'entrelinhas-sync-private'"))[0].public, true);
  } finally {
    await db.close();
  }
});
