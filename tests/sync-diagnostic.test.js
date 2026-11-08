const test = require("node:test");
const assert = require("node:assert/strict");
const { report } = require("../sync-diagnostic.js");
const { create } = require("../sync-engine.js");

const owner = "01234567-89ab-cdef-0123-456789abcdef";
const board = (title, id = "private-board-id") => ({ id, title, cards: [], connections: [] });
const entry = (title, revision) => ({ board: board(title), revision });
const meta = {
  appVersion: "test", pendingJournals: 0, journalChangedDuringRead: false,
  localChangedDuringRead: false, editorChangedDuringRead: false, remoteListChangedDuringRead: false,
  syncInProgress: false, syncAttemptChangedDuringRead: false, events: []
};

test("distingue conflito antigo e plano atual quando base e remoto estão na revisão 1", async () => {
  const record = { version: 4, boards: [board("edição privada")], baseline: [entry("base privada", 1)] };
  const conflicts = [{
    id: "private-board-id", reason: "conflict", diagnosticAttempt: 1,
    remote: entry("versão antiga privada", 0),
    evidence: { capturedAt: "antes", baseRevision: null, remoteRevision: 0, localPresent: true,
      localEqualsBase: null, remoteEqualsBase: null, localEqualsRemote: false, attachmentConflicts: 0 }
  }];
  const remote = [{ ...entry("base privada", 1), remoteId: "private-remote-id" }];
  const result = await report({ owner, record, visible: record.boards, remote, conflicts, meta });
  const item = result.boards[0];
  assert.equal(item.currentPlan, "upload");
  assert.equal(item.previousConflict.reason, "conflict");
  assert.equal(item.previousConflict.observed.baseRevision, null);
  assert.equal(item.conflictRemoteRevision, 0);
  assert.equal(item.conflictRemoteEqualsCurrentRemote, false);
  assert.equal(item.localChangePending, true);
  assert.equal(item.remoteEqualsBase, true);
  const text = JSON.stringify(result);
  for (const secret of [owner, "private-board-id", "private-remote-id", "edição privada", "base privada", "versão antiga privada"]) {
    assert.equal(text.includes(secret), false);
  }
});

test("relatório distingue contas, quadros e ausência da base", async () => {
  const record = { version: 1, boards: [board("local")], baseline: [] };
  const remote = [entry("remoto", 1)];
  const first = await report({ owner, record, visible: [board("edição ainda não persistida")], remote, conflicts: [], meta });
  const second = await report({ owner: "11234567-89ab-cdef-0123-456789abcdef", record, visible: record.boards, remote, conflicts: [], meta });
  assert.notEqual(first.accountFingerprint, second.accountFingerprint);
  assert.equal(first.boards[0].currentPlan, "conflict");
  assert.equal(first.boards[0].baseRevision, null);
  assert.equal(first.boards[0].localEqualsRemote, false);
  assert.equal(first.boards[0].visibleEqualsLocal, false);
  assert.equal(first.boards[0].localChangePending, true);
});

test("revisão inconsistente é indicada sem exportar erro ou conteúdo", async () => {
  const record = { version: 1, boards: [board("local")], baseline: [entry("base", 1)] };
  const result = await report({ owner, record, visible: record.boards, remote: [entry("remoto", 1)], conflicts: [], meta });
  assert.equal(result.reconciliationError, true);
  assert.equal(result.boards[0].currentPlan, null);
  assert.equal(result.boards[0].remoteEqualsBase, false);
});

test("motor registra evidência do momento do conflito sem escrever", async () => {
  let writes = 0;
  const adapter = {
    session: async () => ({ userId: owner, client: {} }),
    read: async () => ({ version: 1, boards: [board("local")], baseline: [entry("base", 1)] }),
    files: async () => new Map(),
    commit: async () => { writes++; }
  };
  const operations = {
    listBoards: async () => [{ id: "remote", revision: 2 }],
    loadBoard: async () => ({ ...entry("remoto", 2), files: new Map() }),
    saveBoard: async () => { writes++; }, importBoard: async () => { writes++; }
  };
  const [conflict] = await create(adapter, operations).run(owner);
  assert.equal(writes, 0);
  assert.equal(conflict.evidence.baseRevision, 1);
  assert.equal(conflict.evidence.remoteRevision, 2);
  assert.equal(conflict.evidence.localEqualsBase, false);
  assert.equal(conflict.evidence.remoteEqualsBase, false);
});
