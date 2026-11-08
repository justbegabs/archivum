const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../sync-engine.js");

const owner = "01234567-89ab-cdef-0123-456789abcdef";
const other = "11234567-89ab-cdef-0123-456789abcdef";
const example = () => ({
  id: "local-1", title: "Original", cards: [
    { id: "folder", type: "folder", title: "Pasta", cards: [{ id: "image", imageId: "file-1" }], connections: [] }
  ], connections: []
});

function server() {
  const rows = new Map();
  const objects = new Map();
  let online = true;
  const bucket = {
    async download(path) {
      if (!online) throw new Error("Offline");
      return objects.has(path) ? { data: objects.get(path) } : { error: { status: 404 } };
    },
    async upload(path, blob) {
      if (!online) throw new Error("Offline");
      if (objects.has(path)) return { error: { status: 409 } };
      objects.set(path, blob);
      return { data: {} };
    }
  };
  const client = {
    storage: { from: () => bucket },
    from() {
      const filters = {};
      const query = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        gt(_key, value) { filters.cursor = value; return this; },
        order() { return this; },
        limit(value) { filters.limit = value; return this; },
        async maybeSingle() {
          if (!online) throw new Error("Offline");
          return { data: rows.get(filters.id) || null };
        },
        then(resolve, reject) {
          if (!online) { reject(new Error("Offline")); return; }
          const data = [...rows.values()]
            .filter((row) => row.owner_id === filters.owner_id && (!filters.cursor || row.id > filters.cursor))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, filters.limit);
          resolve({ data });
        }
      };
      return query;
    },
    async rpc(_name, args) {
      if (!online) throw new Error("Offline");
      const previous = rows.get(args.p_board_id);
      if (previous ? previous.owner_id !== args.p_expected_owner_id || previous.revision !== args.p_expected_revision
        : args.p_expected_revision !== null) return { error: { message: "Conflito de revisão" } };
      const revision = previous ? previous.revision + 1 : 0;
      rows.set(args.p_board_id, {
        id: args.p_board_id, owner_id: args.p_expected_owner_id, revision, document: structuredClone(args.p_document)
      });
      return { error: null };
    }
  };
  return { client, rows, setOnline(value) { online = value; } };
}

function device(client, userId) {
  const state = { boards: [], baseline: [], version: 0 };
  const files = new Map();
  const archive = [];
  const adapter = {
    async session() { return { client, userId }; },
    async read() { return state; },
    async files() { return new Map(files); },
    async stageFiles(_owner, incoming) {
      for (const [key, file] of incoming) {
        if (files.has(key)) {
          const old = files.get(key);
          assert.equal(await old.text(), await file.text());
        } else files.set(key, file);
      }
    },
    async commit(_owner, version, change) {
      if (state.version !== version) return null;
      state.baseline = state.baseline.filter((entry) => entry.board.id !== change.id);
      state.baseline.push(change.baseline);
      if (change.remove) {
        archive.push(structuredClone(change.archive));
        state.boards = state.boards.filter((board) => board.id !== change.id);
      }
      if (change.board) {
        state.boards = state.boards.filter((board) => board.id !== change.id);
        state.boards.push(change.board);
      }
      return ++state.version;
    }
  };
  return { state, files, archive, engine: create(adapter) };
}

test("dois dispositivos migram, recebem anexos, sincronizam e preservam conflitos", async () => {
  const remote = server();
  const a = device(remote.client, owner);
  const b = device(remote.client, owner);
  const c = device(remote.client, other);
  a.state.boards.push(example());
  a.files.set("file-1", new File(["imagem"], "imagem.png", { type: "image/png", lastModified: 1 }));

  assert.equal((await a.engine.run(owner))[0].action, "create");
  assert.equal((await b.engine.run(owner))[0].action, "download");
  assert.deepEqual(b.state.boards[0], example());
  assert.equal(await b.files.get("file-1").text(), "imagem");
  assert.equal(b.files.get("file-1").name, "imagem.png");
  assert.deepEqual(await c.engine.run(other), []);

  a.state.boards[0].title = "Editado no dispositivo A";
  a.state.version += 1;
  await a.engine.run(owner);
  await b.engine.run(owner);
  assert.equal(b.state.boards[0].title, "Editado no dispositivo A");

  remote.setOnline(false);
  b.state.boards[0].title = "Edição offline B";
  b.state.version += 1;
  await assert.rejects(b.engine.run(owner), /Offline/);
  remote.setOnline(true);
  a.state.boards[0].title = "Edição A";
  a.state.version += 1;
  await a.engine.run(owner);
  const conflict = await b.engine.run(owner);
  assert.equal(conflict[0].action, "conflict");
  assert.equal(b.state.boards[0].title, "Edição offline B");
  assert.equal([...remote.rows.values()][0].document.board.title, "Edição A");
});

test("exclusão é revisionada e preserva conteúdo e anexos nos dois dispositivos", async () => {
  const remote = server();
  const a = device(remote.client, owner);
  const b = device(remote.client, owner);
  a.state.boards.push(example());
  a.files.set("file-1", new File(["imagem"], "imagem.png", { type: "image/png", lastModified: 1 }));
  await a.engine.run(owner);
  await b.engine.run(owner);
  const deleted = a.state.boards.pop();
  a.archive.push(deleted);
  a.state.version += 1;
  assert.equal((await a.engine.run(owner))[0].action, "delete-remote");
  assert.equal([...remote.rows.values()][0].document.deleted, true);
  assert.equal((await b.engine.run(owner))[0].action, "delete-local");
  assert.equal(b.state.boards.length, 0);
  assert.deepEqual(b.archive[0], example());
  assert.equal(await b.files.get("file-1").text(), "imagem");
  assert.equal((await b.engine.run(owner))[0].action, "adopt-delete");
});

test("exclusão concorrente com edição exige resolução e preserva ambos", async () => {
  const remote = server();
  const a = device(remote.client, owner);
  const b = device(remote.client, owner);
  a.state.boards.push(example());
  a.files.set("file-1", new File(["imagem"], "imagem.png", { type: "image/png", lastModified: 1 }));
  await a.engine.run(owner);
  await b.engine.run(owner);
  b.state.boards[0].title = "Editado offline";
  b.state.version += 1;
  a.archive.push(a.state.boards.pop());
  a.state.version += 1;
  await a.engine.run(owner);
  assert.equal((await b.engine.run(owner))[0].action, "conflict");
  assert.equal(b.state.boards[0].title, "Editado offline");
  assert.equal([...remote.rows.values()][0].document.deleted, true);
});
