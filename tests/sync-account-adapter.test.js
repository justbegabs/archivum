const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../sync-account-adapter.js");

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const board = { id: "board", title: "Teste", cards: [{ imageId: "img" }], connections: [] };

function fixture() {
  let record = { version: 0, boards: [structuredClone(board)], activeBoardId: board.id, baseline: [], archive: [], theme: "light" };
  const file = new Blob(["imagem"]);
  const store = {
    async read() { return structuredClone(record); },
    async readFile(_owner, key) { return key === "img" ? file : undefined; },
    async putFiles(_owner, files) { assert.equal(files.get("img"), file); },
    async update(_owner, version, change) {
      if (record.version !== version) return null;
      const next = change(structuredClone(record));
      next.version += 1;
      record = next;
      return structuredClone(record);
    }
  };
  return { adapter: create(store, async () => ({ userId: owner, client: {} })), read: () => structuredClone(record), file };
}

test("adaptador recupera anexos pelo ID e não ignora arquivo ausente", async () => {
  const { adapter, file } = fixture();
  assert.equal((await adapter.files(owner, board)).get("img"), file);
  await assert.rejects(adapter.files(owner, { ...board, coverId: "missing" }), /ausente/);
});

test("exclusão local arquiva o quadro sem substituir uma versão mais recente", async () => {
  const { adapter, read } = fixture();
  const removed = await adapter.saveDraft(owner, 0, { boards: [], activeBoardId: null, theme: "light" });
  assert.deepEqual(removed.archive[0].board, board);
  assert.equal(removed.activeBoardId, null);
  assert.equal(await adapter.saveDraft(owner, 0, { boards: [board], activeBoardId: board.id }), null);
  assert.equal(read().boards.length, 0);
});

test("exclusão remota arquiva dados e base na mesma atualização", async () => {
  const { adapter, read } = fixture();
  const base = { board, revision: 1, deleted: true };
  const version = await adapter.commit(owner, 0, { id: board.id, baseline: base, remove: true, archive: board });
  assert.equal(version, 1);
  assert.equal(read().boards.length, 0);
  assert.deepEqual(read().archive[0].board, board);
  assert.deepEqual(read().baseline[0], base);
});

test("não aplica exclusão remota se o quadro a arquivar for diferente", async () => {
  const { adapter, read } = fixture();
  await assert.rejects(adapter.commit(owner, 0, {
    id: board.id, baseline: { board, revision: 1, deleted: true }, remove: true, archive: { ...board, title: "Outro" }
  }), /mudou antes/);
  assert.deepEqual(read().boards, [board]);
  assert.deepEqual(read().baseline, []);
});
