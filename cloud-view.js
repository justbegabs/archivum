(() => {
  const button = document.querySelector("#cloud-list");
  const status = document.querySelector("#cloud-list-status");
  const list = document.querySelector("#cloud-board-list");
  const detail = document.querySelector("#cloud-board-detail");
  let generation = 0;
  const urls = new Set();

  function clearDetail() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    detail.replaceChildren();
  }

  function clear() {
    generation += 1;
    clearDetail();
    list.replaceChildren();
    status.textContent = "";
    button.disabled = false;
  }

  async function sessionFor(expectedUserId) {
    const session = await window.entrelinhasCloudAuth.requireSession();
    if (expectedUserId && session.userId !== expectedUserId) {
      throw new Error("A conta conectada mudou. Consulte novamente.");
    }
    return session;
  }

  async function openBoard(userId, id, operation) {
    clearDetail();
    status.textContent = "Carregando e verificando a cópia e seus arquivos…";
    try {
      const { client } = await sessionFor(userId);
      const result = await window.EntrelinhasImportCore.loadBoard(client, userId, id);
      await sessionFor(userId);
      if (operation !== generation) return;
      const title = document.createElement("h3");
      title.textContent = result.board.title;
      const description = document.createElement("p");
      description.textContent = result.deleted
        ? "Quadro marcado como excluído; esta cópia recuperável é somente leitura."
        : "Cópia somente leitura, em formato JSON. Não é possível editá-la aqui.";
      const content = document.createElement("pre");
      content.className = "cloud-board-json";
      content.textContent = JSON.stringify(result.board, null, 2);
      detail.append(title, description, content);
      for (const [key, file] of result.files) {
        const url = URL.createObjectURL(file);
        urls.add(url);
        const link = document.createElement("a");
        link.className = "cloud-file-link";
        link.href = url;
        link.download = file instanceof File ? file.name : key;
        link.textContent = `Baixar anexo: ${file instanceof File ? file.name : key}`;
        detail.append(link);
      }
      status.textContent = `Cópia verificada, revisão ${result.revision}.`;
    } catch (error) {
      if (operation !== generation) return;
      console.error("Falha ao consultar quadro:", error);
      clearDetail();
      status.textContent = `Não foi possível carregar a cópia: ${error.message}`;
    }
  }

  button.addEventListener("click", async () => {
    clear();
    const operation = generation;
    button.disabled = true;
    status.textContent = "Consultando quadros da conta…";
    try {
      const { client, userId } = await sessionFor();
      const boards = await window.EntrelinhasImportCore.listBoards(client, userId);
      await sessionFor(userId);
      if (operation !== generation) return;
      for (const board of boards) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "backup-button cloud-board-button";
        item.textContent = `Abrir cópia ${board.id}`;
        item.addEventListener("click", () => {
          generation += 1;
          return openBoard(userId, board.id, generation);
        });
        list.append(item);
      }
      status.textContent = boards.length
        ? `${boards.length} cópia(s) encontrada(s). Selecione uma para consultar.`
        : "Nenhuma cópia encontrada nesta conta.";
    } catch (error) {
      if (operation !== generation) return;
      console.error("Falha ao consultar cópias:", error);
      status.textContent = `Não foi possível consultar a nuvem: ${error.message}`;
    } finally {
      if (operation === generation) button.disabled = false;
    }
  });

  window.addEventListener("entrelinhas-session", clear);
})();
