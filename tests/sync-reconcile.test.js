const test = require("node:test");
const assert = require("node:assert/strict");
const { plan } = require("../sync-reconcile.js");

const board = (id, title) => ({ id, title, cards: [], connections: [] });
const entry = (value, revision = 0) => ({ board: value, revision });

test("planeja quadros novos locais e remotos sem assumir origem comum", () => {
  assert.deepEqual(plan([], [board("a", "local")], [entry(board("b", "remoto"))]), [
    { id: "a", action: "create" }, { id: "b", action: "download" }
  ]);
  assert.deepEqual(plan([], [board("a", "local")], [entry(board("a", "remoto"))]), [
    { id: "a", action: "conflict" }
  ]);
});

test("compara alterações locais e remotas com a última versão comum", () => {
  const base = board("a", "original");
  assert.equal(plan([entry(base)], [board("a", "local")], [entry(base)])[0].action, "upload");
  assert.equal(plan([entry(base)], [base], [entry(board("a", "remoto"), 1)])[0].action, "download");
  assert.equal(plan([entry(base)], [board("a", "local")], [entry(board("a", "remoto"), 1)])[0].action, "conflict");
  assert.equal(plan([entry(base)], [board("a", "igual")], [entry(board("a", "igual"), 1)])[0].action, "adopt");
});

test("não interpreta ausência remota como exclusão confirmada", () => {
  const base = board("a", "original");
  assert.equal(plan([entry(base)], [base], [])[0].action, "remote-missing");
  assert.equal(plan([entry(base)], [], [])[0].action, "remote-missing");
  assert.equal(plan([entry(base)], [], [entry(base)])[0].action, "delete-remote");
  assert.equal(plan([entry(base)], [], [entry(board("a", "editado"), 1)])[0].action, "conflict");
});

test("recusa revisões inconsistentes e identificadores duplicados", () => {
  const base = board("a", "original");
  assert.throws(() => plan([entry(base, 2)], [base], [entry(base, 1)]), /inconsistente/);
  assert.throws(() => plan([entry(base)], [base], [entry(board("a", "alterado"))]), /inconsistente/);
  assert.throws(() => plan([], [base, base], []), /duplicado/);
  assert.throws(() => plan([], [], [entry(base, -1)]), /inválida/);
});

test("ignora ordem de chaves de objetos ao comparar documentos", () => {
  const base = board("a", "original");
  const reordered = { connections: [], cards: [], title: "original", id: "a" };
  assert.equal(plan([entry(base)], [reordered], [entry(base)])[0].action, "adopt");
});

test("reconcilia exclusões explícitas sem tratar ausência de acesso como exclusão", () => {
  const original = board("a", "original");
  const base = entry(original);
  const deleted = { ...entry(original, 1), deleted: true };
  assert.equal(plan([base], [original], [deleted])[0].action, "delete-local");
  assert.equal(plan([base], [board("a", "local")], [deleted])[0].action, "conflict");
  assert.equal(plan([base], [], [deleted])[0].action, "adopt-delete");
  assert.equal(plan([deleted], [], [deleted])[0].action, "adopt-delete");
  assert.equal(plan([deleted], [original], [deleted])[0].action, "upload");
  assert.equal(plan([], [], [deleted])[0].action, "adopt-delete");
  assert.equal(plan([], [original], [deleted])[0].action, "conflict");
  assert.throws(() => plan([base], [original], [{ ...entry(original), deleted: true }]), /inconsistente/);
});
