// Executar apenas em uma origem local de testes.
window.runAccountMenuTests = function () {
  const toggle = document.querySelector("#account-menu-toggle");
  const menu = document.querySelector("#account-menu");
  const reset = document.querySelector("#account-reset-open");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(menu.hidden && toggle.getAttribute("aria-expanded") === "false", "Menu inicialmente aberto.");
  toggle.click();
  assert(!menu.hidden && toggle.getAttribute("aria-expanded") === "true", "Menu não abriu.");
  assert(!reset.disabled, "A janela de reset não está acessível.");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(menu.hidden && toggle.getAttribute("aria-expanded") === "false" && document.activeElement === toggle,
    "Escape não fechou o menu ou não restaurou o foco.");
  toggle.click();
  document.querySelector("#breadcrumb-title").click();
  assert(menu.hidden, "Clique fora não fechou o menu.");
  toggle.click();
  reset.click();
  const dialog = document.querySelector("#account-reset-dialog");
  assert(dialog.open && dialog.querySelectorAll("button:disabled").length === 2 &&
    document.querySelector("#account-reset-status").textContent.includes("indisponíveis"),
    "As opções de reset devem permanecer indisponíveis.");
  document.querySelector("#account-reset-close").click();
  assert(!dialog.open, "Janela de reset não fechou.");
  return ["abertura do menu", "opções de reset indisponíveis", "Escape e foco", "clique fora"];
};
