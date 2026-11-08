// Executar em origem isolada com quadro de teste preparado.
window.runConnectionPointTests = async function () {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const card = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const stored = () => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0];
  const clickPoint = (id, x, y) => {
    const element = card(id);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1,
      clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y }));
  };
  assert(document.querySelectorAll("#connection-lines .connection-path").length === 1,
    "Conexão anterior não foi renderizada.");
  document.querySelector("#connect-tool").click();
  assert(getComputedStyle(card("a").querySelector(".card-inner")).pointerEvents === "none",
    "O conteúdo interativo pode interceptar a escolha do ponto.");
  clickPoint("a", 0.2, 0.7);
  assert(card("a").classList.contains("connect-source"), "Origem não foi marcada.");
  clickPoint("b", 0.8, 0.3);
  const connection = stored().connections[1];
  assert(connection.from === "a" && connection.to === "b" &&
    Math.abs(connection.fromPoint.x - 0.2) < 0.02 && Math.abs(connection.fromPoint.y - 0.7) < 0.02 &&
    Math.abs(connection.toPoint.x - 0.8) < 0.02 && Math.abs(connection.toPoint.y - 0.3) < 0.02,
    "Coordenadas não foram persistidas.");
  await new Promise(requestAnimationFrame);
  assert(getComputedStyle(card("a").querySelector(".card-inner")).pointerEvents !== "none",
    "O conteúdo interativo não foi restaurado.");
  const path = () => document.querySelector("#connection-point-lines path").getAttribute("d");
  const before = path();
  assert(document.querySelectorAll("#connection-lines .connection-path").length === 1 &&
    document.querySelectorAll("#connection-point-lines path").length === 1, "Conexões não foram exibidas.");
  const viewport = document.querySelector("#viewport");
  const capture = viewport.setPointerCapture;
  try {
    viewport.setPointerCapture = () => {};
    const scale = new DOMMatrix(getComputedStyle(document.querySelector("#world")).transform).a;
    const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse",
      button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y
    }));
    pointer(card("a"), "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + 50 * scale, 100);
    pointer(viewport, "pointerup", 100 + 50 * scale, 100);
    assert(before !== path() && stored().connections[1].fromPoint.x === connection.fromPoint.x,
      "Conexão não acompanhou o movimento.");
    card("a").click();
    pointer(card("a").querySelector("[data-resize-item]"), "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + 40 * scale, 100 + 40 * scale);
    pointer(viewport, "pointerup", 100 + 40 * scale, 100 + 40 * scale);
    const nums = path().match(/-?\d+(?:\.\d+)?/g).map(Number);
    const item = stored().cards.find((entry) => entry.id === "a");
    assert(Math.abs(nums[0] - (item.x + card("a").offsetWidth * connection.fromPoint.x)) < 0.01,
      "Conexão não acompanhou o redimensionamento.");
  } finally { viewport.setPointerCapture = capture; }
  document.querySelector("#connect-tool").click();
  card("a").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  card("b").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  assert(stored().connections[2].fromPoint.x === 0.5 && stored().connections[2].toPoint.y === 0.5,
    "Conexão por teclado não usou o centro.");
  document.querySelector("#connect-tool").click();
  clickPoint("a", 0.3, 0.3);
  clickPoint("a", 0.5, 0.5);
  assert(stored().connections.length === 3, "Conexão com o próprio elemento foi criada.");
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  assert(stored().connections.length === 3, "Cancelamento criou uma conexão.");
  document.querySelector("#connect-tool").click();
  clickPoint("a", 0.3, 0.3);
  const originalSetItem = Storage.prototype.setItem;
  try {
    Storage.prototype.setItem = function () { throw new Error("Falha simulada"); };
    clickPoint("b", 0.5, 0.5);
    assert(stored().connections.length === 3 && card("a").classList.contains("connect-source"),
      "Falha ao salvar perdeu a origem ou persistiu uma conexão.");
  } finally { Storage.prototype.setItem = originalSetItem; }
  clickPoint("b", 0.5, 0.5);
  assert(stored().connections.length === 4, "Nova tentativa após erro não funcionou.");
  return ["pontos de origem e destino", "conexão anterior", "movimento", "redimensionamento",
    "teclado", "cancelamento", "falha de armazenamento", "persistência"];
};
