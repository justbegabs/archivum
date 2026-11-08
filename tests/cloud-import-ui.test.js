const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "cloud-import.js"), "utf8");

function setup(options = {}) {
  const snapshot = {
    raw: "original", boards: [{ id: "a" }, { id: "b" }],
    files: new Map(), missing: options.missing || [], referenced: 2, unreferenced: 1
  };
  const state = { imports: [], confirms: 0, current: "original", reads: 0 };
  const button = { disabled: false, addEventListener(_type, callback) { this.click = callback; } };
  const status = { textContent: "" };
  const session = { client: {}, userId: "owner" };
  const window = {
    confirm(text) { state.confirms += 1; state.confirmText = text; return options.confirm !== false; },
    entrelinhasCloudAuth: { async requireSession() {
      state.reads += 1;
      if (options.accountChanged && state.reads > 1) return { ...session, userId: "other" };
      if (options.noSession) throw new Error("Entre com sua conta Google");
      return session;
    } },
    entrelinhasLocalData: {
      async capture() { return snapshot; },
      async isUnchanged() { return !options.changed; }
    },
    EntrelinhasImportCore: { async importBoard(_client, owner, board) {
      state.imports.push([owner, board.id]);
      if (options.fail && board.id === "b") throw new Error("Falha simulada");
      if (options.editDuring && board.id === "a") state.current = "modified";
    } }
  };
  vm.runInNewContext(source, {
    window, localStorage: { getItem() { return state.current; } },
    document: { querySelector(selector) { return selector === "#cloud-import" ? button : status; } },
    console: { error() {} }
  });
  return { state, button, status };
}

test("confirma e envia cada quadro sem anunciar sincronização", async () => {
  const { state, button, status } = setup();
  await button.click();
  assert.deepEqual(state.imports, [["owner", "a"], ["owner", "b"]]);
  assert.match(state.confirmText, /2 quadro/);
  assert.match(state.confirmText, /1 arquivo\(s\) sem referência/);
  assert.match(status.textContent, /ainda não estão disponíveis/);
  assert.equal(button.disabled, false);
});

test("cancelar ou arquivos ausentes não enviam dados", async () => {
  const cancelled = setup({ confirm: false });
  await cancelled.button.click();
  assert.equal(cancelled.state.imports.length, 0);
  assert.match(cancelled.status.textContent, /cancelado/);
  const missing = setup({ missing: ["x"] });
  await missing.button.click();
  assert.equal(missing.state.imports.length, 0);
  assert.equal(missing.state.confirms, 0);
  assert.match(missing.status.textContent, /não foram encontrados/);
});

test("exige login e interrompe mudança de conta", async () => {
  const loggedOut = setup({ noSession: true });
  await loggedOut.button.click();
  assert.equal(loggedOut.state.imports.length, 0);
  assert.match(loggedOut.status.textContent, /Entre com sua conta/);
  const changed = setup({ accountChanged: true });
  await changed.button.click();
  assert.equal(changed.state.imports.length, 0);
  assert.match(changed.status.textContent, /conta conectada mudou/);
});

test("interrompe dados locais alterados ou falha parcial", async () => {
  for (const options of [{ changed: true }, { editDuring: true }, { fail: true }]) {
    const result = setup(options);
    await result.button.click();
    assert.match(result.status.textContent, /interrompido/);
    assert.equal(result.button.disabled, false);
    if (options.changed) assert.equal(result.state.imports.length, 0);
    if (options.editDuring) assert.equal(result.state.imports.length, 1);
    if (options.fail) assert.equal(result.state.imports.length, 2);
  }
});
