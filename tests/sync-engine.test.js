const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../sync-engine.js");

const owner = "01234567-89ab-cdef-0123-456789abcdef";
const board = (title = "Original") => ({ id: "board", title, cards: [], connections: [] });
const entry = (title, revision = 0, files = new Map()) => ({ board: board(title), revision, files });

function fixture({ local = [], baseline = [], remote = [], localFiles = new Map() } = {}) {
  const state = { boards: local, baseline, version: 0 };
  const events = [];
  let session = owner;
  const adapter = {
    async session() { return { userId: session, client: {} }; },
    async read() { return state; },
    async files() { return localFiles; },
    async stageFiles(id, files) { events.push(["files", id, files.size]); },
    async commit(id, version, change) {
      events.push(["commit", id, change.id]);
      if (version !== state.version) return null;
      state.baseline = state.baseline.filter((item) => item.board.id !== change.id);
      state.baseline.push(change.baseline);
      if (change.board) {
        state.boards = state.boards.filter((item) => item.id !== change.id);
        state.boards.push(change.board);
      }
      return ++state.version;
    }
  };
  const operations = {
    async listBoards() { return remote.map((item, i) => ({ id: String(i), revision: item.revision })); },
    async loadBoard(_client, _owner, id) { return remote[Number(id)]; },
    async importBoard(_client, _owner, input) { events.push(["create", input.title]); return { revision: 0 }; },
    async saveBoard(_client, _owner, input, _files, revision) {
      events.push(["save", input.title, revision]);
      return { revision: revision + 1 };
    }
  };
  return { state, events, adapter, operations, changeSession: (id) => { session = id; } };
}

test("carrega quadros remotos e seus anexos na conta correta", async () => {
  const f = fixture({ remote: [entry("Remoto", 2, new Map([["img", new Blob(["imagem"])]]))] });
  const result = await create(f.adapter, f.operations).run(owner);
  assert.equal(result[0].action, "download");
  assert.deepEqual(f.events, [["files", owner, 1], ["commit", owner, "board"]]);
  assert.equal(f.state.boards[0].title, "Remoto");
  assert.equal(f.state.baseline[0].revision, 2);
});

test("envia novos quadros e atualiza somente a revisão conhecida", async () => {
  const newBoard = fixture({ local: [board("Novo")] });
  await create(newBoard.adapter, newBoard.operations).run(owner);
  assert.deepEqual(newBoard.events[0], ["create", "Novo"]);
  const edited = fixture({ local: [board("Editado")], baseline: [entry("Original")], remote: [entry("Original")] });
  await create(edited.adapter, edited.operations).run(owner);
  assert.deepEqual(edited.events[0], ["save", "Editado", 0]);
  assert.equal(edited.state.baseline[0].revision, 1);
});

test("versões concorrentes e remoções locais nunca sobrescrevem a nuvem", async () => {
  for (const local of [[board("Local")], []]) {
    const f = fixture({ local, baseline: [entry("Original")], remote: [entry("Remoto", 1)] });
    const result = await create(f.adapter, f.operations).run(owner);
    assert.equal(result[0].action, "conflict");
    assert.deepEqual(f.events, []);
  }
});

test("arquivo diferente com mesmo identificador é conflito", async () => {
  const f = fixture({
    local: [board()], baseline: [entry("Original")],
    remote: [entry("Original", 0, new Map([["img", new Blob(["remoto"])]]))],
    localFiles: new Map([["img", new Blob(["local"])]] )
  });
  const result = await create(f.adapter, f.operations).run(owner);
  assert.equal(result[0].reason, "file-mismatch");
  assert.deepEqual(result[0].fileConflicts, ["img"]);
  assert.deepEqual(f.events, []);
});

test("conflito de anexo de outro quadro é detectado antes de baixar", async () => {
  const f = fixture({ remote: [entry("Remoto", 0, new Map([["img", new Blob(["remoto"])]]))] });
  f.adapter.readFile = async () => new Blob(["local de outro quadro"]);
  const result = await create(f.adapter, f.operations).run(owner);
  assert.equal(result[0].reason, "file-mismatch");
  assert.deepEqual(result[0].fileConflicts, ["img"]);
  assert.deepEqual(f.events, []);
});

test("envia resolução com novo identificador mesmo quando o antigo permanece arquivado", async () => {
  const f = fixture({
    local: [board("Editado")], baseline: [entry("Original")],
    remote: [entry("Original", 0, new Map([["img", new Blob(["remoto"])]]))],
    localFiles: new Map([["novo", new Blob(["selecionado"])]] )
  });
  f.adapter.readFile = async () => new Blob(["anterior arquivado"]);
  const result = await create(f.adapter, f.operations).run(owner);
  assert.equal(result[0].action, "upload");
  assert.deepEqual(f.events[0], ["save", "Editado", 0]);
});

test("edição local concorrente impede aplicar a versão remota", async () => {
  const f = fixture({ remote: [entry("Remoto")] });
  f.adapter.stageFiles = async () => { f.state.version += 1; };
  await assert.rejects(create(f.adapter, f.operations).run(owner), /dados locais mudaram/);
  assert.deepEqual(f.state.boards, []);
});

test("troca de conta durante leitura interrompe sem gravar", async () => {
  const f = fixture({ remote: [entry("Remoto")] });
  f.operations.loadBoard = async () => { f.changeSession("outra-conta"); return entry("Remoto"); };
  await assert.rejects(create(f.adapter, f.operations).run(owner), /conta conectada mudou/);
  assert.deepEqual(f.events, []);
});

test("reconexão permite tentar novamente após falha", async () => {
  const f = fixture({ remote: [entry("Remoto")] });
  const original = f.operations.listBoards;
  f.operations.listBoards = async () => { throw new Error("Offline"); };
  const engine = create(f.adapter, f.operations);
  await assert.rejects(engine.run(owner), /Offline/);
  f.operations.listBoards = original;
  assert.equal((await engine.run(owner))[0].action, "download");
});
