(() => {
  const button = document.querySelector("#cloud-import");
  const status = document.querySelector("#migration-status");

  async function checkSession(expectedUserId) {
    const session = await window.entrelinhasCloudAuth.requireSession();
    if (expectedUserId && session.userId !== expectedUserId) {
      throw new Error("A conta conectada mudou. A operação foi interrompida.");
    }
    return session;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    let started = false;
    try {
      const { client, userId } = await checkSession();
      status.textContent = "Lendo os dados locais. Não edite os quadros nem use outras abas durante a operação.";
      const snapshot = await window.entrelinhasLocalData.capture();
      if (!snapshot.boards.length) throw new Error("Não há quadros locais para enviar.");
      if (snapshot.missing.length) {
        throw new Error(`${snapshot.missing.length} arquivo(s) referenciado(s) não foram encontrados. Nenhum quadro foi enviado.`);
      }
      const message = `Enviar uma cópia de ${snapshot.boards.length} quadro(s) e ${snapshot.referenced} arquivo(s) referenciado(s) para a conta conectada?\n\n` +
        `${snapshot.unreferenced} arquivo(s) sem referência não serão enviados e permanecerão no dispositivo. ` +
        "Feche outras abas e não edite durante o envio. Confira seu backup antes de continuar.\n\n" +
        "Este envio experimental não permite abrir ou sincronizar os quadros em outro dispositivo. " +
        "Ele exige que o esquema e as políticas tenham sido revisados e instalados. Os dados locais não serão apagados.";
      if (!window.confirm(message)) {
        status.textContent = "Envio cancelado. Nenhum dado foi enviado.";
        return;
      }
      if (!await window.entrelinhasLocalData.isUnchanged(snapshot)) {
        throw new Error("Os dados locais mudaram. Nenhum quadro foi enviado; verifique e tente novamente.");
      }
      for (const [index, board] of snapshot.boards.entries()) {
        await checkSession(userId);
        if (!window.entrelinhasLocalData || localStorage.getItem("entrelinhas-boards-v1") !== snapshot.raw) {
          throw new Error("Os dados locais mudaram durante o envio. O processo foi interrompido.");
        }
        status.textContent = `Enviando e verificando quadro ${index + 1} de ${snapshot.boards.length}…`;
        started = true;
        await window.EntrelinhasImportCore.importBoard(client, userId, board, snapshot.files);
      }
      await checkSession(userId);
      if (!await window.entrelinhasLocalData.isUnchanged(snapshot)) {
        throw new Error("Os dados locais mudaram durante o envio. Algumas cópias podem ter sido enviadas; verifique antes de tentar novamente.");
      }
      status.textContent = `${snapshot.boards.length} cópia(s) de quadro verificadas na nuvem. ` +
        `${snapshot.unreferenced} arquivo(s) sem referência permanecem apenas neste dispositivo. ` +
        "A sincronização e a abertura em outro dispositivo ainda não estão disponíveis.";
    } catch (error) {
      console.error("Falha ao enviar cópias dos quadros:", error);
      status.textContent = `Envio interrompido: ${error.message} Dados locais preservados.` +
        (started ? " Alguns quadros ou arquivos podem já ter sido enviados." : " Nenhum quadro foi enviado.");
    } finally {
      button.disabled = false;
    }
  });
})();
