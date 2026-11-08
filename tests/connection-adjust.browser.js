// Executar em origem isolada com cartões a, b e c e uma conexão antiga.
window.runConnectionAdjustTests = async function () {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const viewport = document.querySelector("#viewport");
  const originalCapture = viewport.setPointerCapture;
  const data = () => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0].connections[0];
  const element = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const pointer = (target, type, x, y, pointerType = "mouse") => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0,
    buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y
  }));
  const point = (id, x, y) => {
    const r = element(id).getBoundingClientRect();
    return { x: r.left + r.width * x, y: r.top + r.height * y };
  };
  const handle = (index) => document.querySelector(`[data-point-index="${index}"]`);
  const end = (side) => document.querySelector(`[data-connection-endpoint="${side}"]`);
  const drag = (target, to, endType = "pointerup", pointerType = "mouse") => {
    const r = target.getBoundingClientRect();
    const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    pointer(target, "pointerdown", from.x, from.y, pointerType);
    pointer(viewport, "pointermove", to.x, to.y, pointerType);
    pointer(viewport, endType, to.x, to.y, pointerType);
  };
  try {
    viewport.setPointerCapture = () => {};
    pointer(document.querySelector('[data-connection-index="0"]'), "pointerdown", 50, 50);
    document.querySelector("#connection-label").value = "Legenda";
    document.querySelector("#connection-label").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#connection-add-point").click();
    assert(data().curvePoints.length === 2 && document.querySelectorAll("[data-connection-handle]").length === 2,
      "Primeiro ponto adicional não apareceu.");
    document.querySelector("#connection-add-point").click();
    assert(data().curvePoints.length === 3 && document.querySelectorAll("[data-connection-handle]").length === 3,
      "Segundo ponto adicional não apareceu.");
    const original = JSON.stringify(data().curvePoints);
    const r = handle(1).getBoundingClientRect();
    drag(handle(1), { x: r.left + r.width / 2 + 20, y: r.top + r.height / 2 + 40 }, "pointerup", "touch");
    assert(JSON.stringify(data().curvePoints) !== original && data().curvePoints[1].y !== JSON.parse(original)[1].y,
      "Ponto intermediário não foi movido.");
    const afterDrag = JSON.stringify(data().curvePoints);
    const r2 = handle(0).getBoundingClientRect();
    drag(handle(0), { x: r2.left + 40, y: r2.top + 40 }, "pointercancel");
    assert(JSON.stringify(data().curvePoints) === afterDrag, "Cancelamento mudou os pontos.");
    handle(1).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", shiftKey: true }));
    assert(data().curvePoints[1].y === JSON.parse(afterDrag)[1].y + 10, "Teclado não ajustou o ponto selecionado.");
    document.querySelector("#connection-remove-point").click();
    assert(data().curvePoints.length === 2 && data().label === "Legenda", "Remoção apagou dados incorretos.");
    const previous = JSON.stringify(data());
    drag(end("from"), point("b", 0.4, 0.4));
    await new Promise(requestAnimationFrame);
    assert(JSON.stringify(data()) === previous, "Origem foi movida para o mesmo elemento do destino.");
    const bounds = viewport.getBoundingClientRect();
    drag(end("from"), { x: bounds.left + 5, y: bounds.top + 5 });
    await new Promise(requestAnimationFrame);
    assert(JSON.stringify(data()) === previous, "Soltar no vazio mudou a seta.");
    drag(end("from"), point("c", 0.3, 0.6), "pointercancel");
    await new Promise(requestAnimationFrame);
    assert(JSON.stringify(data()) === previous, "Cancelamento mudou as extremidades.");
    drag(end("from"), point("c", 0.3, 0.6));
    await new Promise(requestAnimationFrame);
    assert(data().from === "c" && data().to === "b" &&
      Math.abs(data().fromPoint.x - 0.3) < 0.03 && Math.abs(data().fromPoint.y - 0.6) < 0.03 &&
      data().toPoint && data().curvePoints.length === 2 && data().label === "Legenda",
      "Origem não foi reposicionada preservando os dados.");
    drag(end("to"), point("b", 0.8, 0.2), "pointerup", "touch");
    await new Promise(requestAnimationFrame);
    assert(Math.abs(data().toPoint.x - 0.8) < 0.03 && Math.abs(data().toPoint.y - 0.2) < 0.03,
      "Destino não foi reposicionado no próprio elemento.");
    const saved = JSON.stringify(data());
    const originalSetItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = () => { throw new Error("Falha simulada"); };
      drag(end("to"), point("a", 0.4, 0.4));
    } finally { Storage.prototype.setItem = originalSetItem; }
    await new Promise(requestAnimationFrame);
    assert(JSON.stringify(data()) === saved, "Falha de armazenamento alterou o registro salvo.");
    drag(end("to"), point("a", 0.4, 0.4));
    await new Promise(requestAnimationFrame);
    assert(data().to === "a" && data().from === "c", "Tentativa após falha não foi preservada.");
    const handleX = Number(handle(0).getAttribute("cx"));
    const savedPoints = JSON.stringify(data().curvePoints);
    const cardRect = element("c").getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(document.querySelector("#world")).transform).a;
    pointer(element("c"), "pointerdown", cardRect.left + 5, cardRect.top + 5);
    pointer(viewport, "pointermove", cardRect.left + 5 + 40 * scale, cardRect.top + 5);
    pointer(viewport, "pointerup", cardRect.left + 5 + 40 * scale, cardRect.top + 5);
    pointer(document.querySelector('[data-connection-index="0"]'), "pointerdown", 50, 50);
    assert(Number(handle(0).getAttribute("cx")) !== handleX && JSON.stringify(data().curvePoints) === savedPoints,
      "Pontos não acompanharam o movimento do elemento.");
    document.querySelector("#connection-reset").click();
    assert(!data().curvePoints && !data().curve && data().label === "Legenda" && data().from === "c",
      "Restauração alterou dados além da curva.");
    return ["vários pontos", "teclado", "cancelamento", "remover ponto", "reposicionar extremidades", "erro de armazenamento"];
  } finally { viewport.setPointerCapture = originalCapture; }
};
