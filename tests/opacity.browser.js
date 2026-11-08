// Executar em origem isolada com cartões note, shape e text.
window.runOpacityTests = async function () {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const card = (id) => document.querySelector(`[data-card-id="${id}"]`);
  const stored = (id) => JSON.parse(localStorage.getItem("entrelinhas-boards-v1")).boards[0].cards.find((item) => item.id === id);
  const open = (id) => { card(id).click(); card(id).querySelector('[data-action="appearance"]').click(); };
  const input = (value) => {
    const slider = document.querySelector("#appearance-opacity");
    slider.value = String(value);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const close = () => document.querySelector("#appearance-close").click();
  open("note");
  assert(document.querySelector("#appearance-opacity").value === "100", "Opacidade padrão incorreta.");
  input(0);
  assert(getComputedStyle(card("note")).backgroundColor === "rgba(255, 255, 255, 0)" &&
    stored("note").appearance.backgroundOpacity === 0 && getComputedStyle(card("note").querySelector(".card-title")).opacity === "1",
    "Fundo transparente alterou o conteúdo.");
  input(50);
  assert(getComputedStyle(card("note")).backgroundColor === "rgba(255, 255, 255, 0.5)" &&
    document.querySelector("#appearance-opacity-value").textContent === "50%", "Opacidade intermediária incorreta.");
  close();
  document.querySelector("#theme-toggle").click();
  assert(getComputedStyle(card("note")).backgroundColor === "rgba(43, 39, 48, 0.5)",
    "Fundo padrão não acompanhou o tema.");
  open("note");
  assert(document.querySelector("#appearance-opacity").value === "50", "Opacidade não foi restaurada no painel.");
  const color = document.querySelector("#appearance-background");
  color.value = "#123456";
  color.dispatchEvent(new Event("input", { bubbles: true }));
  assert(getComputedStyle(card("note")).backgroundColor === "rgba(18, 52, 86, 0.5)",
    "Mudança de cor perdeu a opacidade.");
  document.querySelector("#appearance-background-reset").click();
  assert(!stored("note").appearance && card("note").style.backgroundColor === "" &&
    document.querySelector("#appearance-opacity").value === "100", "Restauração do fundo falhou.");
  close();
  open("shape");
  assert(document.querySelector("#appearance-opacity").value === "20", "Opacidade padrão da forma incorreta.");
  input(100);
  const shape = card("shape").querySelector(".shape-image");
  assert(getComputedStyle(shape).fillOpacity === "1" && getComputedStyle(shape).strokeOpacity === "1",
    "Opacidade da forma afetou o contorno.");
  document.querySelector("#appearance-background-reset").click();
  assert(getComputedStyle(shape).fillOpacity === "0.2" && document.querySelector("#appearance-opacity").value === "20",
    "Preenchimento padrão da forma não foi restaurado.");
  close();
  open("text");
  input(25);
  assert(stored("text").appearance.backgroundOpacity === 25, "Opacidade do texto não foi persistida.");
  close();
  return ["0%, 50%, 100%", "fundo padrão e tema", "forma e contorno", "restauração", "persistência"];
};
