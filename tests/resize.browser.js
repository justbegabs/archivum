// Executar em origem isolada com um quadro de teste preparado no localStorage.
window.runResizeTests = function (pointerType) {
  const viewport = document.querySelector("#viewport");
  const capture = viewport.setPointerCapture;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const card = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const stored = (id) => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0].cards.find((item) => item.id === id);
  const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0,
    buttons: type === "pointermove" || type === "pointerdown" ? 1 : 0, clientX: x, clientY: y
  }));
  const drag = (id, x, y, end = "pointerup") => {
    card(id).click();
    const handle = card(id).querySelector("[data-resize-item]");
    assert(getComputedStyle(handle).display !== "none", "Alça não apareceu.");
    pointer(handle, "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + x, 100 + y);
    pointer(viewport, end, 100 + x, 100 + y);
  };
  try {
    viewport.setPointerCapture = () => {};
    const scale = new DOMMatrix(getComputedStyle(document.querySelector("#world")).transform).a;
    drag("text", 40 * scale, 0);
    assert(stored("text").width === 240, "Largura do texto não foi persistida.");
    const textHeight = card("text").offsetHeight;
    drag("text", 0, 60 * scale);
    assert(stored("text").width === 240 && stored("text").minHeight === textHeight + 60 &&
      card("text").offsetHeight >= textHeight + 60, "Altura do texto não aumentou independentemente da largura.");
    drag("text", 0, -30 * scale);
    assert(stored("text").minHeight === textHeight + 30, "Altura do texto não diminuiu.");
    const savedText = JSON.stringify(stored("text"));
    drag("text", 0, 30 * scale, "pointercancel");
    assert(JSON.stringify(stored("text")) === savedText && card("text").style.minHeight === `${textHeight + 30}px`,
      "Cancelamento não restaurou a altura do texto.");
    const text = card("text").querySelector(".rich-text");
    text.innerHTML = '<b>Texto</b><font size="5">Grande</font>';
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const previousFontSize = parseFloat(getComputedStyle(text.querySelector("font")).fontSize);
    card("text").querySelector('[data-action="text-larger"]').click();
    assert(stored("text").textScale === 1.1 && text.innerHTML.includes("<b>") &&
      parseFloat(getComputedStyle(text.querySelector("font")).fontSize) > previousFontSize,
      "Tamanho ou formatação do texto foi perdido.");
    drag("video", 40 * scale, 0);
    assert(stored("video").width === 240 && stored("video").fileId === "file-original",
      "Vídeo ou referência ao arquivo foram alterados incorretamente.");
    const videoHeight = card("video").querySelector("video").offsetHeight;
    drag("video", 0, 60 * scale);
    assert(stored("video").width === 240 && stored("video").videoHeight === videoHeight + 60 &&
      card("video").querySelector("video").offsetHeight === videoHeight + 60,
      "Altura do vídeo não aumentou independentemente da largura.");
    drag("video", 0, -30 * scale);
    assert(stored("video").videoHeight === videoHeight + 30, "Altura do vídeo não diminuiu.");
    const savedVideo = JSON.stringify(stored("video"));
    drag("video", 0, 30 * scale, "pointercancel");
    assert(JSON.stringify(stored("video")) === savedVideo &&
      card("video").querySelector("video").offsetHeight === videoHeight + 30,
      "Cancelamento não restaurou a altura do vídeo.");
    drag("image", 40 * scale, 30 * scale);
    assert(stored("image").width === 240 && stored("image").frameHeight >= 40 &&
      stored("image").image === "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100'%3E%3Crect width='200' height='100' fill='red'/%3E%3C/svg%3E",
      "Redimensionamento da imagem alterou o original.");
    const beforeCancel = JSON.stringify(stored("image"));
    drag("image", 20 * scale, 20 * scale, "pointercancel");
    assert(JSON.stringify(stored("image")) === beforeCancel && card("image").style.width === "240px",
      "Cancelamento não restaurou o tamanho.");
    card("image").click();
    card("image").querySelector('[data-action="frame"]').click();
    assert(document.querySelector("#image-frame-dialog").open, "Enquadramento não abriu.");
    for (const [id, value] of [["image-frame-zoom", "180"], ["image-frame-x", "10"], ["image-frame-y", "90"]]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const result = stored("image");
    const img = card("image").querySelector("img");
    assert(result.frameZoom === 1.8 && result.frameX === 10 && result.frameY === 90 &&
      img.style.transform.includes("translate") && document.querySelector("#image-frame-preview img").style.transform === img.style.transform,
      "Enquadramento ou prévia não foram persistidos.");
    document.querySelector("#image-frame-reset").click();
    assert(stored("image").frameHeight === undefined && img.style.transform === "", "Restauração da imagem falhou.");
    document.querySelector("#image-frame-zoom").value = "150";
    document.querySelector("#image-frame-zoom").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#image-frame-close").click();
    assert(stored("image").frameZoom === 1.5 && !document.querySelector("#image-frame-dialog").open,
      "Enquadramento não permaneceu salvo.");
    return ["texto", "vídeo", "imagem", "cancelamento", "enquadramento", "prévia", "persistência"];
  } finally {
    viewport.setPointerCapture = capture;
  }
};
