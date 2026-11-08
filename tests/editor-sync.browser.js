// Executar apenas em origem de testes, com cloud-auth.js substituído por sessão simulada.
window.runEditorSyncTests = async function () {
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const file = new File(["imagem"], "imagem.png", { type: "image/png", lastModified: 1 });
  const board = {
    id: "board", title: "Original", cards: [
      { id: "image", type: "image", x: 10, y: 10, width: 200, imageId: "image", alt: "Teste" },
      { id: "text", type: "text", x: 250, y: 10, width: 200, html: "<b>Texto</b>" }
    ], connections: [{ from: "image", to: "text" }]
  };
  const rows = new Map([[owner, new Map([["board", { board, revision: 0, files: new Map([["image", file]]), deleted: false }]])]]);
  const row = () => rows.get(owner).get("board");
  let online = true;
  const wait = async (predicate, message) => {
    for (let count = 0; count < 100; count += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(message);
  };
  const core = window.EntrelinhasImportCore;
  const original = {
    listBoards: core.listBoards, loadBoard: core.loadBoard,
    importBoard: core.importBoard, saveBoard: core.saveBoard,
    auth: window.entrelinhasCloudAuth, confirm: window.confirm
  };
  let current = owner;
  window.entrelinhasCloudAuth = { requireSession: async () => ({ client: {}, userId: current }) };
  window.confirm = () => true;
  Object.assign(core, {
    async listBoards(_client, userId) {
      if (!online) throw new Error("Rede simulada indisponível");
      return [...(rows.get(userId)?.entries() || [])].map(([id, value]) => ({ id, revision: value.revision }));
    },
    async loadBoard(_client, userId, id) {
      if (!online) throw new Error("Rede simulada indisponível");
      return structuredClone(rows.get(userId)?.get(id));
    },
    async saveBoard(_client, userId, value, files, revision, options) {
      if (!online) throw new Error("Rede simulada indisponível");
      const row = rows.get(userId)?.get(value.id);
      if (!row || row.revision !== revision) throw new Error("Conflito de revisão");
      assert(await files.get("image").text() === "imagem", "Anexo não enviado.");
      rows.get(userId).set(value.id, { board: structuredClone(value), files, revision: revision + 1, deleted: options.deleted });
      return { revision: revision + 1 };
    },
    async importBoard(_client, userId, value, files) {
      if (!online) throw new Error("Rede simulada indisponível");
      if (!rows.has(userId)) rows.set(userId, new Map());
      if (rows.get(userId).has(value.id)) throw new Error("Identidade já existe");
      rows.get(userId).set(value.id, { board: structuredClone(value), files, revision: 0, deleted: false });
      return { revision: 0 };
    }
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const session = (userId) => {
    current = userId;
    window.dispatchEvent(new CustomEvent("entrelinhas-session", { detail: { userId } }));
  };
  const title = () => document.querySelector("#board-list").textContent;
  const setTitle = (value) => {
    const element = document.querySelector("#board-title");
    element.textContent = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
    document.querySelector("#home-link").click();
  };
  try {
    session(owner);
    await wait(() => title().includes("Original"), "Quadro remoto não apareceu.");
    document.querySelector('[data-open-board="board"]').click();
    await wait(() => Boolean(document.querySelector('[data-media-id="image"]')?.src.startsWith("blob:")), "Anexo não foi aberto.");
    assert(document.querySelector(".rich-text")?.innerHTML.includes("<b>Texto</b>"), "Formatação não foi preservada.");
    setTitle("Salvo pelo editor");
    await wait(() => row().board.title === "Salvo pelo editor", "Edição não foi enviada.");

    online = false;
    document.querySelector('[data-open-board="board"]').click();
    setTitle("Edição offline");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert(row().board.title === "Salvo pelo editor", "Edição offline alterou a nuvem.");
    online = true;
    window.dispatchEvent(new Event("online"));
    await wait(() => row().board.title === "Edição offline", "Reconexão não enviou a edição.");

    document.querySelector('[data-open-board="board"]').click();
    setTitle("Edição local");
    row().board.title = "Edição remota";
    row().revision += 1;
    await wait(() => !document.querySelector("#sync-conflicts").hidden, "Conflito não foi exibido.");
    assert(title().includes("Edição local") && row().board.title === "Edição remota", "Uma versão foi sobrescrita.");
    [...document.querySelectorAll("#sync-conflicts button")].find((button) => button.textContent === "Manter local").click();
    await wait(() => row().board.title === "Edição local", "Resolução não foi sincronizada.");
    const store = window.EntrelinhasAccountStore.create(indexedDB);
    const saved = await store.read(owner);
    await store.close();
    assert(saved.archive.some((item) => item.board.title === "Edição remota"), "Versão remota não foi arquivada.");

    document.querySelector('[data-open-board="board"]').click();
    setTitle("Outra edição local");
    row().board.title = "Outra edição remota";
    row().revision += 1;
    await wait(() => !document.querySelector("#sync-conflicts").hidden, "Segundo conflito não foi exibido.");
    [...document.querySelectorAll("#sync-conflicts button")].find((button) => button.textContent === "Preservar ambas").click();
    await wait(() => title().includes("Outra edição remota") && title().includes("Outra edição local (cópia local)"),
      "As duas versões não apareceram.");
    await wait(() => rows.get(owner).size === 2, "A cópia não foi enviada.");
    const copyId = [...rows.get(owner).keys()].find((key) => key !== "board");
    document.querySelector(`[data-delete-board="${CSS.escape(copyId)}"]`).click();
    await wait(() => rows.get(owner).get(copyId).deleted === true, "Exclusão não foi sincronizada.");
    assert(!title().includes("cópia local"), "Quadro excluído continua visível.");
    await wait(() => [...document.querySelectorAll("#sync-archive button")].some((button) =>
      button.textContent.includes("Outra edição local (cópia local)")), "Versão excluída não foi arquivada.");
    [...document.querySelectorAll("#sync-archive button")].find((button) =>
      button.textContent.includes("Outra edição local (cópia local)")).click();
    await wait(() => title().includes("(restaurado)"), "Versão arquivada não foi restaurada.");
    await wait(() => rows.get(owner).size === 3, "Versão restaurada não foi enviada.");

    session(other);
    await wait(() => title() === "", "Quadros de outra conta apareceram.");
    session(owner);
    await wait(() => title().includes("Outra edição remota") && title().includes("(restaurado)"), "Quadros da conta não foram restaurados.");
    return ["carregamento no editor", "anexo e formatação", "salvamento", "offline e reconexão", "conflito e arquivo", "preservar ambas", "exclusão e restauração", "troca de conta"];
  } finally {
    session(null);
    Object.assign(core, {
      listBoards: original.listBoards, loadBoard: original.loadBoard,
      importBoard: original.importBoard, saveBoard: original.saveBoard
    });
    window.entrelinhasCloudAuth = original.auth;
    window.confirm = original.confirm;
    const request = indexedDB.open("entrelinhas-account-sync-v1");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["accounts", "files"], "readwrite");
      for (const id of [owner, other]) {
        tx.objectStore("accounts").delete(id);
        tx.objectStore("files").delete([id, "image"]);
        const prefix = `entrelinhas-draft-v1:${id}:`;
        Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Limpeza dos dados de teste cancelada."));
    });
    db.close();
  }
};
