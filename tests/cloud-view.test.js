const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "cloud-view.js"), "utf8");

function setup() {
  const elements = new Map();
  function element() {
    return {
      children: [], events: {}, textContent: "", disabled: false,
      addEventListener(name, callback) { this.events[name] = callback; },
      append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; }
    };
  }
  for (const id of ["#cloud-list", "#cloud-list-status", "#cloud-board-list", "#cloud-board-detail"]) {
    elements.set(id, element());
  }
  const events = {};
  const state = { user: "one", urls: [], revoked: [], boards: [{ id: "board", revision: 1 }] };
  const window = {
    addEventListener(name, callback) { events[name] = callback; },
    entrelinhasCloudAuth: { async requireSession() {
      if (!state.user) throw new Error("Entre com sua conta Google");
      return { userId: state.user, client: {} };
    } },
    EntrelinhasImportCore: {
      async listBoards() { return state.boards; },
      async loadBoard() { return { board: { title: "<img onerror=alert(1)>", cards: [], connections: [] }, files: new Map([["file", new File(["a"], "teste.txt")]]), revision: 1 }; }
    }
  };
  const urlApi = {
    createObjectURL() { const url = `blob:${state.urls.length}`; state.urls.push(url); return url; },
    revokeObjectURL(url) { state.revoked.push(url); }
  };
  vm.runInNewContext(source, {
    window, File, URL: urlApi, console: { error() {} },
    document: { querySelector(selector) { return elements.get(selector); }, createElement: element }
  });
  return { elements, events, state, window };
}

test("consulta e exibe cópia verificada como texto sem alterar o editor", async () => {
  const { elements } = setup();
  const button = elements.get("#cloud-list");
  await button.events.click();
  const list = elements.get("#cloud-board-list");
  assert.equal(list.children.length, 1);
  await list.children[0].events.click();
  const detail = elements.get("#cloud-board-detail");
  assert.equal(detail.children[0].textContent, "<img onerror=alert(1)>");
  assert.match(detail.children[2].textContent, /"cards"/);
  assert.equal(detail.children[3].download, "teste.txt");
  assert.match(elements.get("#cloud-list-status").textContent, /revisão 1/);
});

test("sair limpa dados exibidos e revoga URLs de arquivos", async () => {
  const { elements, events, state } = setup();
  await elements.get("#cloud-list").events.click();
  await elements.get("#cloud-board-list").children[0].events.click();
  events["entrelinhas-session"]();
  assert.deepEqual(state.revoked, ["blob:0"]);
  assert.equal(elements.get("#cloud-board-detail").children.length, 0);
  assert.equal(elements.get("#cloud-board-list").children.length, 0);
});

test("mudança de sessão durante leitura descarta dados carregados", async () => {
  const { elements, events, window } = setup();
  await elements.get("#cloud-list").events.click();
  let resolve;
  window.EntrelinhasImportCore.loadBoard = () => new Promise((done) => { resolve = done; });
  const pending = elements.get("#cloud-board-list").children[0].events.click();
  await new Promise(setImmediate);
  events["entrelinhas-session"]();
  resolve({ board: { title: "privado" }, files: new Map(), revision: 0 });
  await pending;
  assert.equal(elements.get("#cloud-board-detail").children.length, 0);
});

test("erros de autenticação são exibidos e não retornam conteúdo", async () => {
  const { elements, state } = setup();
  state.user = null;
  await elements.get("#cloud-list").events.click();
  assert.match(elements.get("#cloud-list-status").textContent, /Entre com sua conta/);
  assert.equal(elements.get("#cloud-board-list").children.length, 0);
});
