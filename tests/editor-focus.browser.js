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
  let attempts = 0;
  let online = true;
  let holdNext;
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
      async listBoards() {
        if (!online) throw new Error("Rede de teste indisponível");
        return [{ id: "focus-board", revision: remote.revision }];
      },
      async loadBoard() { return structuredClone(remote); },
      async saveBoard(_client, _owner, board, files, revision) {
        attempts++;
        if (holdNext) {
          const held = holdNext;
          holdNext = null;
          await held.promise;
        }
        if (!online) throw new Error("Rede de teste indisponível");
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
    const onlineProperty = Object.getOwnPropertyDescriptor(navigator, "onLine");
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
      for (const value of ["N", "No", "Nota alterada"]) {
        note.textContent = value;
        note.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert(saves === 0, "A digitação contínua causou gravações excessivas.");
      await wait(() => remote.board.cards[0].title === "Nota alterada");
      assert(document.activeElement === note && saves === 1, "Autosave interrompeu a edição ou enviou versões extras.");
      document.querySelector("#sync-diagnostic-run").click();
      await wait(() => !document.querySelector("#sync-diagnostic-run").disabled);
      const report = document.querySelector("#sync-diagnostic").textContent;
      assert(report.includes("Versão do aplicativo:") && report.includes("1 quadro(s) remoto(s)") &&
        report.includes("revisão remota 1") && !report.includes(owner) && !report.includes("Nota alterada"),
        "Diagnóstico não mostrou revisões ou expôs dados privados.");

      const held = {};
      held.promise = new Promise((resolve) => { held.release = resolve; });
      holdNext = held;
      note.textContent = "Primeira versão";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(() => attempts === 2);
      note.textContent = "Edição durante envio";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      const journalKey = Object.keys(localStorage).find((key) => key.startsWith(`entrelinhas-draft-v1:${owner}:`));
      assert(journalKey && JSON.parse(localStorage.getItem(journalKey)).state.boards[0].cards[0].title === "Edição durante envio",
        "A última edição não foi persistida imediatamente.");
      held.release();
      await wait(() => remote.board.cards[0].title === "Edição durante envio");
      assert(saves === 3 && document.querySelector("#sync-conflicts").hidden, "Edição durante envio gerou perda ou conflito falso.");

      note.textContent = "Enviar ao sair";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      const blurStart = performance.now();
      clickCanvas();
      assert(document.activeElement !== note, "Clique no quadro não encerrou a edição.");
      await wait(() => remote.board.cards[0].title === "Enviar ao sair");
      assert(performance.now() - blurStart < 1000, "Sair do campo não antecipou a sincronização.");

      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
      assert(document.querySelector("#save-status").textContent === "Offline", "Estado offline não foi exibido.");
      note.focus();
      note.textContent = "Edição offline";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 1300));
      assert(remote.board.cards[0].title === "Enviar ao sair" &&
        document.querySelector("#save-status").textContent === "Offline", "Edição offline não foi preservada.");
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
      await wait(() => remote.board.cards[0].title === "Edição offline");

      online = false;
      note.focus();
      note.textContent = "Edição sem rede";
      note.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(() => document.querySelector("#save-status").textContent.startsWith("Erro:"));
      assert(remote.board.cards[0].title === "Edição offline", "Falha de rede alterou o servidor.");
      const beforeProbe = saves;
      document.querySelector("#sync-diagnostic-run").click();
      await wait(() => !document.querySelector("#sync-diagnostic-run").disabled);
      assert(document.querySelector("#sync-diagnostic").textContent.includes("Falha de rede") && saves === beforeProbe,
        "Diagnóstico não identificou a falha de rede ou tentou gravar dados.");
      online = true;
      window.dispatchEvent(new Event("online"));
      await wait(() => remote.board.cards[0].title === "Edição sem rede");
      assert(document.activeElement === note, "Reconexão interrompeu a edição.");

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

      title.focus();
      remote.board.title = "Alteração de outro dispositivo";
      remote.revision++;
      window.dispatchEvent(new Event("online"));
      await wait(() => document.querySelector("#save-status").textContent === "Atualização da nuvem pendente");
      assert(document.activeElement === title && title.textContent === "Título alterado",
        "Atualização remota interrompeu o campo em edição.");
      clickCanvas();
      assert(document.activeElement !== title, "Foco do título permaneceu após clicar fora.");
      try {
        await wait(() => document.querySelector("#board-title").textContent === "Alteração de outro dispositivo");
      } catch (error) {
        throw new Error(`${error.message} Estado: ${document.querySelector("#save-status").textContent}; foco: ${document.activeElement?.id}; conflitos: ${document.querySelector("#sync-conflicts").textContent}`);
      }
      return ["debounce durante digitação", "autosave com foco", "edição durante envio", "persistência imediata",
        "sincronização ao sair", "offline e reconexão", "falha de rede", "formatação", "atualização remota adiada"];
    } finally {
      viewport.setPointerCapture = capture;
      if (onlineProperty) Object.defineProperty(navigator, "onLine", onlineProperty);
      else delete navigator.onLine;
      await stop();
    }
  }

  return { start, stop, run, data: () => ({ remote: structuredClone(remote.board), saves }) };
})();
