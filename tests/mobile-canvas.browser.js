// Executar apenas em uma origem local de testes, com viewport de celular.
window.runMobileCanvasTests = async function () {
  const viewport = document.querySelector("#viewport");
  const world = document.querySelector("#world");
  const capture = viewport.setPointerCapture;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const transform = () => {
    const matrix = new DOMMatrix(getComputedStyle(world).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  };
  const touch = (target, type, id, x, y) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: "touch", pointerId: id,
    isPrimary: id === 1, button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: x, clientY: y
  }));
  try {
    viewport.setPointerCapture = () => {};
    assert(viewport.clientWidth < 600, "O teste precisa de viewport estreito.");
    const initial = transform();
    assert(initial.zoom >= 0.2 && initial.zoom < 1, "O quadro não foi enquadrado no celular.");

    touch(viewport, "pointerdown", 1, 120, 250);
    touch(viewport, "pointermove", 1, 160, 280);
    touch(viewport, "pointerup", 1, 160, 280);
    const moved = transform();
    assert(Math.abs(moved.x - initial.x - 40) < 0.1 && Math.abs(moved.y - initial.y - 30) < 0.1,
      "Arrastar a área vazia não moveu o quadro.");

    const card = document.querySelector("[data-card-id]");
    const beforeCard = { x: card.style.left, y: card.style.top };
    touch(card, "pointerdown", 1, 100, 250);
    touch(viewport, "pointermove", 1, 110, 260);
    touch(viewport, "pointerdown", 2, 200, 250);
    const beforePinch = transform();
    touch(viewport, "pointermove", 2, 260, 250);
    const zoomed = transform();
    assert(zoomed.zoom > beforePinch.zoom && zoomed.zoom <= 1.75, "A pinça não ampliou o quadro.");
    const restoredCard = document.querySelector("[data-card-id]");
    assert(restoredCard.style.left === beforeCard.x && restoredCard.style.top === beforeCard.y,
      "A pinça alterou a posição de uma nota.");
    touch(viewport, "pointerup", 2, 260, 250);
    touch(viewport, "pointermove", 1, 135, 275);
    const continued = transform();
    assert(Math.abs(continued.x - zoomed.x - 25) < 0.1 && Math.abs(continued.y - zoomed.y - 15) < 0.1,
      "O dedo restante não continuou movendo o quadro.");
    touch(viewport, "pointerup", 1, 135, 275);

    const edit = document.querySelector("[data-card-id] [contenteditable]");
    edit.focus();
    const beforeEdit = transform();
    touch(edit, "pointerdown", 1, 120, 250);
    touch(edit, "pointerup", 1, 120, 250);
    assert(document.activeElement === edit && transform().zoom === beforeEdit.zoom,
      "O toque interrompeu a edição de texto.");
    edit.blur();

    document.querySelector("#fit-board").click();
    const fitted = transform();
    touch(viewport, "pointerdown", 1, 100, 250);
    touch(viewport, "pointerdown", 2, 200, 250);
    touch(viewport, "pointermove", 2, 1000, 250);
    assert(transform().zoom <= 1.75, "O zoom excedeu o limite máximo.");
    touch(viewport, "pointercancel", 2, 1000, 250);
    touch(viewport, "pointerup", 1, 100, 250);
    document.querySelector("#fit-board").click();
    assert(Math.abs(transform().zoom - fitted.zoom) < 0.001, "Centralizar não restaurou o enquadramento.");
    return ["enquadramento móvel", "arraste do quadro", "pinça", "preservação de notas", "edição", "limites e cancelamento"];
  } finally {
    viewport.setPointerCapture = capture;
  }
};
