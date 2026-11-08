// Executar em origem isolada com um quadro salvo no formato anterior.
window.runBrandingTests = async function () {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const visible = (element) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).display !== "none";
  assert(document.title.startsWith("archivum"), "Título da página não foi atualizado.");
  assert(document.querySelector("#home-link").getAttribute("aria-label") === "Archivum, início",
    "Nome acessível não foi atualizado.");
  const identity = innerWidth <= 650 ? document.querySelector(".mobile-identity") : document.querySelector(".brand-caption");
  assert(visible(identity) && identity.textContent.replace(/\s+/g, " ").includes("nem tudo que foi ocultado") &&
    identity.textContent.includes("DvH"), "Identidade não está visível.");
  assert(document.querySelector('[data-card-id="saved"]'), "Quadro anterior não foi carregado.");
  const card = document.querySelector('[data-card-id="saved"]');
  assert(card.style.backgroundColor === "rgb(18, 52, 86)", "Cor personalizada do usuário foi alterada.");
  const theme = document.querySelector("#theme-toggle");
  theme.click();
  await new Promise(requestAnimationFrame);
  assert(document.documentElement.dataset.theme === "dark" && visible(identity),
    "Identidade não foi preservada no tema escuro.");
  assert(card.style.backgroundColor === "rgb(18, 52, 86)", "Tema alterou a cor personalizada.");
  theme.click();
  document.querySelector("#home-link").click();
  assert(!document.querySelector("#home").hidden && visible(identity), "Início não foi aberto pela marca.");
  document.querySelector('[data-open-board="board"]').click();
  assert(document.querySelector('[data-card-id="saved"]'), "Não foi possível reabrir o quadro anterior.");
  return ["marca", "identidade responsiva", "temas", "cor personalizada", "quadro existente", "navegação"];
};
