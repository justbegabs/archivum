(() => {
  const APP_VERSION = "2026-11-08-tela-cheia-1";
  const STORAGE_KEY = "entrelinhas-boards-v1";
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
  const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
  const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
  const mediaUrls = new Map();
  let mediaDatabase;
  const accountStore = window.EntrelinhasAccountStore.create(indexedDB);
  const accountAdapter = window.EntrelinhasAccountAdapter.create(
    accountStore, () => window.entrelinhasCloudAuth.requireSession(),
    (owner, change) => account === owner && (!(change.board || change.remove) ||
      ((!syncing || syncEpoch === accountEpoch) && !editingText() && !interaction))
  );
  accountAdapter.deferRemote = () => editingText() || Boolean(interaction);
  const diagnostic = { stage: "aguardando", attempt: null, success: null, error: null, run: 0, events: [] };
  let diagnosticReport = null;
  function diagnosticEvent(stage) {
    diagnostic.events.push({ at: new Date().toISOString(), attempt: diagnostic.run, stage });
    if (diagnostic.events.length > 80) diagnostic.events.shift();
  }
  const accountEngine = window.EntrelinhasSyncEngine.create(accountAdapter, window.EntrelinhasImportCore, (stage) => {
    diagnostic.stage = stage;
    diagnosticEvent(stage);
    console.info("[Archivum diagnóstico]", stage);
  });
  let account = null;
  let accountVersion = 0;
  let accountEpoch = 0;
  let accountQueue = Promise.resolve();
  let syncTimer;
  let syncRequestedAt = null;
  let syncing = false;
  let resolvingConflict = false;
  let syncEpoch = 0;
  let syncBarrier = Promise.resolve();
  let releaseSync;
  let accountBlocked = false;
  let sessionGeneration = 0;
  let syncConflicts = [];
  const tabId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const $ = (selector) => document.querySelector(selector);
  const cardsElement = $("#cards");
  const linesElement = $("#connection-lines");
  const world = $("#world");
  const viewport = $("#viewport");
  const status = $("#save-status");
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const id = () => `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const initialBoard = {
    id: id(), title: "Meu primeiro quadro",
    cards: [
      { id: "intro", type: "heading", x: 120, y: 105, width: 230, kicker: "COMECE POR AQUI", title: "Toda grande ideia começa em algum lugar.", body: "Um espaço livre para pensar, criar e conectar." },
      { id: "ideas", type: "note", x: 430, y: 85, width: 230, kicker: "IDEIAS & INSPIRAÇÕES", title: "Um universo de possibilidades", body: "Colete pensamentos, referências e tudo aquilo que desperta sua curiosidade.", tag: "inspiração" },
      { id: "photo", type: "photo", x: 735, y: 105, width: 215, kicker: "REFERÊNCIAS VISUAIS", title: "Encontre beleza nos detalhes", body: "Guarde o que te inspira.", image: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=600&q=80" },
      { id: "sticky", type: "sticky", x: 155, y: 330, width: 200, kicker: "LEMBRETE PARA MIM", title: "Menos pressa, mais intenção ✳", body: "Boas ideias precisam de espaço para florescer." },
      { id: "plan", type: "note", x: 440, y: 365, width: 230, kicker: "PRÓXIMOS PASSOS", title: "Tire as ideias do papel", body: "Organize seus projetos do seu jeito, um pensamento de cada vez.", tag: "em andamento" },
      { id: "thought", type: "note", x: 750, y: 405, width: 215, kicker: "ANOTAÇÕES", title: "Um pensamento puxa o outro", body: "Conecte suas notas e veja novas ideias surgirem.", tag: "conexões" }
    ],
    connections: [{ from: "intro", to: "ideas" }, { from: "ideas", to: "photo" }, { from: "ideas", to: "plan" }, { from: "plan", to: "thought" }]
  };
  let state = { boards: [initialBoard], activeBoardId: initialBoard.id };
  let selectedId = null;
  let selectedIds = new Set();
  let mode = "select";
  let connectionStart = null;
  let selectedConnection = null;
  let selectedCurvePoint = null;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let interaction = null;
  const canvasTouches = new Map();
  let pinch = null;
  let viewWidth = 0;
  const mobileCanvas = window.matchMedia("(max-width: 650px)");
  const menuTouches = new Map();
  let multiTouchMenuGesture = false;
  let resizeViewTimer;
  let framingCard = null;
  let appearanceCard = null;
  let toastTimer;
  let textRange = null;
  let activeTextId = null;
  let coverBoardId = null;
  let folderPath = [];

  function getMediaDatabase() {
    if (!mediaDatabase) {
      mediaDatabase = new Promise((resolve, reject) => {
        const request = indexedDB.open("entrelinhas-media", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("images");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Banco de imagens bloqueado por outra aba."));
      }).catch((error) => {
        mediaDatabase = null;
        throw error;
      });
    }
    return mediaDatabase;
  }

  async function mediaOperation(operation, key, value) {
    const owner = account;
    if (owner) {
      if (operation === "get") return accountStore.readFile(owner, key);
      if (operation === "put") return accountStore.putFiles(owner, new Map([[key, value]]));
      return;
    }
    const database = await getMediaDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("images", operation === "get" ? "readonly" : "readwrite");
      const store = transaction.objectStore("images");
      const request = operation === "put" ? store.put(value, key) : operation === "delete" ? store.delete(key) : store.get(key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Operação cancelada."));
    });
  }

  async function removeMedia(key) {
    try {
      await mediaOperation("delete", key);
      if (mediaUrls.has(key)) URL.revokeObjectURL(mediaUrls.get(key));
      mediaUrls.delete(key);
    } catch (error) {
      console.error("Não foi possível remover o arquivo:", error);
      showToast("Não foi possível liberar o armazenamento do arquivo.");
    }
  }

  async function showMedia(element, key) {
    try {
      let url = mediaUrls.get(key);
      if (!url) {
        const blob = await mediaOperation("get", key);
        if (!blob) throw new Error("Arquivo não encontrado.");
        if (!mediaUrls.has(key)) mediaUrls.set(key, URL.createObjectURL(blob));
        url = mediaUrls.get(key);
      }
      if (element.isConnected && element.dataset.mediaId === key) {
        if (element instanceof HTMLAnchorElement) element.href = url;
        else element.src = url;
      }
    } catch (error) {
      console.error("Não foi possível carregar o arquivo:", error);
      if (element.isConnected) {
        if (element instanceof HTMLImageElement) element.alt = "Não foi possível carregar a imagem";
        showToast("Não foi possível carregar um arquivo salvo.");
      }
    }
  }

  function loadMedia(container) {
    container.querySelectorAll("[data-media-id]").forEach((element) => showMedia(element, element.dataset.mediaId));
  }

  async function storeFile(file) {
    const key = id();
    try {
      await mediaOperation("put", key, file);
    } catch (error) {
      console.error("Não foi possível salvar o arquivo:", error);
      throw new Error("Não foi possível salvar o arquivo. Verifique o espaço disponível no navegador.");
    }
    return key;
  }

  async function storeImage(file) {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      throw new Error("Use uma imagem PNG, JPEG, GIF ou WebP.");
    }
    if (file.size > MAX_IMAGE_SIZE) throw new Error("Escolha uma imagem de até 20 MB.");
    const url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = () => reject(new Error("Não foi possível abrir essa imagem."));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    return storeFile(file);
  }

  function sanitizeRichText(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const allowed = new Set(["B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN", "FONT"]);
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const fragment = document.createDocumentFragment();
      for (const child of node.childNodes) fragment.appendChild(clean(child));
      if (!allowed.has(node.tagName)) return fragment;
      const element = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === "FONT") {
        const size = node.getAttribute("size");
        const color = node.getAttribute("color");
        if (/^[1-7]$/.test(size || "")) element.setAttribute("size", size);
        if (/^#[0-9a-f]{6}$/i.test(color || "")) element.setAttribute("color", color);
      }
      element.appendChild(fragment);
      return element;
    }
    const container = document.createElement("div");
    for (const child of parsed.body.childNodes) container.appendChild(clean(child));
    return container.innerHTML;
  }

  function updateTheme() {
    const dark = state.theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const button = $("#theme-toggle");
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
    button.title = button.getAttribute("aria-label");
    button.innerHTML = icon(dark ? "sun" : "moon");
    if (currentBoard()) {
      for (const card of currentCanvas().cards) {
        applyAppearance(card, cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`));
      }
    }
  }

  function hideFormatting() {
    activeTextId = null;
    textRange = null;
    $("#format-toolbar").hidden = true;
  }

  function rememberTextSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const anchor = selection.anchorNode;
    const editor = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement)?.closest(".rich-text");
    if (!editor || !editor.contains(selection.focusNode)) return;
    activeTextId = editor.closest("[data-card-id]").dataset.cardId;
    textRange = selection.getRangeAt(0).cloneRange();
    $("#format-toolbar").hidden = false;
  }

  function formatText(command, value = null) {
    const editor = activeTextId && cardsElement.querySelector(`[data-card-id="${CSS.escape(activeTextId)}"] .rich-text`);
    if (!editor || !textRange || !editor.contains(textRange.commonAncestorContainer)) {
      showToast("Selecione um texto para formatar.");
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(textRange);
    if (!document.execCommand(command, false, value)) {
      showToast("Não foi possível aplicar a formatação.");
      return;
    }
    rememberTextSelection();
    const card = currentCanvas().cards.find((item) => item.id === activeTextId);
    card.html = sanitizeRichText(editor.innerHTML);
    save();
    renderConnections();
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
  }

  function save() {
    try {
      if (account) {
        const owner = account;
        const snapshot = structuredClone(state);
        const epoch = ++accountEpoch;
        const journalKey = `entrelinhas-draft-v1:${owner}:${tabId}`;
        localStorage.setItem(journalKey, JSON.stringify({ version: accountVersion, state: snapshot }));
        status.textContent = "Salvando localmente";
        if (accountBlocked) throw new Error("Sincronização bloqueada. O rascunho foi preservado neste navegador.");
        const barrier = syncBarrier;
        accountQueue = accountQueue.then(async () => {
          await barrier;
          if (accountBlocked) return;
          if (account !== owner) throw new Error("A conta mudou; o rascunho foi preservado neste navegador.");
          const record = await accountAdapter.saveDraft(owner, accountVersion, snapshot);
          if (!record) throw new Error("Outra aba alterou os dados. O rascunho foi preservado; não feche esta aba.");
          if (account !== owner) return;
          accountVersion = record.version;
          if (epoch === accountEpoch) {
            localStorage.removeItem(journalKey);
            if (!syncing) status.textContent = navigator.onLine ? "Pendente de sincronização" : "Offline";
          }
        }).catch((error) => {
          console.error("Falha ao persistir rascunho:", error);
          if (account === owner) {
            status.textContent = `Erro local: ${error.message}`;
            status.parentElement.classList.add("error");
            accountBlocked = true;
            const prefix = `entrelinhas-draft-v1:${owner}:`;
            renderRecovery(Object.keys(localStorage).filter((key) => key.startsWith(prefix)));
            showToast("Rascunho preservado. Abra a página inicial para recuperá-lo.");
          }
        });
        scheduleSync();
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        status.textContent = "Salvo localmente";
      }
      status.parentElement.classList.remove("error");
      return true;
    } catch (error) {
      console.error("Não foi possível salvar o quadro:", error);
      status.textContent = "Erro: não foi possível salvar localmente";
      status.parentElement.classList.add("error");
      showToast("Não foi possível salvar neste dispositivo.");
      return false;
    }
  }

  function scheduleSync(delay = 1000) {
    clearTimeout(syncTimer);
    syncRequestedAt = null;
    if (account && !accountBlocked) {
      syncRequestedAt = Date.now() + delay;
      syncTimer = setTimeout(syncAccount, delay);
    }
  }

  function editingText() {
    const active = document.activeElement;
    return Boolean(active?.isContentEditable || active === $("#connection-label") || $("#format-toolbar").contains(active) || $("#image-frame-dialog").open || $("#appearance-dialog").open);
  }

  document.addEventListener("pointerdown", (event) => {
    const active = document.activeElement;
    if (event.button !== 0 || !active?.isContentEditable ||
        active.contains(event.target) || $("#format-toolbar").contains(event.target)) return;
    active.blur();
    scheduleSync(0);
  }, true);

  document.addEventListener("blur", (event) => {
    if (!event.target.isContentEditable && event.target !== $("#connection-label") && !$("#format-toolbar").contains(event.target)) return;
    setTimeout(() => {
      const active = document.activeElement;
      if (!$("#format-toolbar").contains(active)) scheduleSync(0);
    }, 0);
  }, true);

  function applyAccountState(record) {
    if ($("#image-frame-dialog").open) $("#image-frame-dialog").close();
    if ($("#appearance-dialog").open) $("#appearance-dialog").close();
    framingCard = null;
    appearanceCard = null;
    state = { boards: structuredClone(record.boards), activeBoardId: record.activeBoardId, theme: record.theme };
    renderAccountArchive(record.archive || []);
    folderPath = [];
    selectedId = null;
    selectedIds.clear();
    connectionStart = null;
    clearConnectionSelection();
    for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
    mediaUrls.clear();
    updateTheme();
    renderBoards();
    if (!currentBoard() || !$("#home").hidden) showHome();
    else {
      renderCards();
      initialView();
    }
  }

  async function syncAccount() {
    if (!account || syncing || resolvingConflict || accountBlocked) return;
    if (interaction) {
      scheduleSync(3000);
      return;
    }
    if (!navigator.onLine) {
      status.textContent = "Offline";
      scheduleSync(15000);
      return;
    }
    const owner = account;
    let queued;
    do {
      queued = accountQueue;
      await queued;
    } while (account === owner && accountQueue !== queued);
    if (account !== owner || accountBlocked || syncing || resolvingConflict) return;
    clearTimeout(syncTimer);
    syncRequestedAt = null;
    syncing = true;
    diagnostic.attempt = new Date().toISOString();
    diagnostic.run += 1;
    diagnostic.error = null;
    diagnosticEvent("início da tentativa");
    syncBarrier = new Promise((resolve) => { releaseSync = resolve; });
    syncEpoch = accountEpoch;
    const syncStartBoards = window.EntrelinhasImportCore.canonical(state.boards);
    status.textContent = navigator.onLine ? "Sincronizando" : "Offline";
    try {
      const results = await accountEngine.run(owner);
      if (account !== owner) return;
      const record = await accountStore.read(owner);
      if (syncEpoch !== accountEpoch) {
        if (window.EntrelinhasImportCore.canonical(record.boards) !== syncStartBoards) {
          accountBlocked = true;
          throw new Error("O quadro mudou durante a sincronização. O rascunho foi preservado; recupere-o antes de continuar.");
        }
        accountVersion = record.version;
        diagnostic.stage = "atualização da interface";
        status.textContent = navigator.onLine ? "Pendente de sincronização" : "Offline";
        return;
      }
      accountVersion = record.version;
      if (window.EntrelinhasImportCore.canonical(state.boards) !==
          window.EntrelinhasImportCore.canonical(record.boards) ||
          state.activeBoardId !== record.activeBoardId || state.theme !== record.theme) {
        applyAccountState(record);
      } else {
        renderAccountArchive(record.archive);
      }
      const conflicts = results.filter((result) => result.action === "conflict");
      for (const conflict of conflicts) {
        conflict.diagnosticAttempt = diagnostic.run;
        conflict.diagnosticAttemptAt = diagnostic.attempt;
      }
      syncConflicts = conflicts;
      diagnosticEvent(conflicts.length ? "conflito registrado" : "tentativa concluída");
      renderSyncConflicts();
      if (conflicts.length) {
        diagnostic.stage = "conflito";
        status.textContent = `Conflito: ${conflicts.length} quadro(s)`;
        status.parentElement.classList.add("error");
      } else if (results.some((result) => result.action === "deferred")) {
        diagnostic.stage = "atualização adiada durante edição";
        status.textContent = "Atualização da nuvem pendente";
        status.parentElement.classList.remove("error");
      } else {
        diagnostic.stage = "concluído";
        diagnostic.success = new Date().toISOString();
        status.textContent = "Salvo na nuvem";
        status.parentElement.classList.remove("error");
      }
    } catch (error) {
      diagnostic.error = `Falha na etapa ${diagnostic.stage}. Consulte a mensagem de estado do editor.`;
      diagnosticEvent("falha na tentativa");
      console.info("[Archivum diagnóstico] falha na etapa", diagnostic.stage);
      console.error("Falha na sincronização:", error);
      if (account === owner) {
        if (syncEpoch !== accountEpoch) {
          try {
            const record = await accountStore.read(owner);
            if (account !== owner) return;
            if (window.EntrelinhasImportCore.canonical(record.boards) === syncStartBoards) {
              accountVersion = record.version;
            } else {
              accountBlocked = true;
            }
          } catch (readError) {
            console.error("Falha ao verificar rascunho local:", readError);
            accountBlocked = true;
          }
          if (accountBlocked) {
            const prefix = `entrelinhas-draft-v1:${owner}:`;
            renderRecovery(Object.keys(localStorage).filter((key) => key.startsWith(prefix)));
          }
        }
        status.textContent = navigator.onLine ? `Erro: ${error.message}` : "Offline";
        status.parentElement.classList.add("error");
      }
    } finally {
      syncing = false;
      releaseSync();
      if (account && !accountBlocked) {
        const delay = account !== owner ? 0 : syncRequestedAt !== null ? Math.max(0, syncRequestedAt - Date.now()) : 15000;
        scheduleSync(delay);
      }
    }
  }

  async function changeAccount(owner) {
    if (owner === account) return;
    const generation = ++sessionGeneration;
    clearTimeout(syncTimer);
    syncRequestedAt = null;
    syncConflicts = [];
    renderSyncConflicts();
    $("#sync-recovery").hidden = true;
    document.querySelector(".app").inert = true;
    account = owner;
    diagnostic.stage = "aguardando";
    diagnostic.attempt = null;
    diagnostic.success = null;
    diagnostic.error = null;
    diagnostic.run = 0;
    diagnostic.events = [];
    diagnosticReport = null;
    $("#sync-diagnostic-export").disabled = true;
    $("#sync-diagnostic").textContent = "Aguardando verificação.";
    $("#account-backup-panel").hidden = !owner;
    accountQueue = Promise.resolve();
    accountBlocked = false;
    accountEpoch += 1;
    state = { boards: [], activeBoardId: null };
    applyAccountState({ boards: [], activeBoardId: null, theme: "light" });
    if (!owner) {
      state = { boards: [initialBoard], activeBoardId: initialBoard.id };
      load();
      applyAccountState(state);
      status.textContent = "Salvo localmente";
      document.querySelector(".app").inert = false;
      return;
    }
    status.textContent = "Carregando conta";
    try {
      const record = await accountStore.read(owner);
      if (generation !== sessionGeneration) return;
      const prefix = `entrelinhas-draft-v1:${owner}:`;
      const pending = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
      accountVersion = record.version;
      applyAccountState(record);
      document.querySelector(".app").inert = false;
      if (pending.length) {
        accountBlocked = true;
        status.textContent = "Rascunho pendente em outra aba ou sessão. Dados preservados.";
        status.parentElement.classList.add("error");
        renderRecovery(pending);
        return;
      }
      scheduleSync(0);
    } catch (error) {
      console.error("Falha ao carregar conta:", error);
      if (generation === sessionGeneration) {
        accountBlocked = true;
        document.querySelector(".app").inert = false;
        status.textContent = `Não foi possível carregar a conta: ${error.message}`;
        status.parentElement.classList.add("error");
      }
    }
  }
  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed.boards) || !parsed.boards.every((board) => typeof board.id === "string" && typeof board.title === "string" && Array.isArray(board.cards) && Array.isArray(board.connections)) || (parsed.boards.length ? !parsed.boards.some((board) => board.id === parsed.activeBoardId) : parsed.activeBoardId !== null)) {
        throw new Error("Dados de quadros inválidos");
      }
      state = parsed;
    } catch (error) {
      console.error("Não foi possível carregar os quadros:", error);
      status.textContent = "Erro ao carregar dados";
      status.parentElement.classList.add("error");
      showToast("Não foi possível carregar seus quadros salvos.");
    }
  }

  async function diagnosticHash(value) {
    if (!crypto.subtle) throw new Error("A identificação exige HTTPS ou localhost.");
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  function diagnosticError(error) {
    const text = String(error?.message || "");
    if (/jwt|auth|sessão|session|conta conectada|login/i.test(text)) return "Autenticação ou sessão indisponível.";
    if (/row.level|permission|permissão|policy|política|403|42501/i.test(text)) return "Possível erro de permissão/RLS.";
    if (/storage|arquivo|integridade|manifesto/i.test(text)) return "Falha em anexo, Storage ou integridade.";
    if (/network|fetch|rede|offline/i.test(text)) return "Falha de rede ou serviço indisponível.";
    return "Falha na consulta. Verifique a mensagem de estado do editor.";
  }

  $("#sync-diagnostic-run").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const output = $("#sync-diagnostic");
    const owner = account;
    const generation = sessionGeneration;
    const started = new Date().toISOString();
    const startEpoch = accountEpoch;
    const startRun = diagnostic.run;
    const syncAtStart = syncing;
    const visible = structuredClone(state.boards);
    const capturedConflicts = syncConflicts.map(({ id, reason, remote, evidence, diagnosticAttempt, diagnosticAttemptAt }) => ({
      id, reason, remote: remote ? { board: structuredClone(remote.board), revision: remote.revision } : null,
      evidence: evidence ? { ...evidence } : null, diagnosticAttempt, diagnosticAttemptAt
    }));
    const journals = () => Object.keys(localStorage)
      .filter((key) => key.startsWith(`entrelinhas-draft-v1:${owner}:`))
      .sort().map((key) => [key, localStorage.getItem(key)]);
    const initialJournals = owner ? journals() : [];
    diagnosticReport = null;
    $("#sync-diagnostic-export").disabled = true;
    const lines = [
      `Versão do aplicativo: ${APP_VERSION}`,
      `Autenticação: ${owner ? "conta conectada" : "não conectada"}`,
      `Rede do navegador: ${navigator.onLine ? "online" : "offline"}`,
      `Última tentativa: ${diagnostic.attempt || "nenhuma nesta sessão"}`,
      `Última sincronização sem pendências: ${diagnostic.success || "nenhuma nesta sessão"}`,
      `Tentativas nesta sessão: ${diagnostic.run}`,
      `Etapa atual/última: ${diagnostic.stage}`,
      `Erro recente: ${diagnostic.error || "nenhum registrado nesta sessão"}`,
      `Conflitos pendentes: ${syncConflicts.length}`,
      `Sincronização bloqueada por rascunho: ${accountBlocked ? "sim" : "não"}`,
      `Próxima tentativa agendada: ${syncRequestedAt ? new Date(syncRequestedAt).toISOString() : "nenhuma"}`,
      `Quadros no editor: ${state.boards.length}`
    ];
    button.disabled = true;
    output.textContent = lines.join("\n") + "\nConsultando…";
    let stage = "autenticação";
    let accountFingerprint = null;
    try {
      if (!owner) {
        lines.push("Supabase: entre na conta para verificar.");
      } else {
        const { client, userId } = await window.entrelinhasCloudAuth.requireSession();
        if (userId !== owner || generation !== sessionGeneration) throw new Error("A conta conectada mudou.");
        accountFingerprint = await diagnosticHash(owner.toLowerCase());
        lines.push(`Conta (impressão SHA-256, compare nos dispositivos): ${accountFingerprint}`);
        stage = "leitura local";
        const record = await accountStore.read(owner);
        stage = "consulta remota";
        const listed = await window.EntrelinhasImportCore.listBoards(client, owner);
        lines.push(`Supabase: consulta de quadros concluída; ${listed.length} quadro(s) remoto(s).`);
        stage = "leitura remota e anexos";
        const remote = [];
        for (const row of listed) {
          const item = await window.EntrelinhasImportCore.loadBoard(client, owner, row.id);
          if (item.revision !== row.revision) throw new Error("A revisão mudou durante a consulta.");
          remote.push({ ...item, remoteId: row.id });
        }
        stage = "verificação de consistência";
        const listedAgain = await window.EntrelinhasImportCore.listBoards(client, owner);
        const finalRecord = await accountStore.read(owner);
        const currentSession = await window.entrelinhasCloudAuth.requireSession();
        if (currentSession.userId !== owner || generation !== sessionGeneration) throw new Error("A conta conectada mudou.");
        const bases = new Map(record.baseline.map((entry) => [entry.board.id, entry]));
        const clouds = new Map(remote.map((entry) => [entry.board.id, entry]));
        const ids = new Set([...record.boards.map((board) => board.id), ...bases.keys(), ...clouds.keys()]);
        lines.push(`Quadros persistidos localmente: ${record.boards.length}; anexos remotos: verificados.`);
        for (const id of ids) {
          const base = bases.get(id);
          const cloud = clouds.get(id);
          const local = record.boards.some((board) => board.id === id);
          const conflict = capturedConflicts.find((item) => item.id === id);
          lines.push(`Quadro ${await diagnosticHash(id)}: local ${local ? "sim" : "não"}; revisão comum ${base?.revision ?? "nenhuma"}; revisão remota ${cloud?.revision ?? "não encontrada"}${cloud?.deleted ? " (excluído)" : ""}; ${conflict ? `conflito anterior (${conflict.reason})` : "sem conflito registrado"}.`);
        }
        lines.push("A revisão comum é a última versão remota reconhecida localmente; alterações locais pendentes não têm número de revisão próprio.");
        const finalJournals = journals();
        const core = window.EntrelinhasImportCore;
        const meta = {
          appVersion: APP_VERSION, pendingJournals: finalJournals.length,
          journalChangedDuringRead: core.canonical(initialJournals) !== core.canonical(finalJournals),
          localChangedDuringRead: record.version !== finalRecord.version,
          editorChangedDuringRead: startEpoch !== accountEpoch,
          remoteListChangedDuringRead: core.canonical(listed) !== core.canonical(listedAgain),
          syncInProgress: syncAtStart || syncing, syncAttemptChangedDuringRead: startRun !== diagnostic.run,
          lastAttempt: diagnostic.attempt, lastSuccess: diagnostic.success, lastStage: diagnostic.stage,
          lastErrorCategory: diagnostic.error ? "falha de sincronização" : null, attempts: diagnostic.run,
          blocked: accountBlocked, online: navigator.onLine,
          nextAttempt: syncRequestedAt ? new Date(syncRequestedAt).toISOString() : null,
          events: diagnostic.events.map((item) => ({ ...item }))
        };
        const report = await window.EntrelinhasDiagnostic.report({ owner, record, visible, remote, conflicts: capturedConflicts, meta });
        const finalSession = await window.entrelinhasCloudAuth.requireSession();
        if (finalSession.userId !== owner || generation !== sessionGeneration || account !== owner) throw new Error("A conta conectada mudou.");
        report.editorChangedDuringRead ||= startEpoch !== accountEpoch;
        report.syncInProgress ||= syncing;
        report.syncAttemptChangedDuringRead ||= startRun !== diagnostic.run;
        report.readStartedAt = started;
        report.readCompletedAt = new Date().toISOString();
        diagnosticReport = report;
        if (report.reconciliationError) {
          lines.push("Reconciliação atual inconsistente ou inválida; o relatório não indica um plano para os quadros.");
        }
        if (report.localChangedDuringRead || report.editorChangedDuringRead || report.remoteListChangedDuringRead ||
            report.journalChangedDuringRead || report.syncInProgress || report.syncAttemptChangedDuringRead) {
          lines.push("Atenção: houve atividade durante a coleta; as leituras podem não representar o mesmo instante. Verifique novamente.");
        }
        lines.push("O conflito registrado pertence a uma tentativa anterior; compare sua captura com a leitura atual no relatório.");
        $("#sync-diagnostic-export").disabled = false;
      }
    } catch (error) {
      console.info("[Archivum diagnóstico] falha na consulta:", stage);
      lines.push(`Supabase: verificação interrompida em ${stage}. ${diagnosticError(error)}`);
      if (generation === sessionGeneration && account === owner) {
        diagnosticReport = {
          format: "entrelinhas-diagnostic-v1", appVersion: APP_VERSION, readStartedAt: started,
          readCompletedAt: new Date().toISOString(), errorStage: stage, errorCategory: diagnosticError(error),
          authentication: accountFingerprint ? "conta verificada inicialmente" : "não verificada",
          accountFingerprint, remoteQuery: "interrompida",
          online: navigator.onLine, attempts: diagnostic.run, lastAttempt: diagnostic.attempt,
          lastSuccess: diagnostic.success, events: diagnostic.events.map((item) => ({ ...item }))
        };
        $("#sync-diagnostic-export").disabled = false;
      }
    } finally {
      if (generation === sessionGeneration) output.textContent = lines.join("\n");
      button.disabled = false;
    }
  });

  $("#sync-diagnostic-export").addEventListener("click", () => {
    if (!diagnosticReport) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticReport, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "archivum-diagnostico.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function renderRecovery(keys) {
    const container = $("#sync-recovery");
    container.hidden = false;
    container.replaceChildren();
    const text = document.createElement("p");
    text.textContent = "Há rascunhos pendentes desta conta. Feche outras abas do site antes de recuperar. Os quadros serão adicionados como cópias; nada será sobrescrito.";
    container.append(text);
    for (const key of keys) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "backup-button";
      button.textContent = "Recuperar rascunho como cópias";
      button.addEventListener("click", () => recoverDraft(key));
      container.append(button);
    }
  }

  function renderAccountArchive(archive) {
    const container = $("#sync-archive");
    container.hidden = !account || !archive.length;
    container.replaceChildren();
    if (container.hidden) return;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Versões arquivadas (${archive.length})`;
    details.append(summary);
    archive.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "backup-button";
      button.textContent = `Restaurar cópia: ${entry.board.title} — ${entry.reason}`;
      button.addEventListener("click", () => restoreArchived(index, entry));
      details.append(button);
    });
    container.append(details);
  }

  async function restoreArchived(index, entry) {
    const owner = account;
    const epoch = accountEpoch;
    if (!owner || accountBlocked || syncing || resolvingConflict) {
      showToast("Aguarde a sincronização antes de restaurar.");
      return;
    }
    if (!window.confirm("Restaurar esta versão como um novo quadro?")) return;
    resolvingConflict = true;
    try {
      await accountQueue;
      await accountAdapter.files(owner, entry.board);
      if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o quadro mudou.");
      const record = await accountStore.update(owner, accountVersion, (data) => {
        if (account !== owner || epoch !== accountEpoch ||
            window.EntrelinhasImportCore.canonical(data.archive[index]) !== window.EntrelinhasImportCore.canonical(entry)) {
          throw new Error("O arquivo local mudou.");
        }
        const copy = structuredClone(entry.board);
        copy.id = id();
        copy.title += " (restaurado)";
        data.boards.push(copy);
        if (!data.activeBoardId) data.activeBoardId = copy.id;
        return data;
      });
      if (!record) throw new Error("A conta mudou em outra aba.");
      if (account !== owner || epoch !== accountEpoch) {
        accountBlocked = true;
        throw new Error("A conta ou o quadro mudou; o rascunho local foi preservado.");
      }
      accountVersion = record.version;
      applyAccountState(record);
    } catch (error) {
      console.error("Falha ao restaurar versão arquivada:", error);
      status.textContent = `Não foi possível restaurar: ${error.message}`;
      status.parentElement.classList.add("error");
    } finally {
      resolvingConflict = false;
      if (account && !accountBlocked) scheduleSync(1500);
    }
  }

  async function recoverDraft(key) {
    const owner = account;
    if (!owner || !key.startsWith(`entrelinhas-draft-v1:${owner}:`)) return;
    if (!window.confirm("Feche todas as outras abas deste site. Recuperar os quadros deste rascunho como cópias?")) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("O rascunho não está mais disponível.");
      const draft = JSON.parse(raw);
      if (!Array.isArray(draft.state?.boards) || !draft.state.boards.every((board) =>
        board && typeof board.id === "string" && typeof board.title === "string" &&
        Array.isArray(board.cards) && Array.isArray(board.connections))) {
        throw new Error("Rascunho inválido; ele foi preservado.");
      }
      const current = await accountStore.read(owner);
      for (const board of draft.state.boards) await accountAdapter.files(owner, board);
      if (account !== owner || localStorage.getItem(key) !== raw) throw new Error("A conta ou o rascunho mudou.");
      const result = await accountStore.update(owner, current.version, (data) => {
        if (account !== owner || localStorage.getItem(key) !== raw) throw new Error("A conta ou o rascunho mudou.");
        for (const board of draft.state.boards) {
          const copy = structuredClone(board);
          copy.id = id();
          copy.title += " (rascunho recuperado)";
          data.boards.push(copy);
        }
        if (!data.activeBoardId) data.activeBoardId = data.boards[0]?.id || null;
        return data;
      });
      if (!result) throw new Error("A conta foi alterada por outra aba. Tente novamente.");
      if (account !== owner || localStorage.getItem(key) !== raw) throw new Error("A conta ou o rascunho mudou; o original foi mantido.");
      localStorage.removeItem(key);
      accountVersion = result.version;
      applyAccountState(result);
      const prefix = `entrelinhas-draft-v1:${owner}:`;
      const remaining = Object.keys(localStorage).filter((item) => item.startsWith(prefix));
      accountBlocked = remaining.length > 0;
      if (remaining.length) renderRecovery(remaining);
      else {
        $("#sync-recovery").hidden = true;
        status.textContent = "Rascunho recuperado localmente";
        scheduleSync(0);
      }
    } catch (error) {
      console.error("Falha ao recuperar rascunho:", error);
      status.textContent = `Não foi possível recuperar: ${error.message}`;
      status.parentElement.classList.add("error");
    }
  }

  function renderSyncConflicts() {
    const container = $("#sync-conflicts");
    container.replaceChildren();
    container.hidden = !syncConflicts.length;
    if (!syncConflicts.length) return;
    const heading = document.createElement("strong");
    heading.textContent = "Conflitos de sincronização";
    container.append(heading);
    for (const conflict of syncConflicts) {
      const local = state.boards.find((board) => board.id === conflict.id);
      const title = document.createElement("h3");
      title.textContent = local?.title || conflict.remote?.board.title || conflict.id;
      const info = document.createElement("p");
      info.textContent = conflict.reason === "remote-missing"
        ? "O quadro remoto está indisponível. Nenhum dado foi alterado; verifique a conexão e o acesso."
        : "Compare as versões antes de escolher. A versão não escolhida será arquivada localmente.";
      container.append(title, info);
      if (!conflict.remote) continue;
      const fileChoices = new Map();
      for (const key of conflict.fileConflicts || []) {
        const owner = account;
        const label = document.createElement("label");
        label.textContent = `Anexo ${key}: `;
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Versão do anexo ${key}`);
        for (const [value, text] of [["", "Escolha uma versão"], ["local", "Usar arquivo local"], ["remote", "Usar arquivo da nuvem"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          select.append(option);
        }
        label.append(select);
        container.append(label);
        for (const [source, text] of [["local", "Baixar arquivo local"], ["remote", "Baixar arquivo da nuvem"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "backup-button";
          button.textContent = text;
          button.addEventListener("click", async () => {
            try {
              const file = source === "local" ? await accountStore.readFile(owner, key) : conflict.remote.files.get(key);
              if (account !== owner || !(file instanceof Blob)) throw new Error("Arquivo indisponível ou conta alterada.");
              const url = URL.createObjectURL(file);
              const link = document.createElement("a");
              link.href = url;
              link.download = file instanceof File ? file.name : `anexo-${source}`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (error) {
              console.error("Falha ao abrir anexo do conflito:", error);
              status.textContent = `Não foi possível abrir o anexo: ${error.message}`;
              status.parentElement.classList.add("error");
            }
          });
          container.append(button);
        }
        fileChoices.set(key, select);
      }
      for (const [label, board] of [["Local", local], ["Nuvem", conflict.remote.deleted ? null : conflict.remote.board]]) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = `${label}: ${board?.title || "quadro excluído"}`;
        const content = document.createElement("pre");
        content.className = "cloud-board-json";
        content.textContent = board ? JSON.stringify(board, null, 2) : "Quadro excluído";
        details.append(summary, content);
        container.append(details);
      }
      for (const [choice, label] of [["local", "Manter local"], ["remote", "Manter nuvem"], ["both", "Preservar ambas"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "backup-button";
        button.textContent = label;
        button.addEventListener("click", () => resolveConflict(conflict, choice, fileChoices));
        container.append(button);
      }
    }
  }

  async function resolveConflict(conflict, choice, fileChoices) {
    const owner = account;
    const epoch = accountEpoch;
    if (!owner || accountBlocked || syncing || resolvingConflict) {
      showToast("Aguarde a sincronização antes de resolver o conflito.");
      return;
    }
    if ([...fileChoices.values()].some((select) => !select.value)) {
      showToast("Escolha qual versão de cada anexo utilizar.");
      return;
    }
    if (!window.confirm("Confirmar esta escolha? A outra versão será arquivada localmente.")) return;
    resolvingConflict = true;
    try {
      await accountQueue;
      const { client, userId } = await window.entrelinhasCloudAuth.requireSession();
      if (userId !== owner || account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o quadro mudou.");
      const remote = await window.EntrelinhasImportCore.loadBoard(client, owner, conflict.remote.remoteId);
      if (remote.revision !== conflict.remote.revision ||
          window.EntrelinhasImportCore.canonical(remote.board) !== window.EntrelinhasImportCore.canonical(conflict.remote.board) ||
          remote.deleted !== conflict.remote.deleted) {
        throw new Error("A versão na nuvem mudou. Sincronize novamente antes de escolher.");
      }
      const remoteMap = new Map();
      const selectedMap = new Map();
      const staged = new Map();
      for (const [key, file] of remote.files) {
        const localFile = await accountStore.readFile(owner, key);
        if (localFile && !await window.EntrelinhasSyncEngine.sameFile(localFile, file)) {
          const selection = fileChoices.get(key)?.value;
          if (!selection) throw new Error("Os anexos mudaram. Sincronize novamente antes de escolher.");
          const remoteKey = `file-${crypto.randomUUID()}`;
          const selectedKey = `file-${crypto.randomUUID()}`;
          remoteMap.set(key, remoteKey);
          selectedMap.set(key, selectedKey);
          staged.set(remoteKey, file);
          staged.set(selectedKey, selection === "local" ? localFile : file);
        } else {
          staged.set(key, file);
        }
      }
      if ([...fileChoices.keys()].some((key) => !remoteMap.has(key))) {
        throw new Error("Os anexos mudaram. Sincronize novamente antes de escolher.");
      }
      const remoteBoard = window.EntrelinhasAccountBackup.remap(remote.board, remoteMap);
      await accountStore.putFiles(owner, staged);
      if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o quadro mudou.");
      const result = await accountStore.update(owner, accountVersion, (data) => {
        if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o quadro mudou.");
        const local = data.boards.find((board) => board.id === conflict.id);
        const visible = state.boards.find((board) => board.id === conflict.id);
        if (window.EntrelinhasImportCore.canonical(local) !== window.EntrelinhasImportCore.canonical(visible)) {
          throw new Error("O quadro local mudou. Tente novamente.");
        }
        data.archive.push({ board: remoteBoard, revision: remote.revision, reason: "versão remota antes da resolução" });
        if (local) data.archive.push({ board: local, reason: "versão local antes da resolução" });
        if (choice !== "local") {
          data.boards = data.boards.filter((board) => board.id !== conflict.id);
          if (!remote.deleted) data.boards.push(window.EntrelinhasAccountBackup.remap(remote.board, selectedMap));
          if (choice === "both" && local) {
            const copy = structuredClone(local);
            copy.id = id();
            copy.title += " (cópia local)";
            data.boards.push(copy);
          }
        }
        if (choice === "local" && local && selectedMap.size) {
          data.boards = data.boards.map((board) => board.id === conflict.id
            ? window.EntrelinhasAccountBackup.remap(board, selectedMap) : board);
        }
        data.baseline = data.baseline.filter((entry) => entry.board.id !== conflict.id);
        data.baseline.push({ board: remote.board, backupBoard: remoteBoard, revision: remote.revision, deleted: remote.deleted });
        if (!data.boards.some((board) => board.id === data.activeBoardId)) data.activeBoardId = data.boards[0]?.id || null;
        return data;
      });
      if (!result) throw new Error("Os dados locais mudaram. Tente novamente.");
      if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o quadro mudou; confira o rascunho local.");
      accountVersion = result.version;
      applyAccountState(result);
      syncConflicts = syncConflicts.filter((item) => item.id !== conflict.id);
      renderSyncConflicts();
      scheduleSync(0);
    } catch (error) {
      console.error("Falha ao resolver conflito:", error);
      if (account === owner && epoch !== accountEpoch) {
        accountBlocked = true;
        renderRecovery(accountJournals(owner).map((entry) => entry.key));
      }
      status.textContent = `Conflito não resolvido: ${error.message}`;
      status.parentElement.classList.add("error");
    } finally {
      resolvingConflict = false;
      if (account && !accountBlocked) scheduleSync(1500);
    }
  }

  function accountJournals(owner) {
    const prefix = `entrelinhas-draft-v1:${owner}:`;
    return Object.keys(localStorage).filter((key) => key.startsWith(prefix)).sort()
      .map((key) => ({ key, raw: localStorage.getItem(key) }));
  }

  async function exportAccountBackup() {
    const owner = account;
    if (!owner || syncing || resolvingConflict) {
      showToast("Aguarde a sincronização antes de exportar.");
      return;
    }
    const epoch = accountEpoch;
    const message = $("#account-backup-status");
    resolvingConflict = true;
    try {
      await accountQueue;
      const { client, userId } = await window.entrelinhasCloudAuth.requireSession();
      if (userId !== owner || account !== owner) throw new Error("A conta conectada mudou.");
      message.textContent = "Lendo arquivos locais e versões da nuvem…";
      const journals = accountJournals(owner);
      const snapshot = await accountStore.snapshot(owner);
      const core = window.EntrelinhasImportCore;
      const listed = await core.listBoards(client, owner);
      const remote = [];
      for (const row of listed) {
        const session = await window.entrelinhasCloudAuth.requireSession();
        if (session.userId !== owner || account !== owner) throw new Error("A conta conectada mudou.");
        const item = await core.loadBoard(client, owner, row.id);
        if (item.revision !== row.revision) throw new Error("Um quadro remoto mudou durante o backup.");
        remote.push({ ...item, remoteId: row.id });
      }
      const backup = await window.EntrelinhasAccountBackup.create(owner, snapshot, journals.map((entry) => JSON.parse(entry.raw)), remote);
      const after = await core.listBoards(client, owner);
      const revisions = (rows) => rows.map((row) => [row.id, row.revision]).sort((a, b) => a[0].localeCompare(b[0]));
      const session = await window.entrelinhasCloudAuth.requireSession();
      const current = await accountStore.snapshot(owner);
      let filesUnchanged = current.files.size === snapshot.files.size;
      if (filesUnchanged) {
        for (const [key, file] of snapshot.files) {
          if (!await window.EntrelinhasSyncEngine.sameFile(file, current.files.get(key))) {
            filesUnchanged = false;
            break;
          }
        }
      }
      if (session.userId !== owner || account !== owner || epoch !== accountEpoch ||
          current.record.version !== snapshot.record.version || !filesUnchanged ||
          core.canonical(journals) !== core.canonical(accountJournals(owner)) ||
          core.canonical(revisions(listed)) !== core.canonical(revisions(after))) {
        throw new Error("Os dados mudaram durante o backup. Tente novamente.");
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `archivum-conta-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      message.textContent = "Download iniciado. Confira e guarde o backup em local seguro.";
    } catch (error) {
      console.error("Falha ao exportar backup da conta:", error);
      message.textContent = `Backup não concluído: ${error.message}`;
    } finally {
      resolvingConflict = false;
      if (account && !accountBlocked) scheduleSync(1500);
    }
  }

  async function restoreAccountBackup(file) {
    const owner = account;
    if (!owner || syncing || resolvingConflict || accountBlocked) {
      showToast("Aguarde a sincronização e resolva rascunhos pendentes antes de restaurar.");
      return;
    }
    if (!window.confirm("Restaurar o backup desta conta como cópias? Os dados existentes não serão substituídos.")) return;
    const epoch = accountEpoch;
    const message = $("#account-backup-status");
    resolvingConflict = true;
    try {
      await accountQueue;
      message.textContent = "Verificando a integridade do backup…";
      const backup = JSON.parse(await file.text());
      const restored = await window.EntrelinhasAccountBackup.prepareRestore(owner, backup, () => `id-${crypto.randomUUID()}`);
      const session = await window.entrelinhasCloudAuth.requireSession();
      if (session.userId !== owner || account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o editor mudou.");
      await accountStore.putFiles(owner, restored.files);
      if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o editor mudou.");
      const record = await accountStore.update(owner, accountVersion, (data) => {
        if (account !== owner || epoch !== accountEpoch) throw new Error("A conta ou o editor mudou.");
        const ids = new Set(data.boards.map((board) => board.id));
        for (const board of restored.boards) {
          if (ids.has(board.id)) throw new Error("Identificador de quadro duplicado.");
          ids.add(board.id);
        }
        data.boards.push(...restored.boards);
        data.archive.push(...restored.archive);
        if (!data.activeBoardId) data.activeBoardId = data.boards[0]?.id || null;
        return data;
      });
      if (!record) throw new Error("A conta mudou em outra aba. Tente novamente.");
      if (account !== owner || epoch !== accountEpoch) {
        if (account === owner) {
          accountBlocked = true;
          renderRecovery(accountJournals(owner).map((entry) => entry.key));
        }
        throw new Error("O editor mudou; o rascunho foi preservado para recuperação.");
      }
      accountVersion = record.version;
      applyAccountState(record);
      message.textContent = `${restored.boards.length} quadro(s) restaurados como cópias; versões adicionais estão no arquivo local.`;
    } catch (error) {
      console.error("Falha ao restaurar backup da conta:", error);
      message.textContent = `Restauração interrompida: ${error.message}`;
    } finally {
      resolvingConflict = false;
      if (account && !accountBlocked) scheduleSync(1500);
    }
  }

  $("#account-backup-export").addEventListener("click", exportAccountBackup);
  $("#account-backup-restore").addEventListener("click", () => $("#account-backup-input").click());
  $("#account-backup-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) restoreAccountBackup(file);
  });

  const currentBoard = () => state.boards.find((board) => board.id === state.activeBoardId);
  const currentCanvas = () => folderPath.reduce((canvas, folderId) => canvas.cards.find((card) => card.id === folderId && card.type === "folder"), currentBoard());

  function renderCanvasTitle() {
    const canvas = currentCanvas();
    $("#board-title").textContent = canvas.title;
    $("#board-title").setAttribute("aria-label", folderPath.length ? "Nome da pasta" : "Nome do quadro");
    $("#folder-back").hidden = !folderPath.length;
    const names = [currentBoard().title];
    let parent = currentBoard();
    for (const folderId of folderPath) {
      parent = parent.cards.find((card) => card.id === folderId);
      names.push(parent.title);
    }
    $("#breadcrumb-title").textContent = names.join(" / ");
  }

  function renderBoards() {
    $("#board-list").innerHTML = state.boards.map((board) => `<button class="board-item ${board.id === state.activeBoardId ? "active" : ""}" data-board-id="${escapeHTML(board.id)}" aria-label="${escapeHTML(board.title)}">${icon("grid")}<span>${escapeHTML(board.title)}</span></button>`).join("");
    if (currentBoard()) renderCanvasTitle();
  }

  function renderHome() {
    $("#home-board-count").textContent = `${state.boards.length} ${state.boards.length === 1 ? "QUADRO" : "QUADROS"}`;
    $("#home-grid").innerHTML = state.boards.map((board) => `<article class="home-card">
      <button class="home-open" data-open-board="${escapeHTML(board.id)}" aria-label="Abrir ${escapeHTML(board.title)}">
        <div class="home-cover">${board.coverId ? `<img data-media-id="${escapeHTML(board.coverId)}" alt="">` : `<div class="home-cover-placeholder">${icon("grid")}</div>`}</div>
        <div class="home-card-info"><div class="home-card-icon">${icon("grid")}</div><div><h3>${escapeHTML(board.title)}</h3><p>${board.cards.length} ${board.cards.length === 1 ? "item" : "itens"}</p></div>${icon("chevron")}</div>
      </button>
      <button class="cover-button" data-cover-board="${escapeHTML(board.id)}">${icon("image")} ${board.coverId ? "Alterar capa" : "Adicionar capa"}</button>
      <button class="cover-button delete-board-button" type="button" data-delete-board="${escapeHTML(board.id)}" aria-label="Excluir quadro ${escapeHTML(board.title)}">${icon("trash")} Excluir quadro</button>
    </article>`).join("") + `<button class="home-create" id="home-create"><span>${icon("plus")}</span><strong>Criar novo quadro</strong><small>Um novo espaço para suas ideias</small></button>`;
    loadMedia($("#home-grid"));
  }

  function showHome() {
    hideFormatting();
    clearConnectionSelection();
    document.body.classList.remove("mobile-controls-visible");
    document.body.classList.add("show-home");
    $("#home").hidden = false;
    $("#breadcrumb-title").textContent = "Todos os quadros";
    $("#export").hidden = true;
    renderHome();
  }

  function openBoard(boardId) {
    state.activeBoardId = boardId;
    folderPath = [];
    selectedId = null;
    selectedIds.clear();
    document.body.classList.remove("show-home");
    document.body.classList.remove("mobile-controls-visible");
    $("#home").hidden = true;
    $("#export").hidden = false;
    renderBoards();
    setMode("select");
    initialView();
    save();
  }

  function renderCards() {
    const board = currentCanvas();
    cardsElement.innerHTML = board.cards.map((card) => {
      const scalableText = ["text", "note", "sticky", "heading", "photo", "folder"].includes(card.type);
      const textControls = scalableText ? `<button data-action="text-smaller" title="Diminuir texto" aria-label="Diminuir texto">A−</button><button data-action="text-larger" title="Aumentar texto" aria-label="Aumentar texto">A+</button>` : "";
      const frameControl = card.type === "image" ? `<button data-action="frame" title="Ajustar enquadramento" aria-label="Ajustar enquadramento">▣</button>` : "";
      const controls = `<div class="card-controls">${textControls}${frameControl}<button data-action="appearance" title="Aparência do elemento" aria-label="Aparência do elemento">◐</button><button data-action="connect" title="Conectar item" aria-label="Conectar item">${icon("link")}</button><button data-action="delete" title="Excluir item" aria-label="Excluir item">${icon("trash")}</button></div>`;
      const resize = ["text", "note", "sticky", "heading", "photo", "folder", "image", "video"].includes(card.type)
        ? `<button class="item-resize" data-resize-item aria-label="Redimensionar item" title="Arraste para redimensionar"></button>` : "";
      const textScale = Number.isFinite(card.textScale) ? Math.min(3, Math.max(0.5, card.textScale)) : 1;
      const minHeight = Number.isFinite(card.minHeight) && card.minHeight >= 40 && scalableText ? `;min-height:${card.minHeight}px` : "";
      const attributes = `class="card card-${escapeHTML(card.type)} ${card.id === selectedId || selectedIds.has(card.id) ? "selected" : ""} ${card.id === connectionStart?.id ? "connect-source" : ""} ${mode === "connect" ? "connect-target" : ""}" data-card-id="${escapeHTML(card.id)}"${mode === "connect" ? ' tabindex="0" role="button" aria-label="Selecionar elemento para conexão"' : ""}${card.type === "video" && card.mediaResized === true ? " data-media-resized" : ""}${Number.isFinite(card.textScale) ? " data-text-scaled" : ""} style="left:${card.x}px;top:${card.y}px;width:${card.width}px;--text-scale:${textScale}${minHeight}${card.type === "shape" || card.type === "drawing" ? `;height:${card.height}px` : ""}"`;
      if (card.type === "shape") {
        const color = /^#[0-9a-f]{6}$/i.test(card.color) ? card.color : "#8e77aa";
        const shape = card.shape === "ellipse" ? `<ellipse cx="50" cy="50" rx="48" ry="48"/>` : card.shape === "triangle" ? `<polygon points="50,2 98,98 2,98"/>` : `<rect x="2" y="2" width="96" height="96" rx="2"/>`;
        return `<article ${attributes}>${controls}<svg class="shape-image" viewBox="0 0 100 100" preserveAspectRatio="none" style="color:${color}" aria-label="Forma geométrica">${shape}</svg><button class="shape-resize" data-resize-shape aria-label="Redimensionar forma" title="Arraste para redimensionar"></button></article>`;
      }
      if (card.type === "drawing") {
        const color = /^#[0-9a-f]{6}$/i.test(card.color) ? card.color : "#8e77aa";
        const points = Array.isArray(card.points) ? card.points.filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) : [];
        const path = points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" ");
        const size = Math.min(30, Math.max(1, Number(card.brushSize) || 4));
        return `<article ${attributes}>${controls}<svg class="drawing-image" width="${card.width}" height="${card.height}" aria-label="Desenho"><path d="${path}${points.length === 1 ? " l0.01 0" : ""}" fill="none" stroke="${color}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round" ${card.brush === "marker" ? 'opacity=".35"' : ""} ${card.brush === "dashed" ? `stroke-dasharray="${size * 2} ${size * 2}"` : ""}/></svg></article>`;
      }
      if (card.type === "text") return `<article ${attributes}>${controls}<div class="card-inner"><div class="rich-text" contenteditable="true" role="textbox" aria-label="Texto formatável" aria-multiline="true" data-field="html">${sanitizeRichText(card.html || "")}</div></div>${resize}</article>`;
      if (card.type === "image") return `<article ${attributes}>${controls}<div class="card-inner image-frame"><img class="attached-image" ${card.imageId ? `data-media-id="${escapeHTML(card.imageId)}"` : `src="${escapeHTML(card.image || "")}"`} alt="${escapeHTML(card.alt || "Imagem anexada")}" draggable="false"></div>${resize}</article>`;
      if (card.type === "document" || card.type === "video") {
        const name = escapeHTML(card.name);
        const download = `<a class="attachment-download" data-media-id="${escapeHTML(card.fileId)}" download="${name}" aria-label="Baixar ${name}">${icon("export")} Baixar arquivo</a>`;
        const videoHeight = Number.isFinite(card.videoHeight) && card.videoHeight >= 40 ? ` style="height:${card.videoHeight}px"` : "";
        const player = card.type === "video" ? `<video class="attached-video" controls preload="metadata" playsinline data-media-id="${escapeHTML(card.fileId)}" aria-label="Vídeo: ${name}"${videoHeight}></video>` : "";
        return `<article ${attributes}>${controls}<div class="card-inner">${player}<div class="attachment-content"><div class="attachment-icon">${icon(card.type === "video" ? "video" : "note")}</div><div class="attachment-details"><div class="attachment-kind">${card.type === "video" ? "VÍDEO" : "DOCUMENTO"}</div><div class="attachment-name">${name}</div><div class="attachment-size">${escapeHTML(formatFileSize(card.size))}</div></div></div>${download}</div>${resize}</article>`;
      }
      if (card.type === "folder") return `<article ${attributes}>${controls}<div class="card-inner folder-content"><div class="folder-icon">${icon("folder")}</div><div class="folder-label">PASTA</div><div class="card-title" contenteditable="true" data-field="title" spellcheck="false" aria-label="Nome da pasta">${escapeHTML(card.title)}</div><div class="folder-count">${card.cards.length} ${card.cards.length === 1 ? "item" : "itens"}</div><button class="folder-open" data-action="open-folder">Abrir pasta ${icon("arrow")}</button></div>${resize}</article>`;
      const cover = card.type === "photo" ? `<div class="photo-cover" style="background-image:url('${escapeHTML(card.image || "")}')"></div>` : "";
      const tag = card.tag ? `<div class="card-meta"><span>${escapeHTML(card.tag)}</span></div>` : "";
      return `<article ${attributes}>
        ${controls}
        <div class="card-inner">${cover}<div class="card-content"><div class="card-kicker" contenteditable="true" data-field="kicker" spellcheck="false">${escapeHTML(card.kicker)}</div><div class="card-title" contenteditable="true" data-field="title" spellcheck="false">${escapeHTML(card.title)}</div><div class="card-body" contenteditable="true" data-field="body" spellcheck="false">${escapeHTML(card.body)}</div>${tag}</div></div>${resize}
      </article>`;
    }).join("") || `<div class="empty-board"><strong>Uma página em branco, infinitas possibilidades.</strong><p>Adicione uma nota pela barra abaixo e comece a dar forma às suas ideias.</p></div>`;
    $("#card-count").textContent = `${board.cards.length} ${board.cards.length === 1 ? "ITEM" : "ITENS"}`;
    loadMedia(cardsElement);
    for (const card of board.cards) {
      const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
      if (card.type === "image") applyImageFrame(card, element);
      applyAppearance(card, element);
    }
    requestAnimationFrame(renderConnections);
  }

  function applyImageFrame(card, element) {
    const frame = element?.querySelector(".image-frame");
    const image = frame?.querySelector(".attached-image");
    if (!frame || !image) return;
    const active = Number.isFinite(card.frameHeight) && card.frameHeight >= 40;
    frame.classList.toggle("image-frame-adjusted", active);
    frame.style.height = active ? `${card.frameHeight}px` : "";
    if (active) setImageFrameStyle(image, card);
    else { image.style.objectPosition = ""; image.style.transform = ""; }
  }

  const appearanceFonts = {
    "dm-sans": '"DM Sans", sans-serif', manrope: 'Manrope, sans-serif',
    arial: 'Arial, sans-serif', georgia: 'Georgia, serif',
    times: '"Times New Roman", serif', courier: '"Courier New", monospace'
  };
  const appearanceTextTypes = new Set(["text", "note", "sticky", "heading", "photo", "folder", "document", "video"]);
  const appearanceTextSelector = ".rich-text, .card-kicker, .card-title, .card-body, .card-meta, .folder-label, .folder-count, .attachment-kind, .attachment-name, .attachment-size, .attachment-download";
  const isAppearanceColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  const isAppearanceOpacity = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

  function defaultBackgroundColor(element) {
    const color = getComputedStyle(element).backgroundColor;
    const components = color.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
    if (!components || Number(components[4] ?? 1) === 0) return null;
    return `#${components.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
  }

  function applyAppearance(card, element) {
    if (!element) return;
    const style = card.appearance || {};
    const background = isAppearanceColor(style.background) ? style.background : "";
    element.style.backgroundColor = card.type === "shape" ? "" : background;
    const shape = element.querySelector(".shape-image");
    if (shape) {
      shape.style.color = background || (/^#[0-9a-f]{6}$/i.test(card.color) ? card.color : "#8e77aa");
      shape.style.fillOpacity = isAppearanceOpacity(style.backgroundOpacity) ? style.backgroundOpacity / 100 : "";
    } else if (isAppearanceOpacity(style.backgroundOpacity)) {
      const base = background || defaultBackgroundColor(element) || "#ffffff";
      const red = parseInt(base.slice(1, 3), 16);
      const green = parseInt(base.slice(3, 5), 16);
      const blue = parseInt(base.slice(5, 7), 16);
      element.style.backgroundColor = `rgba(${red}, ${green}, ${blue}, ${style.backgroundOpacity / 100})`;
    }
    for (const text of element.querySelectorAll(appearanceTextSelector)) {
      text.style.fontFamily = Object.hasOwn(appearanceFonts, style.font) ? appearanceFonts[style.font] : "";
      text.style.color = isAppearanceColor(style.color) ? style.color : "";
      text.style.fontWeight = typeof style.bold === "boolean" ? (style.bold ? "bold" : "normal") : "";
      text.style.fontStyle = typeof style.italic === "boolean" ? (style.italic ? "italic" : "normal") : "";
      text.style.textDecoration = typeof style.underline === "boolean" ? (style.underline ? "underline" : "none") : "";
    }
  }

  function openAppearance(card) {
    appearanceCard = { card, board: currentCanvas(), owner: account };
    const style = card.appearance || {};
    const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
    const opacity = isAppearanceOpacity(style.backgroundOpacity) ? style.backgroundOpacity : card.type === "shape" ? 20 : 100;
    $("#appearance-background").value = isAppearanceColor(style.background) ? style.background :
      card.type === "shape" && isAppearanceColor(card.color) ? card.color : defaultBackgroundColor(element) || "#ffffff";
    $("#appearance-opacity").value = String(opacity);
    $("#appearance-opacity-value").textContent = `${opacity}%`;
    $("#appearance-font").value = Object.hasOwn(appearanceFonts, style.font) ? style.font : "";
    $("#appearance-color").value = isAppearanceColor(style.color) ? style.color : "#292834";
    for (const key of ["bold", "italic", "underline"]) $(`#appearance-${key}`).checked = style[key] === true;
    $("#appearance-text-options").hidden = !appearanceTextTypes.has(card.type);
    $("#appearance-dialog").showModal();
  }

  function currentAppearance() {
    if (!appearanceCard || appearanceCard.owner !== account || !currentBoard() ||
        currentCanvas() !== appearanceCard.board || !appearanceCard.board.cards.includes(appearanceCard.card)) {
      if ($("#appearance-dialog").open) $("#appearance-dialog").close();
      appearanceCard = null;
      showToast("O quadro mudou. Abra novamente a aparência.");
      return null;
    }
    return appearanceCard;
  }

  function changeAppearance(change) {
    const current = currentAppearance();
    if (!current) return;
    const style = { ...current.card.appearance };
    change(style);
    if (Object.keys(style).length) current.card.appearance = style;
    else delete current.card.appearance;
    applyAppearance(current.card, cardsElement.querySelector(`[data-card-id="${CSS.escape(current.card.id)}"]`));
    renderConnections();
    save();
  }

  $("#appearance-background").addEventListener("input", (event) => {
    if (isAppearanceColor(event.target.value)) changeAppearance((style) => { style.background = event.target.value; });
  });
  $("#appearance-opacity").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!isAppearanceOpacity(value)) return;
    changeAppearance((style) => { style.backgroundOpacity = value; });
    $("#appearance-opacity-value").textContent = `${value}%`;
  });
  $("#appearance-background-reset").addEventListener("click", () => {
    const current = currentAppearance();
    if (!current) return;
    changeAppearance((style) => { delete style.background; delete style.backgroundOpacity; });
    const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(current.card.id)}"]`);
    $("#appearance-background").value = current.card.type === "shape" && isAppearanceColor(current.card.color) ?
      current.card.color : defaultBackgroundColor(element) || "#ffffff";
    const opacity = current.card.type === "shape" ? 20 : 100;
    $("#appearance-opacity").value = String(opacity);
    $("#appearance-opacity-value").textContent = `${opacity}%`;
  });
  $("#appearance-font").addEventListener("change", (event) => {
    const value = event.target.value;
    if (value && !Object.hasOwn(appearanceFonts, value)) return;
    changeAppearance((style) => { if (value) style.font = value; else delete style.font; });
  });
  $("#appearance-color").addEventListener("input", (event) => {
    if (isAppearanceColor(event.target.value)) changeAppearance((style) => { style.color = event.target.value; });
  });
  $("#appearance-color-reset").addEventListener("click", () => {
    changeAppearance((style) => { delete style.color; });
    $("#appearance-color").value = "#292834";
  });
  for (const key of ["bold", "italic", "underline"]) {
    $(`#appearance-${key}`).addEventListener("change", (event) => {
      changeAppearance((style) => { style[key] = event.target.checked; });
    });
  }
  $("#appearance-text-reset").addEventListener("click", () => {
    changeAppearance((style) => {
      for (const key of ["font", "color", "bold", "italic", "underline"]) delete style[key];
    });
    $("#appearance-font").value = "";
    $("#appearance-color").value = "#292834";
    for (const key of ["bold", "italic", "underline"]) $(`#appearance-${key}`).checked = false;
  });
  $("#appearance-close").addEventListener("click", () => $("#appearance-dialog").close());
  $("#appearance-dialog").addEventListener("close", () => { appearanceCard = null; });

  function setImageFrameStyle(image, card) {
    const x = Number.isFinite(card.frameX) ? Math.min(100, Math.max(0, card.frameX)) : 50;
    const y = Number.isFinite(card.frameY) ? Math.min(100, Math.max(0, card.frameY)) : 50;
    const scale = Number.isFinite(card.frameZoom) ? Math.min(3, Math.max(1, card.frameZoom)) : 1;
    image.style.objectPosition = `${x}% ${y}%`;
    image.style.transform = `translate(${(50 - x) * (scale - 1)}%, ${(50 - y) * (scale - 1)}%) scale(${scale})`;
  }

  function openImageFrame(card, element) {
    framingCard = { card, board: currentCanvas(), owner: account };
    $("#image-frame-zoom").value = String(Math.round((card.frameZoom ?? 1) * 100));
    $("#image-frame-x").value = String(card.frameX ?? 50);
    $("#image-frame-y").value = String(card.frameY ?? 50);
    framingCard.initialHeight = Math.max(40, element.querySelector(".image-frame").offsetHeight);
    $("#image-frame-preview img").src = element.querySelector(".attached-image").src;
    updateFramePreview(framingCard);
    $("#image-frame-dialog").showModal();
  }

  function updateFramePreview(framing) {
    const card = framing.card;
    const preview = $("#image-frame-preview");
    const image = preview.querySelector("img");
    const height = card.frameHeight ?? framing.initialHeight;
    preview.style.aspectRatio = `${card.width} / ${height}`;
    preview.style.width = `${Math.min(400, Math.max(1, card.width / height * 180))}px`;
    image.style.objectFit = card.frameHeight === undefined ? "contain" : "cover";
    setImageFrameStyle(image, card);
  }

  function currentFraming() {
    if (!framingCard || framingCard.owner !== account || !currentBoard() ||
        currentCanvas() !== framingCard.board || !framingCard.board.cards.includes(framingCard.card)) {
      $("#image-frame-dialog").close();
      framingCard = null;
      showToast("O quadro mudou. Abra novamente o enquadramento.");
      return null;
    }
    return framingCard;
  }

  for (const selector of ["#image-frame-zoom", "#image-frame-x", "#image-frame-y"]) {
    $(selector).addEventListener("input", () => {
      const framing = currentFraming();
      if (!framing) return;
      const card = framing.card;
      card.frameHeight = card.frameHeight ?? framing.initialHeight;
      card.frameZoom = Number($("#image-frame-zoom").value) / 100;
      card.frameX = Number($("#image-frame-x").value);
      card.frameY = Number($("#image-frame-y").value);
      applyImageFrame(card, cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`));
      updateFramePreview(framing);
      renderConnections();
      save();
    });
  }
  $("#image-frame-reset").addEventListener("click", () => {
    const framing = currentFraming();
    if (!framing) return;
    delete framing.card.frameHeight;
    delete framing.card.frameZoom;
    delete framing.card.frameX;
    delete framing.card.frameY;
    $("#image-frame-zoom").value = "100";
    $("#image-frame-x").value = "50";
    $("#image-frame-y").value = "50";
    applyImageFrame(framing.card, cardsElement.querySelector(`[data-card-id="${CSS.escape(framing.card.id)}"]`));
    updateFramePreview(framing);
    renderConnections();
    save();
  });
  $("#image-frame-close").addEventListener("click", () => $("#image-frame-dialog").close());
  $("#image-frame-dialog").addEventListener("close", () => { framingCard = null; });

  function formatFileSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderConnections() {
    const board = currentCanvas();
    const overlay = [];
    const controls = [];
    if (selectedConnection && !board.connections.includes(selectedConnection)) clearConnectionSelection();
    linesElement.innerHTML = board.connections.map((connection, index) => {
      const from = board.cards.find((card) => card.id === connection.from);
      const to = board.cards.find((card) => card.id === connection.to);
      const fromEl = cardsElement.querySelector(`[data-card-id="${CSS.escape(connection.from)}"]`);
      const toEl = cardsElement.querySelector(`[data-card-id="${CSS.escape(connection.to)}"]`);
      if (!from || !to || !fromEl || !toEl) return "";
      const fromHeight = fromEl.offsetHeight;
      const toHeight = toEl.offsetHeight;
      const validPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
      const fixedPoints = validPoint(connection.fromPoint) && validPoint(connection.toPoint);
      let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
      if (fixedPoints) {
        x1 = from.x + fromEl.offsetWidth * connection.fromPoint.x;
        y1 = from.y + fromHeight * connection.fromPoint.y;
        x2 = to.x + toEl.offsetWidth * connection.toPoint.x;
        y2 = to.y + toHeight * connection.toPoint.y;
        const deltaX = x2 - x1;
        const deltaY = y2 - y1;
        const bend = Math.max(15, Math.min(120, Math.hypot(deltaX, deltaY) / 3));
        const angle = Math.atan2(deltaY, deltaX);
        const ux = Math.cos(angle), uy = Math.sin(angle);
        c1x = x1 + bend * ux; c1y = y1 + bend * uy;
        c2x = x2 - bend * ux; c2y = y2 - bend * uy;
      } else {
        const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
        const dy = (to.y + toHeight / 2) - (from.y + fromHeight / 2);
        if (Math.abs(dx) > Math.abs(dy)) {
          x1 = dx > 0 ? from.x + from.width : from.x;
          x2 = dx > 0 ? to.x : to.x + to.width;
          y1 = from.y + fromHeight / 2; y2 = to.y + toHeight / 2;
          const bend = Math.max(45, Math.abs(x2 - x1) / 2) * Math.sign(dx);
          c1x = x1 + bend; c1y = y1; c2x = x2 - bend; c2y = y2;
        } else {
          x1 = from.x + from.width / 2; x2 = to.x + to.width / 2;
          y1 = dy > 0 ? from.y + fromHeight : from.y;
          y2 = dy > 0 ? to.y : to.y + toHeight;
          const bend = Math.max(45, Math.abs(y2 - y1) / 2) * Math.sign(dy);
          c1x = x1; c1y = y1 + bend; c2x = x2; c2y = y2 - bend;
        }
      }
      if (connection.curve && Number.isFinite(connection.curve.x) && Number.isFinite(connection.curve.y)) {
        c1x += connection.curve.x * 4 / 3; c1y += connection.curve.y * 4 / 3;
        c2x += connection.curve.x * 4 / 3; c2y += connection.curve.y * 4 / 3;
      }
      let path = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
      let middleX = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
      let middleY = (y1 + 3 * c1y + 3 * c2y + y2) / 8;
      const points = Array.isArray(connection.curvePoints) && connection.curvePoints.every((point, i, all) =>
        point && Number.isFinite(point.t) && point.t > 0 && point.t < 1 &&
        Number.isFinite(point.x) && Number.isFinite(point.y) && (!i || all[i - 1].t < point.t))
        ? connection.curvePoints : [];
      const anchors = points.map((point) => ({
        x: x1 + (x2 - x1) * point.t + point.x,
        y: y1 + (y2 - y1) * point.t + point.y
      }));
      if (anchors.length) {
        const nodes = [{ x: x1, y: y1 }, ...anchors, { x: x2, y: y2 }];
        path = `M ${x1} ${y1}`;
        for (let i = 0; i < nodes.length - 1; i++) {
          const previous = nodes[Math.max(0, i - 1)];
          const current = nodes[i];
          const next = nodes[i + 1];
          const after = nodes[Math.min(nodes.length - 1, i + 2)];
          path += ` C ${current.x + (next.x - previous.x) / 6} ${current.y + (next.y - previous.y) / 6}, ${next.x - (after.x - current.x) / 6} ${next.y - (after.y - current.y) / 6}, ${next.x} ${next.y}`;
        }
        const center = anchors[Math.floor(anchors.length / 2)];
        middleX = center.x; middleY = center.y;
      }
      if (fixedPoints) overlay.push(`<path class="connection-path" d="${path}"></path>`);
      controls.push(`<path class="connection-hit" data-connection-index="${index}" d="${path}" tabindex="${mode === "select" ? "0" : "-1"}" role="button" aria-label="Editar seta"></path>`);
      if (typeof connection.label === "string" && connection.label) {
        controls.push(`<text class="connection-label" x="${middleX}" y="${middleY}" text-anchor="middle" dominant-baseline="middle">${escapeHTML(connection.label)}</text>`);
      }
      if (connection === selectedConnection) {
        controls.push(`<circle class="connection-endpoint" data-connection-endpoint="from" cx="${x1}" cy="${y1}" r="${8 / zoom}" aria-label="Arrastar origem da seta"></circle>`);
        controls.push(`<circle class="connection-endpoint" data-connection-endpoint="to" cx="${x2}" cy="${y2}" r="${8 / zoom}" aria-label="Arrastar destino da seta"></circle>`);
        const handles = anchors.length ? anchors : [{ x: middleX, y: middleY }];
        handles.forEach((point, i) => controls.push(`<circle class="connection-handle${selectedCurvePoint === i ? " point-selected" : ""}" data-connection-handle data-point-index="${anchors.length ? i : -1}" cx="${point.x}" cy="${point.y}" r="${8 / zoom}" tabindex="0" role="button" aria-label="Ajustar ponto ${i + 1} da curva com as setas do teclado ou arrastar"></circle>`));
      }
      return fixedPoints ? "" : `<path class="connection-path" d="${path}"></path>`;
    }).join("");
    $("#connection-point-lines").innerHTML = overlay.join("");
    $("#connection-controls").innerHTML = controls.join("");
  }

  function updateTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    world.style.setProperty("--control-scale", 1 / zoom);
    $("#connection-controls").querySelectorAll("[data-connection-handle], [data-connection-endpoint]").forEach((element) => element.setAttribute("r", 8 / zoom));
    $("#zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  }

  function clearConnectionSelection() {
    selectedConnection = null;
    selectedCurvePoint = null;
    $("#connection-options").hidden = true;
  }

  function selectConnection(connection) {
    selectedConnection = connection;
    selectedCurvePoint = null;
    $("#connection-remove-point").disabled = true;
    selectedId = null;
    selectedIds.clear();
    hideFormatting();
    updateSelectionVisual();
    $("#connection-label").value = typeof connection.label === "string" ? connection.label : "";
    $("#connection-options").hidden = false;
    renderConnections();
  }

  function fitBoard(minimumZoom = 0) {
    const cards = currentCanvas().cards;
    if (!cards.length) {
      zoom = 1;
      pan = { x: 0, y: 0 };
    } else {
      const left = Math.min(...cards.map((card) => card.x));
      const top = Math.min(...cards.map((card) => card.y));
      const right = Math.max(...cards.map((card) => card.x + card.width));
      const bottom = Math.max(...cards.map((card) => {
        const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
        return card.y + (element ? element.offsetHeight : 0);
      }));
      const availableWidth = Math.max(100, viewport.clientWidth - 48);
      const availableHeight = Math.max(100, viewport.clientHeight - 140);
      zoom = Math.max(minimumZoom, Math.min(1, availableWidth / Math.max(1, right - left), availableHeight / Math.max(1, bottom - top)));
      pan = { x: (viewport.clientWidth - (right - left) * zoom) / 2 - left * zoom, y: 55 - top * zoom };
    }
    updateTransform();
  }

  function initialView() {
    viewWidth = viewport.clientWidth;
    zoom = 1;
    pan = { x: 0, y: 0 };
    if (viewport.clientWidth > 0 && mobileCanvas.matches && currentCanvas().cards.length) {
      const card = currentCanvas().cards.reduce((first, item) =>
        item.x < first.x || (item.x === first.x && item.y < first.y) ? item : first);
      const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
      const width = element?.offsetWidth || card.width;
      zoom = Math.max(0.85, Math.min(1, (viewport.clientWidth - 32) / Math.max(1, width)));
      pan = { x: 16 - card.x * zoom, y: 40 - card.y * zoom };
      updateTransform();
      return;
    }
    updateTransform();
  }

  function setMode(nextMode) {
    hideFormatting();
    clearConnectionSelection();
    mode = nextMode;
    world.dataset.mode = mode;
    connectionStart = null;
    $("#select-tool").classList.toggle("active", mode === "select");
    $("#hand-tool").classList.toggle("active", mode === "hand");
    $("#connect-tool").classList.toggle("active", mode === "connect");
    $("#area-tool").classList.toggle("active", mode === "area");
    $("#shape-tool").classList.toggle("active", mode === "shape");
    $("#draw-tool").classList.toggle("active", mode === "draw");
    $("#drawing-options").hidden = !["shape", "draw"].includes(mode);
    $("#shape-option").hidden = mode !== "shape";
    $("#brush-option").hidden = mode !== "draw";
    $("#brush-size-option").hidden = mode !== "draw";
    $("#drawing-hint").textContent = mode === "shape" ? "Arraste para criar uma forma." : mode === "draw" ? "Arraste para desenhar." : "";
    viewport.style.cursor = mode === "hand" ? "grab" : ["connect", "area", "shape", "draw"].includes(mode) ? "crosshair" : "default";
    renderCards();
  }

  function addCard(type) {
    const centerX = (viewport.clientWidth / 2 - pan.x) / zoom;
    const centerY = (viewport.clientHeight / 2 - pan.y) / zoom;
    const templates = {
      note: { kicker: "NOVA NOTA", title: "Uma nova ideia", body: "Clique aqui para escrever seus pensamentos.", width: 230 },
      sticky: { kicker: "LEMBRETE", title: "Não esqueça", body: "Escreva algo importante aqui.", width: 200 },
      heading: { kicker: "NOVA SEÇÃO", title: "Dê um título à sua ideia", body: "Adicione uma descrição.", width: 230 },
      text: { html: "Escreva seu texto aqui.", width: 260 },
      folder: { title: "Nova pasta", cards: [], connections: [], width: 220 }
    };
    const card = { id: id(), type, x: Math.max(0, Math.round(centerX - 100)), y: Math.max(0, Math.round(centerY - 60)), ...templates[type] };
    currentCanvas().cards.push(card);
    selectedIds.clear();
    selectedId = card.id;
    setMode("select");
    save();
    const title = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"] [data-field="${type === "text" ? "html" : "title"}"]`);
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function removeCard(cardId) {
    const board = currentCanvas();
    const removedCard = board.cards.find((card) => card.id === cardId);
    if (removedCard && removedCard.type === "folder" && removedCard.cards.length && !window.confirm("Excluir esta pasta e todo o seu conteúdo? Esta ação não pode ser desfeita.")) return;
    const oldCards = board.cards;
    const oldConnections = board.connections;
    board.cards = board.cards.filter((card) => card.id !== cardId);
    board.connections = board.connections.filter((connection) => connection.from !== cardId && connection.to !== cardId);
    selectedId = null;
    selectedIds.clear();
    connectionStart = null;
    hideFormatting();
    renderCards();
    if (save()) {
      const removeFiles = (card) => {
        if (card.imageId) removeMedia(card.imageId);
        if (card.fileId) removeMedia(card.fileId);
        if (card.type === "folder") card.cards.forEach(removeFiles);
      };
      if (removedCard) removeFiles(removedCard);
      showToast("Item excluído.");
    } else {
      board.cards = oldCards;
      board.connections = oldConnections;
      renderCards();
    }
  }

  function deleteSelection() {
    if (selectedIds.size <= 1) {
      if (selectedId) removeCard(selectedId);
      else showToast("Selecione um item primeiro.");
      return;
    }
    if (!window.confirm(`Excluir ${selectedIds.size} itens selecionados, incluindo o conteúdo das pastas?`)) return;
    const board = currentCanvas();
    const removed = board.cards.filter((card) => selectedIds.has(card.id));
    const oldCards = board.cards;
    const oldConnections = board.connections;
    board.cards = board.cards.filter((card) => !selectedIds.has(card.id));
    board.connections = board.connections.filter((connection) => !selectedIds.has(connection.from) && !selectedIds.has(connection.to));
    if (!save()) {
      board.cards = oldCards;
      board.connections = oldConnections;
      return;
    }
    const removeFiles = (card) => {
      if (card.imageId) removeMedia(card.imageId);
      if (card.fileId) removeMedia(card.fileId);
      if (card.type === "folder") card.cards.forEach(removeFiles);
    };
    removed.forEach(removeFiles);
    selectedIds.clear();
    selectedId = null;
    connectionStart = null;
    hideFormatting();
    renderCards();
    showToast("Itens excluídos.");
  }

  function connectCard(cardId, point) {
    if (!connectionStart) {
      connectionStart = { id: cardId, point };
      selectedId = cardId;
      cardsElement.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`)?.classList.add("connect-source");
      showToast("Agora escolha um ponto no elemento de destino.");
      return;
    }
    if (connectionStart.id === cardId) {
      showToast("Escolha outro elemento para conectar.");
      return;
    }
    const board = currentCanvas();
    const connection = { from: connectionStart.id, to: cardId, fromPoint: connectionStart.point, toPoint: point };
    board.connections.push(connection);
    if (!save()) {
      board.connections.pop();
      showToast("Não foi possível salvar a conexão.");
      return;
    }
    showToast("Elementos conectados!");
    selectedId = cardId;
    setMode("select");
  }

  function createBoard() {
    const board = { id: id(), title: "Novo quadro", cards: [], connections: [] };
    state.boards.push(board);
    state.activeBoardId = board.id;
    folderPath = [];
    document.body.classList.remove("show-home");
    $("#home").hidden = true;
    $("#export").hidden = false;
    selectedId = null;
    selectedIds.clear();
    zoom = 1; pan = { x: 0, y: 0 };
    updateTransform();
    renderBoards();
    setMode("select");
    save();
    $("#board-title").focus();
    const range = document.createRange();
    range.selectNodeContents($("#board-title"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function deleteBoard(boardId) {
    const board = state.boards.find((item) => item.id === boardId);
    if (!board) return;
    if (!window.confirm(`Excluir o quadro "${board.title}" e seu conteúdo deste navegador? Esta ação não pode ser desfeita. Os arquivos anexados permanecerão no armazenamento local.`)) return;
    const previousBoards = state.boards;
    const previousActiveBoardId = state.activeBoardId;
    state.boards = state.boards.filter((item) => item.id !== boardId);
    if (state.activeBoardId === boardId) state.activeBoardId = state.boards[0]?.id || null;
    if (!save()) {
      state.boards = previousBoards;
      state.activeBoardId = previousActiveBoardId;
      return;
    }
    folderPath = [];
    selectedId = null;
    selectedIds.clear();
    connectionStart = null;
    renderBoards();
    showHome();
    showToast("Quadro excluído deste navegador. Os arquivos foram preservados.");
  }

  $("#new-board").addEventListener("click", createBoard);
  $("#new-board-secondary").addEventListener("click", createBoard);
  $("#home-new-board").addEventListener("click", createBoard);
  $("#home-link").addEventListener("click", (event) => { event.preventDefault(); showHome(); });
  $("#home-grid").addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-board]");
    const cover = event.target.closest("[data-cover-board]");
    const remove = event.target.closest("[data-delete-board]");
    if (open) openBoard(open.dataset.openBoard);
    if (cover) { coverBoardId = cover.dataset.coverBoard; $("#cover-input").click(); }
    if (remove) deleteBoard(remove.dataset.deleteBoard);
    if (event.target.closest("#home-create")) createBoard();
  });
  $("#cover-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    const board = state.boards.find((item) => item.id === coverBoardId);
    coverBoardId = null;
    if (!file || !board) return;
    try {
      const key = await storeImage(file);
      if (!state.boards.includes(board)) {
        showToast("O quadro foi excluído. A imagem carregada permanece no armazenamento local.");
        return;
      }
      const oldCover = board.coverId;
      board.coverId = key;
      if (!save()) {
        board.coverId = oldCover;
        await removeMedia(key);
        return;
      }
      if (oldCover) removeMedia(oldCover);
      if (!$("#home").hidden) renderHome();
      showToast("Capa atualizada.");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#board-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-board-id]");
    if (!button) return;
    openBoard(button.dataset.boardId);
  });
  $("#board-title").addEventListener("input", (event) => {
    currentCanvas().title = event.target.textContent.trim() || "Sem título";
    if (folderPath.length) {
      $("#breadcrumb-title").textContent = `${currentBoard().title} / ${currentCanvas().title}`;
      save();
      return;
    }
    $("#breadcrumb-title").textContent = currentBoard().title;
    const activeLabel = $("#board-list .active span");
    if (activeLabel) {
      activeLabel.textContent = currentBoard().title;
      activeLabel.parentElement.setAttribute("aria-label", currentBoard().title);
    }
    save();
  });
  $("#board-title").addEventListener("blur", (event) => { event.target.textContent = currentCanvas().title; renderCanvasTitle(); });
  $("#board-title").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); event.target.blur(); } });
  $("#add-note").addEventListener("click", () => addCard("note"));
  $("#add-note-header").addEventListener("click", () => addCard("note"));
  $("#add-sticky").addEventListener("click", () => addCard("sticky"));
  $("#add-heading").addEventListener("click", () => addCard("heading"));
  $("#add-text").addEventListener("click", () => addCard("text"));
  $("#add-folder").addEventListener("click", () => addCard("folder"));
  $("#folder-back").addEventListener("click", () => {
    folderPath.pop();
    selectedId = null;
    selectedIds.clear();
    renderCanvasTitle();
    setMode("select");
    initialView();
  });
  $("#theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    updateTheme();
    save();
  });
  $("#add-image").addEventListener("click", () => $("#image-input").click());
  $("#add-document").addEventListener("click", () => $("#document-input").click());
  $("#add-video").addEventListener("click", () => $("#video-input").click());
  async function attachFile(event, type) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const board = currentCanvas();
    const rootBoard = currentBoard();
    const x = Math.max(0, Math.round((viewport.clientWidth / 2 - pan.x) / zoom - 130));
    const y = Math.max(0, Math.round((viewport.clientHeight / 2 - pan.y) / zoom - 80));
    try {
      if (type !== "image") {
        const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
        const supported = type === "document" ? DOCUMENT_EXTENSIONS : VIDEO_EXTENSIONS;
        if (!supported.has(extension)) throw new Error(type === "document" ? "Formato de documento não suportado." : "Use um vídeo MP4, WebM ou MOV.");
        if (file.size > MAX_ATTACHMENT_SIZE) throw new Error("Escolha um arquivo de até 100 MB.");
      }
      const fileId = type === "image" ? await storeImage(file) : await storeFile(file);
      const containsCanvas = (canvas) => canvas === board || canvas.cards.some((card) => card.type === "folder" && containsCanvas(card));
      if (!state.boards.includes(rootBoard) || !containsCanvas(rootBoard)) {
        await removeMedia(fileId);
        showToast("A pasta foi excluída antes de o arquivo ser salvo.");
        return;
      }
      const card = type === "image"
        ? { id: id(), type, x, y, width: 260, imageId: fileId, alt: file.name }
        : { id: id(), type, x, y, width: type === "video" ? 320 : 260, fileId, name: file.name, size: file.size };
      board.cards.push(card);
      if (!save()) {
        board.cards.pop();
        await removeMedia(fileId);
        return;
      }
      if (currentCanvas() === board && $("#home").hidden) {
        selectedId = card.id;
        selectedIds.clear();
        setMode("select");
      }
    } catch (error) {
      showToast(error.message);
    }
  }
  $("#image-input").addEventListener("change", (event) => attachFile(event, "image"));
  $("#document-input").addEventListener("change", (event) => attachFile(event, "document"));
  $("#video-input").addEventListener("change", (event) => attachFile(event, "video"));
  document.addEventListener("selectionchange", rememberTextSelection);
  $("#format-toolbar").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  $("#format-toolbar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (button) formatText(button.dataset.command);
  });
  $("#text-color").addEventListener("input", (event) => formatText("foreColor", event.target.value));
  $("#text-size").addEventListener("change", (event) => {
    if (event.target.value) formatText("fontSize", event.target.value);
    event.target.value = "";
  });
  $("#select-tool").addEventListener("click", () => setMode("select"));
  $("#mobile-controls-open").addEventListener("click", () => document.body.classList.add("mobile-controls-visible"));
  $("#mobile-controls-close").addEventListener("click", () => document.body.classList.remove("mobile-controls-visible"));
  $("#hand-tool").addEventListener("click", () => setMode("hand"));
  $("#area-tool").addEventListener("click", () => setMode("area"));
  $("#shape-tool").addEventListener("click", () => setMode("shape"));
  $("#draw-tool").addEventListener("click", () => setMode("draw"));
  $("#brush-size").addEventListener("input", (event) => { $("#brush-size-value").textContent = event.target.value; });
  $("#connect-tool").addEventListener("click", () => { setMode("connect"); showToast("Escolha um ponto no elemento de origem."); });
  $("#connection-label").addEventListener("input", (event) => {
    if (!selectedConnection) return;
    selectedConnection.label = event.target.value;
    renderConnections();
    save();
  });
  $("#connection-add-point").addEventListener("click", () => {
    if (!selectedConnection) return;
    const previous = selectedConnection.curvePoints;
    if (previous !== undefined && (!Array.isArray(previous) || previous.some((point, i) =>
      !point || !Number.isFinite(point.t) || point.t <= 0 || point.t >= 1 ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y) || (i && previous[i - 1].t >= point.t)))) {
      showToast("Não foi possível editar os pontos desta seta.");
      return;
    }
    const endpoints = [...$("#connection-controls").querySelectorAll("[data-connection-endpoint]")].map((element) => ({
      x: Number(element.getAttribute("cx")), y: Number(element.getAttribute("cy"))
    }));
    const handle = $("#connection-controls [data-connection-handle]");
    if (endpoints.length !== 2 || !handle) return;
    const points = previous?.length ? structuredClone(previous) : [{
      t: 0.5,
      x: Number(handle.getAttribute("cx")) - (endpoints[0].x + endpoints[1].x) / 2,
      y: Number(handle.getAttribute("cy")) - (endpoints[0].y + endpoints[1].y) / 2
    }];
    if (points.length >= 32) { showToast("A seta já possui 32 pontos."); return; }
    const after = selectedCurvePoint === null ? -1 : selectedCurvePoint;
    const left = after < 0 ? { t: 0, x: 0, y: 0 } : points[after];
    const right = points[after + 1] || { t: 1, x: 0, y: 0 };
    if (!left || right.t - left.t < 0.000001) { showToast("Não há espaço para outro ponto aqui."); return; }
    points.splice(after + 1, 0, { t: (left.t + right.t) / 2, x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    selectedConnection.curvePoints = points;
    if (!save()) {
      if (previous === undefined) delete selectedConnection.curvePoints;
      else selectedConnection.curvePoints = previous;
    } else {
      selectedCurvePoint = after + 1;
      $("#connection-remove-point").disabled = false;
    }
    renderConnections();
  });
  $("#connection-remove-point").addEventListener("click", () => {
    if (!selectedConnection || selectedCurvePoint === null || !Array.isArray(selectedConnection.curvePoints)) return;
    const previous = selectedConnection.curvePoints;
    const points = previous.filter((_, index) => index !== selectedCurvePoint);
    if (points.length) selectedConnection.curvePoints = points;
    else delete selectedConnection.curvePoints;
    if (!save()) selectedConnection.curvePoints = previous;
    else { selectedCurvePoint = null; $("#connection-remove-point").disabled = true; }
    renderConnections();
  });
  $("#connection-reset").addEventListener("click", () => {
    if (!selectedConnection || (!selectedConnection.curve && !selectedConnection.curvePoints)) return;
    const previous = selectedConnection.curve;
    const previousPoints = selectedConnection.curvePoints;
    delete selectedConnection.curve;
    delete selectedConnection.curvePoints;
    if (!save()) {
      if (previous !== undefined) selectedConnection.curve = previous;
      if (previousPoints !== undefined) selectedConnection.curvePoints = previousPoints;
    } else { selectedCurvePoint = null; $("#connection-remove-point").disabled = true; }
    renderConnections();
  });
  $("#connection-close").addEventListener("click", () => {
    clearConnectionSelection();
    renderConnections();
  });
  $("#connection-controls").addEventListener("keydown", (event) => {
    const hit = event.target.closest("[data-connection-index]");
    if (hit && mode === "select" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const connection = currentCanvas().connections[Number(hit.dataset.connectionIndex)];
      if (connection) {
        selectConnection(connection);
        $("#connection-label").focus();
      }
      return;
    }
    if (!event.target.matches("[data-connection-handle]") || !selectedConnection) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const index = Number(event.target.dataset.pointIndex);
    const previous = index < 0 ? selectedConnection.curve : selectedConnection.curvePoints;
    const curve = index < 0 ? (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y) ? previous : { x: 0, y: 0 }) : previous[index];
    if (!curve) return;
    const step = event.shiftKey ? 10 : 1;
    if (index < 0) selectedConnection.curve = { x: curve.x + direction[0] * step, y: curve.y + direction[1] * step };
    else {
      selectedCurvePoint = index;
      $("#connection-remove-point").disabled = false;
      selectedConnection.curvePoints = previous.map((point, i) => i === index ? { ...point, x: point.x + direction[0] * step, y: point.y + direction[1] * step } : point);
    }
    if (!save()) {
      if (index >= 0) selectedConnection.curvePoints = previous;
      else if (previous === undefined) delete selectedConnection.curve;
      else selectedConnection.curve = previous;
    }
    renderConnections();
    $(`#connection-controls [data-point-index="${index}"]`)?.focus();
  });
  $("#delete-tool").addEventListener("click", deleteSelection);
  $("#zoom-in").addEventListener("click", () => { zoom = Math.min(1.75, Math.round((zoom + 0.1) * 100) / 100); updateTransform(); });
  $("#zoom-out").addEventListener("click", () => { zoom = Math.max(0.2, Math.round((zoom - 0.1) * 100) / 100); updateTransform(); });
  $("#zoom-level").addEventListener("click", () => { zoom = 1; updateTransform(); });
  $("#fit-board").addEventListener("click", () => fitBoard());
  $("#export").addEventListener("click", async () => {
    const board = currentBoard();
    const exported = JSON.parse(JSON.stringify(board));
    try {
      const encode = async (key) => {
        const file = await mediaOperation("get", key);
        if (!file) throw new Error("Arquivo não encontrado.");
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      };
      if (exported.coverId) {
        exported.cover = await encode(exported.coverId);
        delete exported.coverId;
      }
      const encodeCards = async (cards) => {
        for (const card of cards) {
          if (card.imageId) {
            card.image = await encode(card.imageId);
            delete card.imageId;
          }
          if (card.fileId) {
            card.file = await encode(card.fileId);
            delete card.fileId;
          }
          if (card.type === "folder") await encodeCards(card.cards);
        }
      };
      await encodeCards(exported.cards);
    } catch (error) {
      console.error("Não foi possível exportar os arquivos:", error);
      showToast("Não foi possível exportar os arquivos do quadro.");
      return;
    }
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${board.title.replace(/[\\/:*?"<>|]/g, "-") || "quadro"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Quadro exportado.");
  });

  cardsElement.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    const cardElement = event.target.closest("[data-card-id]");
    if (!field || !cardElement) return;
    const card = currentCanvas().cards.find((item) => item.id === cardElement.dataset.cardId);
    if (!card) return;
    card[field] = field === "html" ? sanitizeRichText(event.target.innerHTML) : event.target.innerText;
    renderConnections();
    save();
  });
  cardsElement.addEventListener("paste", (event) => {
    if (!event.target.closest(".rich-text")) return;
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
  });
  cardsElement.addEventListener("load", (event) => {
    if (event.target.classList.contains("attached-image")) renderConnections();
  }, true);
  cardsElement.addEventListener("loadedmetadata", (event) => {
    if (event.target.classList.contains("attached-video")) renderConnections();
  }, true);
  cardsElement.addEventListener("error", (event) => {
    if (event.target.classList.contains("attached-video") && event.target.isConnected) {
      showToast("Não foi possível reproduzir este vídeo. Baixe o arquivo para abri-lo.");
    }
  }, true);
  cardsElement.addEventListener("click", (event) => {
    const cardElement = event.target.closest("[data-card-id]");
    if (!cardElement) return;
    const cardId = cardElement.dataset.cardId;
    if (mode === "connect") {
      selectedIds.clear();
      event.preventDefault();
      const rect = cardElement.getBoundingClientRect();
      const hasPointer = event.detail > 0 && rect.width > 0 && rect.height > 0;
      const clamp = (value) => Math.min(1, Math.max(0, value));
      const point = hasPointer
        ? { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
        : { x: 0.5, y: 0.5 };
      connectCard(cardId, point);
      return;
    }
    if (event.target.closest(".attachment-download")) {
      if (!event.target.closest(".attachment-download").getAttribute("href")) {
        event.preventDefault();
        showToast("O arquivo ainda não está disponível para download.");
      }
      return;
    }
    if (event.target.closest("video") && mode !== "connect") return;
    const action = event.target.closest("[data-action]");
    if (action) {
      event.stopPropagation();
      const card = currentCanvas().cards.find((item) => item.id === cardId);
      if (!card) return;
      if (action.dataset.action === "appearance") openAppearance(card);
      if (action.dataset.action === "frame" && card.type === "image") openImageFrame(card, cardElement);
      if (action.dataset.action === "text-smaller" || action.dataset.action === "text-larger") {
        const scale = Number.isFinite(card.textScale) ? card.textScale : 1;
        const direction = action.dataset.action === "text-larger" ? 0.1 : -0.1;
        card.textScale = Math.min(3, Math.max(0.5, Math.round((scale + direction) * 10) / 10));
        cardElement.style.setProperty("--text-scale", card.textScale);
        cardElement.setAttribute("data-text-scaled", "");
        renderConnections();
        save();
      }
      if (action.dataset.action === "delete") removeCard(cardId);
      if (action.dataset.action === "connect") { setMode("connect"); showToast("Escolha um ponto no elemento de origem."); }
      if (action.dataset.action === "open-folder" && mode !== "connect") {
        const folder = currentCanvas().cards.find((item) => item.id === cardId && item.type === "folder");
        if (!folder) return;
        folder.title = folder.title.trim() || "Sem título";
        folderPath.push(folder.id);
        selectedId = null;
        selectedIds.clear();
        renderCanvasTitle();
        setMode("select");
        initialView();
      }
      return;
    }
    if (mode !== "select") return;
    if (selectedIds.size > 1 && selectedIds.has(cardId)) return;
    if (selectedId !== cardId) {
      if (activeTextId !== cardId) hideFormatting();
      selectedId = cardId;
      selectedIds = new Set([cardId]);
      cardsElement.querySelectorAll(".card").forEach((el) => el.classList.toggle("selected", el.dataset.cardId === cardId));
    }
  });
  cardsElement.addEventListener("keydown", (event) => {
    if (mode !== "connect" || !["Enter", " "].includes(event.key) || !event.target.matches("[data-card-id]")) return;
    event.preventDefault();
    connectCard(event.target.dataset.cardId, { x: 0.5, y: 0.5 });
  });
  function worldPoint(event) {
    const bounds = viewport.getBoundingClientRect();
    return { x: Math.max(0, (event.clientX - bounds.left - pan.x) / zoom), y: Math.max(0, (event.clientY - bounds.top - pan.y) / zoom) };
  }

  function updateSelectionVisual() {
    cardsElement.querySelectorAll(".card").forEach((el) => el.classList.toggle("selected", selectedIds.has(el.dataset.cardId)));
  }

  function showSelectionBox(start, end) {
    const box = $("#selection-area");
    box.hidden = false;
    box.style.left = `${Math.min(start.x, end.x)}px`;
    box.style.top = `${Math.min(start.y, end.y)}px`;
    box.style.width = `${Math.abs(end.x - start.x)}px`;
    box.style.height = `${Math.abs(end.y - start.y)}px`;
  }

  function startItemResize(card, element, pointerId, x, y) {
    return { type: "resize-item", pointerId, card, element, startX: x, startY: y, width: card.width,
      frameHeight: card.frameHeight, initialFrameHeight: element.querySelector(".image-frame")?.offsetHeight,
      mediaResized: card.mediaResized, minHeight: card.minHeight, initialHeight: element.offsetHeight,
      videoHeight: card.videoHeight, initialVideoHeight: element.querySelector("video")?.offsetHeight };
  }

  function updateItemResize(active, dx, dy) {
    if (dx === 0 && dy === 0) return;
    active.changed = true;
    if (account) accountEpoch += 1;
    active.card.width = Math.max(100, Math.round(active.width + dx / zoom));
    active.element.style.width = `${active.card.width}px`;
    if (active.card.type === "video") {
      active.card.mediaResized = true;
      active.element.setAttribute("data-media-resized", "");
      if (dy !== 0) {
        active.card.videoHeight = Math.max(40, Math.round(active.initialVideoHeight + dy / zoom));
        active.element.querySelector("video").style.height = `${active.card.videoHeight}px`;
      }
    }
    if (active.card.type === "image") {
      active.card.frameHeight = Math.max(40, Math.round(active.initialFrameHeight + dy / zoom));
      applyImageFrame(active.card, active.element);
    } else if (active.card.type !== "video" && dy !== 0) {
      active.card.minHeight = Math.max(40, Math.round(active.initialHeight + dy / zoom));
      active.element.style.minHeight = `${active.card.minHeight}px`;
    }
    renderConnections();
  }

  viewport.addEventListener("pointerdown", (event) => {
    if (!mobileCanvas.matches || event.pointerType !== "touch" || !$("#home").hidden) return;
    menuTouches.set(event.pointerId, { x: event.clientX, y: event.clientY, target: event.target, moved: false });
    if (menuTouches.size > 1) multiTouchMenuGesture = true;
  }, true);
  viewport.addEventListener("pointermove", (event) => {
    const touch = menuTouches.get(event.pointerId);
    if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) touch.moved = true;
  }, true);
  function finishMenuTouch(event) {
    const touch = menuTouches.get(event.pointerId);
    if (!touch) return;
    menuTouches.delete(event.pointerId);
    const multiple = multiTouchMenuGesture;
    if (!menuTouches.size) multiTouchMenuGesture = false;
    if (event.type !== "pointerup" || touch.moved || multiple ||
        !["select", "hand"].includes(mode) ||
        touch.target.closest("[contenteditable], button, a, input, select, video, [data-connection-handle], [data-connection-endpoint], [data-connection-index]")) return;
    const visible = document.body.classList.contains("mobile-controls-visible");
    if (!visible || !touch.target.closest("[data-card-id]")) {
      document.body.classList.toggle("mobile-controls-visible", !visible);
    }
  }
  viewport.addEventListener("pointerup", finishMenuTouch, true);
  viewport.addEventListener("pointercancel", finishMenuTouch, true);

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (interaction && ["connection-curve", "connection-endpoint"].includes(interaction.type)) return;
    const handle = event.target.closest("[data-connection-handle]");
    const endpoint = event.target.closest("[data-connection-endpoint]");
    const hit = event.target.closest("[data-connection-index]");
    if (mode === "select" && (endpoint || handle || hit)) {
      if (interaction || pinch) return;
      event.preventDefault();
      if (endpoint && selectedConnection) {
        const ends = [...$("#connection-controls").querySelectorAll("[data-connection-endpoint]")].map((element) => ({
          x: Number(element.getAttribute("cx")), y: Number(element.getAttribute("cy"))
        }));
        interaction = { type: "connection-endpoint", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          connection: selectedConnection, side: endpoint.dataset.connectionEndpoint, ends, element: endpoint, changed: false };
        viewport.setPointerCapture(event.pointerId);
      } else if (handle && selectedConnection) {
        const index = Number(handle.dataset.pointIndex);
        const previous = index < 0 ? selectedConnection.curve : selectedConnection.curvePoints;
        const curve = index < 0 ? previous : previous?.[index];
        if (index >= 0 && !curve) return;
        selectedCurvePoint = index < 0 ? null : index;
        $("#connection-remove-point").disabled = index < 0;
        $("#connection-controls").querySelectorAll("[data-connection-handle]").forEach((item) => item.classList.toggle("point-selected", item === handle && index >= 0));
        interaction = { type: "connection-curve", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          connection: selectedConnection, index, previous, x: Number.isFinite(curve?.x) ? curve.x : 0,
          y: Number.isFinite(curve?.y) ? curve.y : 0, changed: false };
        viewport.setPointerCapture(event.pointerId);
      } else if (hit) {
        const connection = currentCanvas().connections[Number(hit.dataset.connectionIndex)];
        if (connection) selectConnection(connection);
      }
      return;
    }
    if (selectedConnection) {
      clearConnectionSelection();
      renderConnections();
    }
    const touchedCard = event.target.closest("[data-card-id]");
    const selectedResizeCard = mode === "select" && selectedIds.size === 1 &&
      touchedCard?.dataset.cardId === selectedId && touchedCard.querySelector("[data-resize-item]") &&
      !event.target.closest("[data-action], .attachment-download, [data-resize-item]");
    if (event.pointerType === "touch" && canvasTouches.size < 2 && ["select", "hand"].includes(mode) &&
        (selectedResizeCard || !event.target.closest("[data-action], [contenteditable], video, .attachment-download, [data-resize-shape], [data-resize-item]"))) {
      canvasTouches.set(event.pointerId, { x: event.clientX, y: event.clientY,
        resizeId: selectedResizeCard ? touchedCard.dataset.cardId : null });
      const entries = [...canvasTouches.entries()];
      if (entries.length === 2 && entries[0][1].resizeId && entries[0][1].resizeId === entries[1][1].resizeId &&
          (!interaction || interaction.type === "card")) {
        if (interaction) finishInteraction({ type: "pointercancel", pointerId: interaction.pointerId });
        const id = entries[0][1].resizeId;
        const card = currentCanvas().cards.find((item) => item.id === id);
        const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
        if (card && element) {
          interaction = startItemResize(card, element, entries[0][0], entries[0][1].x, entries[0][1].y);
          const [first, second] = entries.map((entry) => entry[1]);
          pinch = { type: "item", ids: entries.map((entry) => entry[0]),
            distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)) };
          for (const [pointerId] of entries) viewport.setPointerCapture(pointerId);
          event.preventDefault();
          return;
        }
      }
      if (canvasTouches.size === 2 && interaction && ["pan", "card"].includes(interaction.type)) {
        finishInteraction({ type: "pointercancel", pointerId: interaction.pointerId });
        const [first, second] = [...canvasTouches.values()];
        const bounds = viewport.getBoundingClientRect();
        const center = { x: (first.x + second.x) / 2 - bounds.left, y: (first.y + second.y) / 2 - bounds.top };
        pinch = {
          distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          zoom, worldX: (center.x - pan.x) / zoom, worldY: (center.y - pan.y) / zoom
        };
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (interaction || pinch) return;
    const cardElement = event.target.closest("[data-card-id]");
    if (mode === "connect") {
      if (cardElement) event.preventDefault();
      return;
    }
    const start = worldPoint(event);
    if (mode === "draw" || mode === "shape" || mode === "area" || (mode === "select" && !cardElement && event.pointerType !== "touch")) {
      hideFormatting();
      selectedId = null;
      selectedIds.clear();
      updateSelectionVisual();
      interaction = { type: mode === "select" ? "area" : mode, pointerId: event.pointerId, start, end: start, points: [[start.x, start.y]] };
      if (interaction.type === "draw") {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.classList.add("drawing-preview");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", $("#drawing-color").value);
        path.setAttribute("stroke-width", $("#brush-size").value);
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        if ($("#brush-kind").value === "marker") path.setAttribute("opacity", ".35");
        if ($("#brush-kind").value === "dashed") path.setAttribute("stroke-dasharray", `${Number($("#brush-size").value) * 2} ${Number($("#brush-size").value) * 2}`);
        path.setAttribute("d", `M${start.x} ${start.y} l0.01 0`);
        svg.appendChild(path);
        world.appendChild(svg);
        interaction.preview = svg;
        interaction.path = path;
      } else showSelectionBox(start, start);
    } else if (mode === "hand" || !cardElement) {
      if (mode !== "hand") {
        selectedId = null;
        selectedIds.clear();
        hideFormatting();
        updateSelectionVisual();
      }
      interaction = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y };
      viewport.style.cursor = "grabbing";
    } else {
      if (event.target.closest("[data-action], [contenteditable], video, .attachment-download")) return;
      const card = currentCanvas().cards.find((item) => item.id === cardElement.dataset.cardId);
      if (!card) return;
      if (!selectedIds.has(card.id)) selectedIds = new Set([card.id]);
      selectedId = card.id;
      updateSelectionVisual();
      if (event.target.closest("[data-resize-shape]") && card.type === "shape") {
        interaction = { type: "resize", pointerId: event.pointerId, card, element: cardElement, startX: event.clientX, startY: event.clientY, width: card.width, height: card.height };
      } else if (event.target.closest("[data-resize-item]")) {
        interaction = startItemResize(card, cardElement, event.pointerId, event.clientX, event.clientY);
      } else {
        const items = currentCanvas().cards.filter((item) => selectedIds.has(item.id)).map((item) => ({
          card: item, x: item.x, y: item.y, element: cardsElement.querySelector(`[data-card-id="${CSS.escape(item.id)}"]`)
        }));
        interaction = { type: "card", pointerId: event.pointerId, items, startX: event.clientX, startY: event.clientY };
      }
    }
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener("pointermove", (event) => {
    if (canvasTouches.has(event.pointerId)) {
      canvasTouches.set(event.pointerId, { ...canvasTouches.get(event.pointerId), x: event.clientX, y: event.clientY });
    }
    if (pinch && canvasTouches.size >= 2 && canvasTouches.has(event.pointerId)) {
      const [first, second] = [...canvasTouches.values()];
      if (pinch.type === "item") {
        const factor = Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance;
        const height = interaction.card.type === "image" ? interaction.initialFrameHeight :
          interaction.card.type === "video" ? interaction.initialVideoHeight : interaction.initialHeight;
        updateItemResize(interaction, (factor - 1) * interaction.width * zoom, (factor - 1) * height * zoom);
        event.preventDefault();
        return;
      }
      const bounds = viewport.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - bounds.left;
      const centerY = (first.y + second.y) / 2 - bounds.top;
      zoom = Math.max(Math.min(0.2, pinch.zoom), Math.min(1.75, pinch.zoom * Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance));
      pan = { x: centerX - pinch.worldX * zoom, y: centerY - pinch.worldY * zoom };
      updateTransform();
      event.preventDefault();
      return;
    }
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (interaction.type === "connection-endpoint") {
      interaction.changed = interaction.changed || Math.hypot(dx, dy) > 3;
      if (interaction.changed) {
        const point = worldPoint(event);
        interaction.element.setAttribute("cx", point.x);
        interaction.element.setAttribute("cy", point.y);
      }
    } else if (interaction.type === "connection-curve") {
      if (dx || dy) {
        if (!interaction.changed && account) accountEpoch += 1;
        interaction.changed = true;
        const position = { x: interaction.x + dx / zoom, y: interaction.y + dy / zoom };
        if (interaction.index < 0) interaction.connection.curve = position;
        else interaction.connection.curvePoints = interaction.previous.map((point, index) =>
          index === interaction.index ? { ...point, ...position } : point);
        renderConnections();
      }
    } else if (interaction.type === "pan") {
      pan = { x: interaction.x + dx, y: interaction.y + dy };
      updateTransform();
    } else if (interaction.type === "card") {
      const moveX = Math.max(Math.round(dx / zoom), -Math.min(...interaction.items.map((item) => item.x)));
      const moveY = Math.max(Math.round(dy / zoom), -Math.min(...interaction.items.map((item) => item.y)));
      interaction.items.forEach((item) => {
        item.card.x = item.x + moveX;
        item.card.y = item.y + moveY;
        item.element.style.left = `${item.card.x}px`;
        item.element.style.top = `${item.card.y}px`;
      });
      renderConnections();
    } else if (interaction.type === "resize") {
      interaction.card.width = Math.max(30, Math.round(interaction.width + dx / zoom));
      interaction.card.height = Math.max(30, Math.round(interaction.height + dy / zoom));
      interaction.element.style.width = `${interaction.card.width}px`;
      interaction.element.style.height = `${interaction.card.height}px`;
      renderConnections();
    } else if (interaction.type === "resize-item") {
      updateItemResize(interaction, dx, dy);
    } else {
      interaction.end = worldPoint(event);
      if (interaction.type === "draw") {
        interaction.points.push([interaction.end.x, interaction.end.y]);
        interaction.path.setAttribute("d", interaction.points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" "));
      } else showSelectionBox(interaction.start, interaction.end);
    }
  });
  function finishInteraction(event) {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const active = interaction;
    interaction = null;
    $("#selection-area").hidden = true;
    if (active.preview) active.preview.remove();
    const cancelled = event.type === "pointercancel";
    if (active.type === "connection-endpoint") {
      if (!cancelled && active.changed) {
        const target = document.elementsFromPoint(event.clientX, event.clientY)
          .map((element) => element.closest("[data-card-id]")).find(Boolean);
        const rect = target?.getBoundingClientRect();
        const other = active.side === "from" ? active.connection.to : active.connection.from;
        if (target && rect.width && rect.height && target.dataset.cardId !== other &&
            event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          const previous = { from: active.connection.from, to: active.connection.to,
            fromPoint: active.connection.fromPoint, toPoint: active.connection.toPoint };
          for (const [index, side] of ["from", "to"].entries()) {
            const element = cardsElement.querySelector(`[data-card-id="${CSS.escape(active.connection[side])}"]`);
            const card = currentCanvas().cards.find((item) => item.id === active.connection[side]);
            if (element && card && element.offsetWidth && element.offsetHeight) {
              active.connection[`${side}Point`] = {
                x: Math.min(1, Math.max(0, (active.ends[index].x - card.x) / element.offsetWidth)),
                y: Math.min(1, Math.max(0, (active.ends[index].y - card.y) / element.offsetHeight))
              };
            }
          }
          active.connection[active.side] = target.dataset.cardId;
          active.connection[`${active.side}Point`] = {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
          };
          if (!save()) {
            active.connection.from = previous.from; active.connection.to = previous.to;
            for (const side of ["fromPoint", "toPoint"]) {
              if (previous[side] === undefined) delete active.connection[side];
              else active.connection[side] = previous[side];
            }
          }
        } else showToast("Solte a extremidade sobre outro elemento.");
      }
      renderConnections();
    } else if (active.type === "connection-curve") {
      if (cancelled || (active.changed && !save())) {
        if (active.index >= 0) active.connection.curvePoints = active.previous;
        else if (active.previous === undefined) delete active.connection.curve;
        else active.connection.curve = active.previous;
        renderConnections();
      }
    } else if (active.type === "card" || active.type === "resize" || active.type === "resize-item") {
      if (cancelled) {
        if (active.type === "card") active.items.forEach((item) => { item.card.x = item.x; item.card.y = item.y; });
        else if (active.type === "resize") { active.card.width = active.width; active.card.height = active.height; }
        else {
          active.card.width = active.width;
          if (active.frameHeight === undefined) delete active.card.frameHeight;
          else active.card.frameHeight = active.frameHeight;
          if (active.mediaResized === undefined) delete active.card.mediaResized;
          else active.card.mediaResized = active.mediaResized;
          if (active.minHeight === undefined) delete active.card.minHeight;
          else active.card.minHeight = active.minHeight;
          if (active.videoHeight === undefined) delete active.card.videoHeight;
          else active.card.videoHeight = active.videoHeight;
        }
        renderCards();
      } else if (active.type !== "resize-item" || active.changed) save();
    } else if (!cancelled && active.type === "area") {
      const left = Math.min(active.start.x, active.end.x);
      const top = Math.min(active.start.y, active.end.y);
      const right = Math.max(active.start.x, active.end.x);
      const bottom = Math.max(active.start.y, active.end.y);
      if (right - left > 2 && bottom - top > 2) {
        currentCanvas().cards.forEach((card) => {
          const el = cardsElement.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
          if (el && card.x < right && card.x + el.offsetWidth > left && card.y < bottom && card.y + el.offsetHeight > top) selectedIds.add(card.id);
        });
      }
      selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
      updateSelectionVisual();
    } else if (!cancelled && (active.type === "shape" || active.type === "draw")) {
      const board = currentCanvas();
      let card;
      if (active.type === "shape") {
        const width = Math.abs(active.end.x - active.start.x);
        const height = Math.abs(active.end.y - active.start.y);
        if (width < 10 || height < 10) { showToast("Arraste para definir o tamanho da forma."); return; }
        card = { id: id(), type: "shape", shape: $("#shape-kind").value, color: $("#drawing-color").value, x: Math.round(Math.min(active.start.x, active.end.x)), y: Math.round(Math.min(active.start.y, active.end.y)), width: Math.round(width), height: Math.round(height) };
      } else {
        const size = Number($("#brush-size").value);
        const padding = size / 2 + 2;
        const bounds = active.points.reduce((result, [x, y]) => ({
          minX: Math.min(result.minX, x), minY: Math.min(result.minY, y),
          maxX: Math.max(result.maxX, x), maxY: Math.max(result.maxY, y)
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const x = Math.max(0, Math.floor(bounds.minX - padding));
        const y = Math.max(0, Math.floor(bounds.minY - padding));
        card = { id: id(), type: "drawing", x, y, width: Math.ceil(bounds.maxX - x + padding), height: Math.ceil(bounds.maxY - y + padding), color: $("#drawing-color").value, brush: $("#brush-kind").value, brushSize: size, points: active.points.map(([px, py]) => [Math.round((px - x) * 10) / 10, Math.round((py - y) * 10) / 10]) };
      }
      board.cards.push(card);
      selectedId = card.id;
      selectedIds = new Set([card.id]);
      save();
      renderCards();
    }
    viewport.style.cursor = mode === "hand" ? "grab" : ["connect", "area", "shape", "draw"].includes(mode) ? "crosshair" : "default";
  }
  function finishPointer(event) {
    const tracked = canvasTouches.delete(event.pointerId);
    if (pinch && tracked) {
      if (pinch.type === "item") {
        const ownerPointer = interaction.pointerId;
        pinch = null;
        canvasTouches.clear();
        finishInteraction({ type: event.type, pointerId: ownerPointer });
        return;
      }
      if (canvasTouches.size < 2) {
        pinch = null;
        if (event.type !== "pointercancel" && canvasTouches.size === 1) {
          const [pointerId, point] = canvasTouches.entries().next().value;
          interaction = { type: "pan", pointerId, startX: point.x, startY: point.y, x: pan.x, y: pan.y };
        }
      }
      return;
    }
    finishInteraction(event);
  }
  viewport.addEventListener("pointerup", finishPointer);
  viewport.addEventListener("pointercancel", finishPointer);
  window.addEventListener("resize", () => {
    clearTimeout(resizeViewTimer);
    resizeViewTimer = setTimeout(() => {
      const width = viewport.clientWidth;
      if (width > 0 && mobileCanvas.matches && width !== viewWidth && currentBoard() && !interaction && !pinch && !editingText()) {
        initialView();
      }
    }, 150);
  });
  document.addEventListener("keydown", (event) => {
    if (!currentBoard() || $("#image-frame-dialog").open || $("#appearance-dialog").open) return;
    if (event.key === "Escape") {
      if (interaction && ["connection-curve", "connection-endpoint"].includes(interaction.type)) {
        finishInteraction({ type: "pointercancel", pointerId: interaction.pointerId });
      }
      setMode("select"); selectedId = null; selectedIds.clear(); renderCards();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && (selectedId || selectedIds.size) && !event.target.isContentEditable && !["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) {
      event.preventDefault(); deleteSelection();
    }
  });

  window.addEventListener("entrelinhas-session", (event) => {
    changeAccount(event.detail.userId).catch((error) => {
      console.error("Falha ao trocar de conta:", error);
      status.textContent = `Erro ao trocar de conta: ${error.message}`;
      status.parentElement.classList.add("error");
    });
  });
  window.addEventListener("online", () => scheduleSync(0));
  window.addEventListener("offline", () => {
    if (account) status.textContent = "Offline";
  });
  window.addEventListener("entrelinhas-imported", () => scheduleSync(0));

  load();
  updateTheme();
  renderBoards();
  if (currentBoard()) {
    renderCards();
    initialView();
  } else {
    showHome();
  }
})();
