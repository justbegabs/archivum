// Executar com quadro de teste preparado em origem local isolada.
window.runAppearanceTests = function () {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const card = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const stored = (id) => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0].cards.find((item) => item.id === id);
  const open = (id) => { card(id).click(); card(id).querySelector('[data-action="appearance"]').click(); };
  const close = () => document.querySelector("#appearance-close").click();
  const input = (id, value, type = "input") => {
    const element = document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true }));
  };
  for (const id of ["text", "note", "image", "video", "document", "folder", "shape", "drawing"]) {
    open(id);
    assert(document.querySelector("#appearance-dialog").open, `${id}: painel não abriu.`);
    assert(document.querySelector("#appearance-text-options").hidden === ["image", "shape", "drawing"].includes(id),
      `${id}: opções de texto incorretas.`);
    input("appearance-background", "#123456");
    const element = card(id);
    const color = id === "shape" ? element.querySelector(".shape-image").style.color : element.style.backgroundColor;
    assert(stored(id).appearance.background === "#123456" && color === "rgb(18, 52, 86)",
      `${id}: fundo não foi aplicado e salvo.`);
    input("appearance-opacity", "40");
    const opacity = id === "shape" ? getComputedStyle(element.querySelector(".shape-image")).fillOpacity :
      getComputedStyle(element).backgroundColor;
    assert(stored(id).appearance.backgroundOpacity === 40 &&
      opacity === (id === "shape" ? "0.4" : "rgba(18, 52, 86, 0.4)") &&
      getComputedStyle(element).opacity === "1", `${id}: opacidade não afetou apenas o fundo.`);
    close();
  }
  open("text");
  input("appearance-font", "georgia", "change");
  input("appearance-color", "#ab1234");
  for (const id of ["bold", "italic", "underline"]) {
    const checkbox = document.querySelector(`#appearance-${id}`);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const text = card("text").querySelector(".rich-text");
  const styles = getComputedStyle(text);
  assert(styles.fontFamily.includes("Georgia") && styles.color === "rgb(171, 18, 52)" &&
    styles.fontWeight === "700" && styles.fontStyle === "italic" &&
    styles.textDecorationLine.includes("underline") && text.innerHTML.includes("<b>"),
    "Estilos ou formatação original do texto não foram preservados.");
  assert(stored("text").appearance.font === "georgia" && stored("text").appearance.bold === true,
    "Estilos não foram salvos.");
  document.querySelector("#appearance-text-reset").click();
  assert(!("font" in stored("text").appearance) && !("bold" in stored("text").appearance) &&
    stored("text").appearance.background === "#123456", "Restauração de texto alterou o fundo.");
  document.querySelector("#appearance-background-reset").click();
  assert(!stored("text").appearance && card("text").style.backgroundColor === "", "Fundo padrão não foi restaurado.");
  close();
  open("note");
  input("appearance-font", "arial", "change");
  input("appearance-color", "#00aa22");
  document.querySelector("#appearance-bold").click();
  assert(card("note").querySelector(".card-title").style.fontFamily.includes("Arial") &&
    card("note").querySelector(".card-body").style.color === "rgb(0, 170, 34)" &&
    stored("note").appearance.bold === true, "Estilo da nota não foi aplicado.");
  close();
  document.querySelector("#theme-toggle").click();
  assert(card("note").style.backgroundColor === "rgba(18, 52, 86, 0.4)" &&
    card("note").querySelector(".card-title").style.color === "rgb(0, 170, 34)",
    "Tema substituiu a aparência personalizada.");
  return ["todos os fundos", "forma", "texto", "nota", "restauração", "tema", "persistência local"];
};
