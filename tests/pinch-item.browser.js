// Executar com viewport móvel e quadro de teste no localStorage.
window.runPinchItemTests = function () {
  const viewport = document.querySelector("#viewport");
  const originalCapture = viewport.setPointerCapture;
  const card = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const stored = (id) => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0].cards.find((item) => item.id === id);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const touch = (target, type, id, x, y) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: id === 1,
    button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, clientX: x, clientY: y
  }));
  const gesture = (id, distance, ending = "pointerup") => {
    card(id).click();
    const target = id === "text" ? card(id).querySelector(".rich-text") : id === "video" ? card(id).querySelector("video") : card(id);
    touch(target, "pointerdown", 1, 100, 100);
    touch(target, "pointerdown", 2, 200, 100);
    touch(viewport, "pointermove", 2, 100 + distance, 100);
    touch(viewport, ending, 2, 100 + distance, 100);
    touch(viewport, "pointerup", 1, 100, 100);
  };
  try {
    viewport.setPointerCapture = () => {};
    for (const id of ["text", "image", "video"]) {
      const before = structuredClone(stored(id));
      const heightBefore = id === "image" ? card(id).querySelector(".image-frame").offsetHeight :
        id === "video" ? card(id).querySelector("video").offsetHeight : card(id).offsetHeight;
      const worldBefore = document.querySelector("#world").style.transform;
      gesture(id, 150);
      const enlarged = stored(id);
      assert(enlarged.width === Math.round(before.width * 1.5), `${id}: pinça não ampliou largura.`);
      const height = id === "image" ? enlarged.frameHeight : id === "video" ? enlarged.videoHeight : enlarged.minHeight;
      assert(height === Math.max(40, Math.round(heightBefore * 1.5)), `${id}: pinça não ampliou altura.`);
      assert(document.querySelector("#world").style.transform === worldBefore, "Pinça de item alterou zoom do quadro.");
      const saved = JSON.stringify(enlarged);
      gesture(id, 200, "pointercancel");
      assert(JSON.stringify(stored(id)) === saved && card(id).style.width === `${enlarged.width}px`,
        `${id}: cancelamento não restaurou tamanho.`);
      gesture(id, 70);
      assert(stored(id).width === Math.max(100, Math.round(enlarged.width * 0.7)), `${id}: pinça não reduziu largura.`);
    }
    return ["pinça de texto", "pinça de imagem", "pinça de vídeo", "cancelamento", "persistência local"];
  } finally {
    viewport.setPointerCapture = originalCapture;
  }
};
