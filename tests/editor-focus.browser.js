// Executar em origem local de testes, com cloud-auth.js substituído por sessão simulada.
window.editorFocusTest = (() => {
  const owner = crypto.randomUUID();
  const core = window.EntrelinhasImportCore;
  const original = {
    auth: window.entrelinhasCloudAuth, listBoards: core.listBoards, loadBoard: core.loadBoard,
    importBoard: core.importBoard, saveBoard: core.saveBoard
  };
  let remote = {
    board: { id: "focus-board", title: "Título inicial", cards: [
      { id: "note", type: "note", x: 100, y: 100, width: 230, kicker: "NOTA", title: "Nota inicial", body: "Texto inicial" },
      { id: "text", type: "text", x: 400, y: 100, width: 230, html: "Texto formatável" }
    ], connections: [] },
    revision: 0, files: new Map(), deleted: false
  };
  let saves = 0;
  const wait = async (predicate) => {
    for (let count = 0; count < 150; count++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error("Tempo esgotado durante o teste de foco.");
  };

  async function start() {
    window.entrelinhasCloudAuth = { requireSession: async () => ({ client: {}, userId: owner }) };
    Object.assign(core, {
      async listBoards() { return [{ id: "focus-board", revision: remote.revision }]; },
      async loadBoard() { return structuredClone(remote); },
      async saveBoard(_client, _owner, board, files, revision) {
        if (revision !== remote.revision) throw new Error("Conflito de revisão no teste.");
        remote = { board: structuredClone(board), files, revision: revision + 1, deleted: false };
        saves++;
        return { revision: remote.revision };
      },
      async importBoard() { throw new Error("Criação inesperada no teste."); }
    });
    window.dispatchEvent(new CustomEvent("entrelinhas-session", { detail: { userId: owner } }));
    await wait(() => document.querySelector('[data-open-board="focus-board"]'));
    document.querySelector('[data-open-board="focus-board"]').click();
    await wait(() => document.querySelector('[data-card-id="note"] [data-field="title"]'));
  }

  async function stop() {
    window.dispatchEvent(new CustomEvent("entrelinhas-session", { detail: { userId: null } }));
    Object.assign(core, {
      listBoards: original.listBoards, loadBoard: original.loadBoard,
      importBoard: original.importBoard, saveBoard: original.saveBoard
    });
    window.entrelinhasCloudAuth = original.auth;
    const request = indexedDB.open("entrelinhas-account-sync-v1");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["accounts", "files"], "readwrite");
      tx.objectStore("accounts").delete(owner);
      const cursor = tx.objectStore("files").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (item.key[0] === owner) item.delete();
        item.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Limpeza cancelada."));
    });
    db.close();
    const prefix = `entrelinhas-draft-v1:${owner}:`;
    Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
  }

  async function run() {
    const viewport = document.querySelector("#viewport");
    const capture = viewport.setPointerCapture;
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const clickCanvas = () => {
      const bounds = viewport.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse",
        clientX: bounds.left + 10, clientY: bounds.top + 10 };
      viewport.dispatchEvent(new PointerEvent("pointerdown", options));
      viewport.dispatchEvent(new PointerEvent("pointerup", options));
    };
    try {
      await start();
      viewport.setPointerCapture = () => {};
      const note = document.querySelector('[data-card-id="note"] [data-field="title"]');
      note.focus();
      note.textContent = "Nota alterada";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 3200));
      assert(remote.board.cards[0].title === "Nota inicial", "Campo em edição foi substituído.");
      clickCanvas();
      assert(document.activeElement !== note, "Clique no quadro não encerrou a edição.");
      await wait(() => remote.board.cards[0].title === "Nota alterada");

      const editor = document.querySelector(".rich-text");
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      const bold = document.querySelector('#format-toolbar [data-command="bold"]');
      bold.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      bold.click();
      assert(document.activeElement === editor && editor.innerHTML.includes("<b>"), "Formatação interrompeu a edição.");
      clickCanvas();
      await wait(() => remote.board.cards[1].html.includes("<b>"));

      const title = document.querySelector("#board-title");
      title.focus();
      title.textContent = "Título alterado";
      title.dispatchEvent(new Event("input", { bubbles: true }));
      clickCanvas();
      await wait(() => remote.board.title === "Título alterado");
      return ["clique fora e sincronização", "campo em edição preservado", "formatação", "título do quadro"];
    } finally {
      viewport.setPointerCapture = capture;
      await stop();
    }
  }

  return { start, stop, run, data: () => ({ remote: structuredClone(remote.board), saves }) };
})();
