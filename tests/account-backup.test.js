const test = require("node:test");
const assert = require("node:assert/strict");
const backup = require("../account-backup.js");

const owner = "01234567-89ab-cdef-0123-456789abcdef";
const other = "11234567-89ab-cdef-0123-456789abcdef";
const board = {
  id: "board", title: "Quadro", coverId: "cover",
  cards: [{ id: "folder", type: "folder", cards: [{ id: "note", fileId: "file", html: "<b>Nota</b>" }], connections: [] }],
  connections: [{ from: "folder", to: "note" }]
};
const file = new File(["conteúdo"], "documento.txt", { type: "text/plain", lastModified: 123 });
const files = () => new Map([["cover", new Blob(["capa"], { type: "image/png" })], ["file", file], ["unused", new Blob(["extra"])]]);
const snapshot = () => ({
  record: { version: 3, boards: [board], activeBoardId: board.id, baseline: [{ board, revision: 4 }],
    archive: [{ board, reason: "excluído" }], theme: "dark" },
  files: files()
});
const journals = () => [{ version: 3, state: { boards: [board], activeBoardId: board.id } }];
const remote = () => [{ board, revision: 5, deleted: false, remoteId: "remote", files: files() }];
const ids = () => { let n = 0; return () => `novo-${++n}`; };

test("backup verifica e restaura quadros, pastas, anexos, versões e rascunhos como cópias", async () => {
  const saved = await backup.create(owner, snapshot(), journals(), remote());
  const restored = await backup.prepareRestore(owner, JSON.parse(JSON.stringify(saved)), ids());
  assert.equal(restored.boards.length, 1);
  assert.notEqual(restored.boards[0].id, board.id);
  assert.notEqual(restored.boards[0].coverId, board.coverId);
  const note = restored.boards[0].cards[0].cards[0];
  assert.equal(note.html, "<b>Nota</b>");
  assert.notEqual(note.fileId, "file");
  assert.equal(await restored.files.get(note.fileId).text(), "conteúdo");
  assert.equal(restored.files.get(note.fileId).name, "documento.txt");
  assert.equal(restored.files.get(note.fileId).lastModified, 123);
  assert.deepEqual(restored.boards[0].connections, board.connections);
  assert.equal(restored.files.size, 6);
  assert.equal(restored.archive.length, 4);
  assert.equal(restored.archive[3].revision, 5);
  assert.equal(saved.payload.record.theme, "dark");
});

test("recusa outra conta, alteração do conteúdo e anexos ausentes", async () => {
  const saved = await backup.create(owner, snapshot(), journals(), remote());
  await assert.rejects(backup.prepareRestore(other, saved, ids()), /outra conta/);
  const tampered = structuredClone(saved);
  tampered.payload.record.boards[0].title = "Alterado";
  await assert.rejects(backup.prepareRestore(owner, tampered, ids()), /Integridade/);
  const incomplete = snapshot();
  incomplete.files.delete("file");
  await assert.rejects(backup.create(owner, incomplete, journals(), remote()), /ausente/);
});

test("detecta anexo adulterado mesmo se o hash do envelope for recalculado", async () => {
  const saved = await backup.create(owner, snapshot(), journals(), remote());
  saved.payload.files[0].data = btoa("dados diferentes");
  const encoded = new TextEncoder().encode(require("../sync-import-core.js").canonical(saved.payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  saved.sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await assert.rejects(backup.prepareRestore(owner, saved, ids()), /Integridade do arquivo/);
});

test("recusa identificadores novos duplicados na restauração", async () => {
  const saved = await backup.create(owner, snapshot(), [], []);
  await assert.rejects(backup.prepareRestore(owner, saved, () => "igual"), /duplicado/);
});

test("restaura quadro disponível apenas na nuvem diretamente como cópia", async () => {
  const snap = snapshot();
  snap.record = { version: 0, boards: [], activeBoardId: null, baseline: [], archive: [], theme: "light" };
  const saved = await backup.create(owner, snap, [], remote());
  const restored = await backup.prepareRestore(owner, saved, ids());
  assert.equal(restored.boards.length, 1);
  assert.match(restored.boards[0].title, /backup da nuvem/);
  assert.equal(restored.archive.length, 0);
});
