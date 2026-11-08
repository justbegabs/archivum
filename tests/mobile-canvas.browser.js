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
    assert(innerWidth <= 650, "O teste precisa de viewport de celular.");
    const toolbar = document.querySelector(".floating-toolbar");
    const sidebar = document.querySelector(".sidebar");
    const shown = (element) => getComputedStyle(element).visibility === "visible";
    assert(viewport.clientWidth === innerWidth && viewport.clientHeight === innerHeight &&
      !shown(toolbar) && !shown(sidebar), "O editor não abriu em tela cheia, sem menus.");
    touch(viewport, "pointerdown", 1, 120, 250);
    touch(viewport, "pointerup", 1, 120, 250);
    assert(shown(toolbar) && shown(sidebar) && viewport.clientWidth === innerWidth,
      "Toque não mostrou os menus sobre o quadro.");
    document.querySelector("#mobile-controls-close").click();
    assert(!shown(toolbar) && !shown(sidebar), "Botão não ocultou os menus.");
    document.querySelector("#mobile-controls-open").click();
    assert(shown(toolbar) && shown(sidebar), "Botão não abriu os menus.");
    document.querySelector("#draw-tool").click();
    document.querySelector("#mobile-controls-close").click();
    document.querySelector("#mobile-controls-open").click();
    assert(shown(toolbar) && shown(sidebar), "Não foi possível reabrir os menus durante o desenho.");
    document.querySelector("#select-tool").click();
    document.querySelector("#mobile-controls-close").click();
    const initial = transform();
    assert(initial.zoom >= 0.85 && initial.zoom <= 1, "O quadro não abriu ampliado para leitura.");
    const cards = [...document.querySelectorAll("[data-card-id]")];
    const first = cards.reduce((a, b) => parseFloat(b.style.left) < parseFloat(a.style.left) ||
      (parseFloat(b.style.left) === parseFloat(a.style.left) && parseFloat(b.style.top) < parseFloat(a.style.top)) ? b : a);
    const firstRect = first.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    assert(Math.abs(firstRect.left - viewportRect.left - 16) < 1 &&
      Math.abs(firstRect.top - viewportRect.top - 40) < 1, "O primeiro elemento não ficou visível.");
    const tool = document.querySelector("#select-tool").getBoundingClientRect();
    assert(tool.width >= 40 && tool.height >= 40 && toolbar.scrollWidth > toolbar.clientWidth,
      "A barra móvel não está adaptada para toque e rolagem.");

    touch(viewport, "pointerdown", 1, 120, 250);
    touch(viewport, "pointermove", 1, 160, 280);
    touch(viewport, "pointerup", 1, 160, 280);
    const moved = transform();
    assert(Math.abs(moved.x - initial.x - 40) < 0.1 && Math.abs(moved.y - initial.y - 30) < 0.1,
      "Arrastar a área vazia não moveu o quadro.");
    assert(!shown(toolbar) && !shown(sidebar), "Arrastar abriu os menus.");

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
    assert(!shown(toolbar) && !shown(sidebar), "Pinça abriu os menus.");

    const edit = document.querySelector("[data-card-id] [contenteditable]");
    edit.focus();
    const beforeEdit = transform();
    touch(edit, "pointerdown", 1, 120, 250);
    touch(edit, "pointerup", 1, 120, 250);
    assert(document.activeElement === edit && transform().zoom === beforeEdit.zoom,
      "O toque interrompeu a edição de texto.");
    assert(!shown(toolbar), "Toque em texto abriu os menus.");
    edit.blur();

    document.querySelector("#fit-board").click();
    const fitted = transform();
    assert(fitted.zoom < initial.zoom, "Centralizar não exibiu o quadro inteiro.");
    const fittedViewport = viewport.getBoundingClientRect();
    for (const element of document.querySelectorAll("[data-card-id]")) {
      const bounds = element.getBoundingClientRect();
      assert(bounds.left >= fittedViewport.left - 1 && bounds.right <= fittedViewport.right + 1,
        "Centralizar cortou um elemento horizontalmente.");
    }
    touch(viewport, "pointerdown", 1, 100, 250);
    touch(viewport, "pointerdown", 2, 200, 250);
    touch(viewport, "pointermove", 2, 1000, 250);
    assert(transform().zoom <= 1.75, "O zoom excedeu o limite máximo.");
    touch(viewport, "pointercancel", 2, 1000, 250);
    touch(viewport, "pointerup", 1, 100, 250);
    document.querySelector("#fit-board").click();
    assert(Math.abs(transform().zoom - fitted.zoom) < 0.001, "Centralizar não restaurou o enquadramento.");
    return ["tela cheia e menus", "enquadramento móvel", "arraste do quadro", "pinça", "preservação de notas", "edição", "limites e cancelamento"];
  } finally {
    viewport.setPointerCapture = capture;
  }
};
