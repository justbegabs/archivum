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
      const attachment = files.get(value.cards[0].imageId);
      assert(attachment && ["imagem", "remoto", "remoto 2"].includes(await attachment.text()), "Anexo não enviado.");
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
    const imageCard = document.querySelector('[data-card-id="image"]');
    imageCard.click();
    imageCard.querySelector('[data-action="frame"]').click();
    const frameZoom = document.querySelector("#image-frame-zoom");
    frameZoom.value = "150";
    frameZoom.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#image-frame-close").click();
    await wait(() => row().board.cards[0].frameZoom === 1.5, "Enquadramento não foi enviado à nuvem simulada.");
    assert(row().board.cards[0].imageId === "image" && await row().files.get("image").text() === "imagem",
      "Enquadramento alterou o arquivo original.");
    imageCard.querySelector('[data-action="appearance"]').click();
    const background = document.querySelector("#appearance-background");
    background.value = "#123456";
    background.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#appearance-close").click();
    await wait(() => row().board.cards[0].appearance?.background === "#123456",
      "Aparência não foi enviada à nuvem simulada.");
    const textCard = document.querySelector('[data-card-id="text"]');
    textCard.click();
    const viewport = document.querySelector("#viewport");
    const originalCapture = viewport.setPointerCapture;
    try {
      viewport.setPointerCapture = () => {};
      const zoom = new DOMMatrix(getComputedStyle(document.querySelector("#world")).transform).a;
      const height = textCard.offsetHeight;
      const pointer = (target, type, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
        button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 100, clientY: y
      }));
      pointer(textCard.querySelector("[data-resize-item]"), "pointerdown", 100);
      pointer(viewport, "pointermove", 100 + 50 * zoom);
      pointer(viewport, "pointerup", 100 + 50 * zoom);
      await wait(() => row().board.cards[1].minHeight === height + 50,
        "Altura do texto não foi enviada à nuvem simulada.");
      const originalWidth = row().board.cards[1].width;
      const touch = (target, type, id, x) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
        button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: 100
      }));
      const editable = textCard.querySelector(".rich-text");
      touch(editable, "pointerdown", 1, 100);
      touch(editable, "pointerdown", 2, 200);
      touch(viewport, "pointermove", 2, 250);
      touch(viewport, "pointerup", 2, 250);
      touch(viewport, "pointerup", 1, 100);
      await wait(() => row().board.cards[1].width === Math.round(originalWidth * 1.5),
        "Redimensionamento por pinça não foi enviado à nuvem simulada.");
    } finally {
      viewport.setPointerCapture = originalCapture;
    }
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
    document.querySelector("#sync-diagnostic-run").click();
    await wait(() => !document.querySelector("#sync-diagnostic-run").disabled, "Diagnóstico não terminou.");
    const diagnosticCreateUrl = URL.createObjectURL;
    const diagnosticAnchorClick = HTMLAnchorElement.prototype.click;
    let reportBlob;
    try {
      URL.createObjectURL = (blob) => { reportBlob = blob; return "blob:diagnostic-test"; };
      HTMLAnchorElement.prototype.click = () => {};
      document.querySelector("#sync-diagnostic-export").click();
      const reportText = await reportBlob.text();
      const data = JSON.parse(reportText);
      const conflict = data.boards.find((item) => item.previousConflict);
      assert(conflict?.previousConflict.observed?.localEqualsBase === false &&
        conflict.previousConflict.observed.remoteEqualsBase === false &&
        conflict.previousConflict.observed.remoteRevision === row().revision &&
        conflict.currentPlan === "conflict" && !reportText.includes("Edição local") &&
        !reportText.includes("Edição remota") && !reportText.includes(owner) &&
        row().board.title === "Edição remota", "Relatório não preservou evidência ou alterou dados.");
    } finally {
      URL.createObjectURL = diagnosticCreateUrl;
      HTMLAnchorElement.prototype.click = diagnosticAnchorClick;
    }
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

    row().files.set("image", new File(["remoto"], "remoto.png", { type: "image/png", lastModified: 2 }));
    row().revision += 1;
    window.dispatchEvent(new Event("online"));
    await wait(() => document.querySelector("#sync-conflicts select"), "Conflito de anexo não apareceu.");
    await new Promise((resolve) => setTimeout(resolve, 200));
    document.querySelector("#sync-conflicts select").value = "remote";
    [...document.querySelectorAll("#sync-conflicts button")].find((button) => button.textContent === "Manter nuvem").click();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert(row().board.cards[0].imageId !== "image",
      `Escolha do anexo não foi sincronizada: ${document.querySelector("#save-status").textContent}; ${document.querySelector("#toast").textContent}; ${document.querySelector("#sync-conflicts").textContent}`);
    const changedKey = row().board.cards[0].imageId;
    assert(await row().files.get(changedKey).text() === "remoto", "Versão remota do anexo não foi selecionada.");
    await wait(() => document.querySelector("#sync-conflicts").hidden && document.querySelector("#save-status").textContent === "Salvo na nuvem",
      "Primeira resolução não terminou.");
    const verify = window.EntrelinhasAccountStore.create(indexedDB);
    assert(await (await verify.readFile(owner, "image")).text() === "imagem", "Anexo local original foi perdido.");
    const archived = await verify.read(owner);
    const previous = archived.archive.find((item) => item.reason === "versão local antes da resolução" &&
      item.board.cards[0]?.imageId === "image");
    assert(previous, "Versão local não foi arquivada.");
    await verify.close();

    row().files.set(changedKey, new File(["remoto 2"], "remoto2.png", { type: "image/png", lastModified: 3 }));
    row().revision += 1;
    window.dispatchEvent(new Event("online"));
    await wait(() => document.querySelector("#sync-conflicts select"), "Segundo conflito de anexo não apareceu.");
    await new Promise((resolve) => setTimeout(resolve, 200));
    document.querySelector("#sync-conflicts select").value = "local";
    [...document.querySelectorAll("#sync-conflicts button")].find((button) => button.textContent === "Manter local").click();
    await wait(() => row().board.cards[0].imageId !== changedKey, "Versão local do anexo não foi sincronizada.");
    const localKey = row().board.cards[0].imageId;
    assert(await row().files.get(localKey).text() === "remoto", "Arquivo local escolhido foi perdido.");
    await wait(() => document.querySelector("#sync-conflicts").hidden && document.querySelector("#save-status").textContent === "Salvo na nuvem",
      "Segunda resolução não terminou.");
    const verifyAgain = window.EntrelinhasAccountStore.create(indexedDB);
    const secondArchive = await verifyAgain.read(owner);
    let remotePreserved = false;
    for (const item of secondArchive.archive.filter((entry) => entry.reason === "versão remota antes da resolução")) {
      const attachment = await verifyAgain.readFile(owner, item.board.cards[0].imageId);
      if (attachment && await attachment.text() === "remoto 2") remotePreserved = true;
    }
    assert(remotePreserved, "Versão remota do segundo conflito não foi preservada.");
    await verifyAgain.close();

    row().files.set(localKey, new File(["remoto 2"], "remoto2.png", { type: "image/png", lastModified: 3 }));
    row().revision += 1;
    window.dispatchEvent(new Event("online"));
    await wait(() => document.querySelector("#sync-conflicts select"), "Terceiro conflito de anexo não apareceu.");
    await new Promise((resolve) => setTimeout(resolve, 200));
    document.querySelector("#sync-conflicts select").value = "remote";
    [...document.querySelectorAll("#sync-conflicts button")].find((button) => button.textContent === "Preservar ambas").click();
    await wait(() => row().board.cards[0].imageId !== localKey && title().includes("(cópia local)"),
      "As versões do quadro com anexo conflitante não foram preservadas.");
    await wait(() => document.querySelector("#sync-conflicts").hidden && document.querySelector("#save-status").textContent === "Salvo na nuvem",
      "Terceira resolução não terminou.");

    const anchorClick = HTMLAnchorElement.prototype.click;
    let download;
    HTMLAnchorElement.prototype.click = function () { download = fetch(this.href).then((response) => response.text()); };
    try {
      document.querySelector("#account-backup-export").click();
      await wait(() => Boolean(download), "Backup da conta não foi exportado.");
      const text = await download;
      const fileInput = document.querySelector("#account-backup-input");
      const damaged = JSON.parse(text);
      damaged.payload.record.boards[0].title = "conteúdo alterado";
      const invalid = new DataTransfer();
      invalid.items.add(new File([JSON.stringify(damaged)], "backup-invalido.json", { type: "application/json" }));
      fileInput.files = invalid.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => document.querySelector("#account-backup-status").textContent.includes("Integridade do backup inválida"),
        "Backup adulterado não foi rejeitado.");
      assert(!title().includes("(backup)"), "Backup inválido alterou o editor.");
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], "backup.json", { type: "application/json" }));
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => document.querySelector("#account-backup-status").textContent.includes("restaurados como cópias"),
        "Backup não foi restaurado.");
      assert(title().includes("(backup)"), "Cópia do backup não apareceu no editor.");
    } finally {
      HTMLAnchorElement.prototype.click = anchorClick;
    }

    session(other);
    await wait(() => title() === "", "Quadros de outra conta apareceram.");
    session(owner);
    await wait(() => title().includes("Outra edição remota") && title().includes("(restaurado)"), "Quadros da conta não foram restaurados.");
    return ["carregamento no editor", "anexo e formatação", "salvamento", "offline e reconexão", "conflito e arquivo", "preservar ambas", "exclusão e restauração", "conflito de anexo", "backup e restauração", "troca de conta"];
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
        const prefix = `entrelinhas-draft-v1:${id}:`;
        Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
      }
      const cursor = tx.objectStore("files").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if ([owner, other].includes(item.key[0])) item.delete();
        item.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Limpeza dos dados de teste cancelada."));
    });
    db.close();
  }
};
