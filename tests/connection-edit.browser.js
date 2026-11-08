// Executar em origem isolada com um quadro contendo conexões antigas e com pontos.
window.runConnectionEditTests = async function () {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const stored = () => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0];
  const viewport = document.querySelector("#viewport");
  const originalCapture = viewport.setPointerCapture;
  const pointer = (element, type, x, y, pointerType = "mouse") => element.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
    pointerId: 1, pointerType, clientX: x, clientY: y
  }));
  const hit = (index) => document.querySelector(`[data-connection-index="${index}"]`);
  const handle = () => document.querySelector("[data-connection-handle]");
  const label = document.querySelector("#connection-label");
  try {
    viewport.setPointerCapture = () => {};
    pointer(hit(0), "pointerdown", 100, 100);
    assert(!document.querySelector("#connection-options").hidden && handle(), "Seta antiga não foi selecionada.");
    label.value = '<b>Legenda & teste</b>';
    label.dispatchEvent(new Event("input", { bubbles: true }));
    assert(stored().connections[0].label === label.value &&
      document.querySelector(".connection-label").textContent === label.value &&
      !document.querySelector(".connection-label b"), "Legenda não foi salva ou escapada.");
    const before = hit(0).getAttribute("d");
    const scale = new DOMMatrix(getComputedStyle(document.querySelector("#world")).transform).a;
    pointer(handle(), "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + 30 * scale, 100 + 60 * scale);
    pointer(viewport, "pointerup", 100 + 30 * scale, 100 + 60 * scale);
    assert(Math.abs(stored().connections[0].curve.x - 30) < 0.001 && Math.abs(stored().connections[0].curve.y - 60) < 0.001 &&
      hit(0).getAttribute("d") !== before, "Curva não foi salva.");
    const savedCurve = JSON.stringify(stored().connections[0].curve);
    pointer(handle(), "pointerdown", 100, 100, "touch");
    pointer(viewport, "pointermove", 130, 130, "touch");
    pointer(viewport, "pointercancel", 130, 130, "touch");
    assert(JSON.stringify(stored().connections[0].curve) === savedCurve, "Cancelamento alterou a curva salva.");
    handle().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", shiftKey: true }));
    assert(Math.abs(stored().connections[0].curve.y - 70) < 0.001, "Teclado não ajustou a curva.");
    document.querySelector("#connection-reset").click();
    assert(!("curve" in stored().connections[0]) && hit(0).getAttribute("d") === before,
      "Restauração não recuperou o traçado antigo.");
    pointer(hit(1), "pointerdown", 100, 100, "touch");
    label.value = "Outra seta";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    assert(stored().connections[1].label === "Outra seta" && stored().connections[0].label !== "Outra seta",
      "Edição alterou a seta errada.");
    document.querySelector("#connection-close").click();
    assert(document.querySelector("#connection-options").hidden && !handle(), "Fechar não removeu os controles.");
    return ["seta antiga", "legenda segura", "curva", "cancelamento", "teclado", "restauração", "setas independentes"];
  } finally { viewport.setPointerCapture = originalCapture; }
};
