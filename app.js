(() => {
  const STORAGE_KEY = "entrelinhas-boards-v1";
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
  const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
  const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
  const mediaUrls = new Map();
  let mediaDatabase;
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
  let mode = "select";
  let connectionStart = null;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let interaction = null;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      status.textContent = "Salvo neste dispositivo";
      status.parentElement.classList.remove("error");
      return true;
    } catch (error) {
      console.error("Não foi possível salvar o quadro:", error);
      status.textContent = "Não foi possível salvar";
      status.parentElement.classList.add("error");
      showToast("Não foi possível salvar neste dispositivo.");
      return false;
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
    document.body.classList.remove("show-home");
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
      const controls = `<div class="card-controls"><button data-action="connect" title="Conectar nota" aria-label="Conectar nota">${icon("link")}</button><button data-action="delete" title="Excluir nota" aria-label="Excluir nota">${icon("trash")}</button></div>`;
      const attributes = `class="card card-${escapeHTML(card.type)} ${card.id === selectedId ? "selected" : ""} ${card.id === connectionStart ? "connect-source" : ""} ${mode === "connect" ? "connect-target" : ""}" data-card-id="${escapeHTML(card.id)}" style="left:${card.x}px;top:${card.y}px;width:${card.width}px"`;
      if (card.type === "text") return `<article ${attributes}>${controls}<div class="card-inner"><div class="rich-text" contenteditable="true" role="textbox" aria-label="Texto formatável" aria-multiline="true" data-field="html">${sanitizeRichText(card.html || "")}</div></div></article>`;
      if (card.type === "image") return `<article ${attributes}>${controls}<div class="card-inner"><img class="attached-image" ${card.imageId ? `data-media-id="${escapeHTML(card.imageId)}"` : `src="${escapeHTML(card.image || "")}"`} alt="${escapeHTML(card.alt || "Imagem anexada")}" draggable="false"></div></article>`;
      if (card.type === "document" || card.type === "video") {
        const name = escapeHTML(card.name);
        const download = `<a class="attachment-download" data-media-id="${escapeHTML(card.fileId)}" download="${name}" aria-label="Baixar ${name}">${icon("export")} Baixar arquivo</a>`;
        const player = card.type === "video" ? `<video class="attached-video" controls preload="metadata" playsinline data-media-id="${escapeHTML(card.fileId)}" aria-label="Vídeo: ${name}"></video>` : "";
        return `<article ${attributes}>${controls}<div class="card-inner">${player}<div class="attachment-content"><div class="attachment-icon">${icon(card.type === "video" ? "video" : "note")}</div><div class="attachment-details"><div class="attachment-kind">${card.type === "video" ? "VÍDEO" : "DOCUMENTO"}</div><div class="attachment-name">${name}</div><div class="attachment-size">${escapeHTML(formatFileSize(card.size))}</div></div></div>${download}</div></article>`;
      }
      if (card.type === "folder") return `<article ${attributes}>${controls}<div class="card-inner folder-content"><div class="folder-icon">${icon("folder")}</div><div class="folder-label">PASTA</div><div class="card-title" contenteditable="true" data-field="title" spellcheck="false" aria-label="Nome da pasta">${escapeHTML(card.title)}</div><div class="folder-count">${card.cards.length} ${card.cards.length === 1 ? "item" : "itens"}</div><button class="folder-open" data-action="open-folder">Abrir pasta ${icon("arrow")}</button></div></article>`;
      const cover = card.type === "photo" ? `<div class="photo-cover" style="background-image:url('${escapeHTML(card.image || "")}')"></div>` : "";
      const tag = card.tag ? `<div class="card-meta"><span>${escapeHTML(card.tag)}</span></div>` : "";
      return `<article ${attributes}>
        ${controls}
        <div class="card-inner">${cover}<div class="card-content"><div class="card-kicker" contenteditable="true" data-field="kicker" spellcheck="false">${escapeHTML(card.kicker)}</div><div class="card-title" contenteditable="true" data-field="title" spellcheck="false">${escapeHTML(card.title)}</div><div class="card-body" contenteditable="true" data-field="body" spellcheck="false">${escapeHTML(card.body)}</div>${tag}</div></div>
      </article>`;
    }).join("") || `<div class="empty-board"><strong>Uma página em branco, infinitas possibilidades.</strong><p>Adicione uma nota pela barra abaixo e comece a dar forma às suas ideias.</p></div>`;
    $("#card-count").textContent = `${board.cards.length} ${board.cards.length === 1 ? "ITEM" : "ITENS"}`;
    loadMedia(cardsElement);
    requestAnimationFrame(renderConnections);
  }

  function formatFileSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderConnections() {
    const board = currentCanvas();
    linesElement.innerHTML = board.connections.map((connection) => {
      const from = board.cards.find((card) => card.id === connection.from);
      const to = board.cards.find((card) => card.id === connection.to);
      const fromEl = cardsElement.querySelector(`[data-card-id="${CSS.escape(connection.from)}"]`);
      const toEl = cardsElement.querySelector(`[data-card-id="${CSS.escape(connection.to)}"]`);
      if (!from || !to || !fromEl || !toEl) return "";
      const fromHeight = fromEl.offsetHeight;
      const toHeight = toEl.offsetHeight;
      const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
      const dy = (to.y + toHeight / 2) - (from.y + fromHeight / 2);
      let x1, y1, x2, y2, path;
      if (Math.abs(dx) > Math.abs(dy)) {
        x1 = dx > 0 ? from.x + from.width : from.x;
        x2 = dx > 0 ? to.x : to.x + to.width;
        y1 = from.y + fromHeight / 2; y2 = to.y + toHeight / 2;
        const bend = Math.max(45, Math.abs(x2 - x1) / 2) * Math.sign(dx);
        path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      } else {
        x1 = from.x + from.width / 2; x2 = to.x + to.width / 2;
        y1 = dy > 0 ? from.y + fromHeight : from.y;
        y2 = dy > 0 ? to.y : to.y + toHeight;
        const bend = Math.max(45, Math.abs(y2 - y1) / 2) * Math.sign(dy);
        path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
      }
      return `<path class="connection-path" d="${path}"></path>`;
    }).join("");
  }

  function updateTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    $("#zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  }

  function fitBoard() {
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
      zoom = Math.min(1, availableWidth / Math.max(1, right - left), availableHeight / Math.max(1, bottom - top));
      pan = { x: (viewport.clientWidth - (right - left) * zoom) / 2 - left * zoom, y: 55 - top * zoom };
    }
    updateTransform();
  }

  function initialView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    const cards = currentCanvas().cards;
    if (viewport.clientWidth < 600 && cards.length) {
      const first = cards[0];
      pan = { x: 20 - first.x, y: 58 - first.y };
    }
    updateTransform();
  }

  function setMode(nextMode) {
    hideFormatting();
    mode = nextMode;
    connectionStart = null;
    $("#select-tool").classList.toggle("active", mode === "select");
    $("#hand-tool").classList.toggle("active", mode === "hand");
    $("#connect-tool").classList.toggle("active", mode === "connect");
    viewport.style.cursor = mode === "hand" ? "grab" : mode === "connect" ? "crosshair" : "default";
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

  function connectCard(cardId) {
    if (!connectionStart) {
      connectionStart = cardId;
      selectedId = cardId;
      renderCards();
      showToast("Agora selecione a nota de destino.");
      return;
    }
    if (connectionStart === cardId) {
      showToast("Escolha outra nota para conectar.");
      return;
    }
    const board = currentCanvas();
    if (board.connections.some((connection) => connection.from === connectionStart && connection.to === cardId)) {
      showToast("Essas notas já estão conectadas.");
    } else {
      board.connections.push({ from: connectionStart, to: cardId });
      save();
      showToast("Notas conectadas!");
    }
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
  $("#hand-tool").addEventListener("click", () => setMode("hand"));
  $("#connect-tool").addEventListener("click", () => { setMode("connect"); showToast("Selecione a primeira nota para conectar."); });
  $("#delete-tool").addEventListener("click", () => selectedId ? removeCard(selectedId) : showToast("Selecione uma nota primeiro."));
  $("#zoom-in").addEventListener("click", () => { zoom = Math.min(1.75, Math.round((zoom + 0.1) * 100) / 100); updateTransform(); });
  $("#zoom-out").addEventListener("click", () => { zoom = Math.max(0.2, Math.round((zoom - 0.1) * 100) / 100); updateTransform(); });
  $("#zoom-level").addEventListener("click", () => { zoom = 1; updateTransform(); });
  $("#fit-board").addEventListener("click", fitBoard);
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
      if (action.dataset.action === "delete") removeCard(cardId);
      if (action.dataset.action === "connect") { setMode("connect"); connectCard(cardId); }
      if (action.dataset.action === "open-folder" && mode !== "connect") {
        const folder = currentCanvas().cards.find((item) => item.id === cardId && item.type === "folder");
        if (!folder) return;
        folder.title = folder.title.trim() || "Sem título";
        folderPath.push(folder.id);
        selectedId = null;
        renderCanvasTitle();
        setMode("select");
        initialView();
      }
      return;
    }
    if (mode === "connect") { event.preventDefault(); connectCard(cardId); return; }
    if (selectedId !== cardId) {
      if (activeTextId !== cardId) hideFormatting();
      selectedId = cardId;
      cardsElement.querySelectorAll(".card").forEach((el) => el.classList.toggle("selected", el.dataset.cardId === cardId));
    }
  });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const cardElement = event.target.closest("[data-card-id]");
    if (mode === "connect" || event.target.closest("[data-action]") || (mode !== "hand" && event.target.closest("video, .attachment-download"))) return;
    if (mode === "hand" || !cardElement) {
      if (mode !== "hand" && !cardElement) {
        selectedId = null;
        hideFormatting();
        cardsElement.querySelectorAll(".card").forEach((el) => el.classList.remove("selected"));
        if (event.pointerType !== "touch") return;
      }
      interaction = { type: "pan", startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y };
      viewport.style.cursor = "grabbing";
    } else {
      if (event.target.closest("[contenteditable]")) return;
      const card = currentCanvas().cards.find((item) => item.id === cardElement.dataset.cardId);
      interaction = { type: "card", card, element: cardElement, startX: event.clientX, startY: event.clientY, x: card.x, y: card.y };
      selectedId = card.id;
      cardsElement.querySelectorAll(".card").forEach((el) => el.classList.toggle("selected", el === cardElement));
    }
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!interaction) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (interaction.type === "pan") {
      pan = { x: interaction.x + dx, y: interaction.y + dy };
      updateTransform();
    } else {
      interaction.card.x = Math.max(0, Math.round(interaction.x + dx / zoom));
      interaction.card.y = Math.max(0, Math.round(interaction.y + dy / zoom));
      interaction.element.style.left = `${interaction.card.x}px`;
      interaction.element.style.top = `${interaction.card.y}px`;
      renderConnections();
    }
  });
  function finishInteraction() {
    if (!interaction) return;
    if (interaction.type === "card") save();
    interaction = null;
    viewport.style.cursor = mode === "hand" ? "grab" : "default";
  }
  viewport.addEventListener("pointerup", finishInteraction);
  viewport.addEventListener("pointercancel", finishInteraction);
  document.addEventListener("keydown", (event) => {
    if (!currentBoard()) return;
    if (event.key === "Escape") { setMode("select"); selectedId = null; renderCards(); }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !event.target.isContentEditable && event.target.tagName !== "INPUT") {
      event.preventDefault(); removeCard(selectedId);
    }
  });

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
