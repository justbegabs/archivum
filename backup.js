(() => {
  const STATE_KEY = "entrelinhas-boards-v1";
  const DATABASE = "entrelinhas-media";
  const STORE = "images";
  const button = document.querySelector("#backup-all");
  const message = document.querySelector("#backup-status");

  function report(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Falha ao ler o IndexedDB."));
    });
  }

  async function openExistingDatabase() {
    if (typeof indexedDB.databases !== "function") {
      throw new Error("Este navegador não permite verificar o banco sem modificá-lo. Use um navegador atualizado.");
    }
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === DATABASE)) return null;
    const request = indexedDB.open(DATABASE);
    request.onupgradeneeded = () => request.transaction.abort();
    return requestResult(request);
  }

  async function readFiles() {
    const database = await openExistingDatabase();
    if (!database) return { exists: false, records: [] };
    try {
      if (!database.objectStoreNames.contains(STORE)) {
        throw new Error("O banco local não contém a coleção esperada de arquivos.");
      }
      const transaction = database.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const records = [];
      await new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = () => reject(request.error || new Error("Falha ao ler os arquivos."));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (typeof cursor.key !== "string" || !(cursor.value instanceof Blob)) {
            reject(new Error("O banco contém um registro de arquivo em formato não suportado; nenhum backup foi gerado."));
            return;
          }
          records.push({ key: cursor.key, blob: cursor.value });
          cursor.continue();
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Falha na leitura dos arquivos."));
        transaction.onabort = () => reject(transaction.error || new Error("Leitura dos arquivos cancelada."));
      });
      return { exists: true, records };
    } finally {
      database.close();
    }
  }

  async function inspectLocalData() {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw === null) throw new Error("Nenhum quadro salvo foi encontrado neste endereço e navegador.");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error("Os dados locais não são um JSON válido. Faça o backup antes de prosseguir.");
    }
    if (!data || !Array.isArray(data.boards) || !data.boards.every((board) =>
      board && typeof board.id === "string" && Array.isArray(board.cards) && Array.isArray(board.connections))) {
      throw new Error("A estrutura dos quadros locais é inválida. Faça o backup antes de prosseguir.");
    }
    const refs = references(raw);
    const files = await readFiles();
    const keys = new Set(files.records.map((record) => record.key));
    const missing = [...refs.ids].filter((key) => !keys.has(key));
    const unreferenced = files.records.filter((record) => !refs.ids.has(record.key)).length;
    if (raw !== localStorage.getItem(STATE_KEY)) {
      throw new Error("Os dados locais mudaram durante a verificação. Tente novamente.");
    }
    return {
      boards: data.boards.length,
      referenced: refs.ids.size,
      available: [...refs.ids].filter((key) => keys.has(key)).length,
      missing,
      unreferenced
    };
  }

  const inspectButton = document.querySelector("#inspect-migration");
  const inspectStatus = document.querySelector("#migration-status");
  document.querySelector("#migration-backup").addEventListener("click", () => button.click());
  inspectButton.addEventListener("click", async () => {
    inspectButton.disabled = true;
    inspectStatus.textContent = "Verificando os dados salvos neste navegador…";
    try {
      const result = await inspectLocalData();
      inspectStatus.textContent = `${result.boards} quadro(s), ${result.referenced} arquivo(s) referenciado(s), ${result.available} disponível(is) e ${result.unreferenced} arquivo(s) sem referência. ` +
        (result.missing.length ? `Atenção: ${result.missing.length} arquivo(s) referenciado(s) não foram encontrados. ` : "") +
        "A importação para o Supabase ainda não está disponível. Gere e confira o backup antes de migrar.";
    } catch (error) {
      console.error("Falha ao verificar dados locais:", error);
      inspectStatus.textContent = `Não foi possível verificar os dados: ${error.message}`;
    } finally {
      inspectButton.disabled = false;
    }
  });

  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler um arquivo."));
      reader.onabort = () => reject(new Error("Leitura de arquivo cancelada."));
      reader.readAsDataURL(blob);
    });
  }

  async function fingerprint(blob) {
    if (!globalThis.crypto?.subtle) throw new Error("A verificação do backup exige HTTPS ou localhost.");
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function references(rawState) {
    const ids = new Set();
    const warnings = [];
    if (rawState === null) {
      warnings.push("Nenhum quadro salvo foi encontrado nesta origem do navegador.");
      return { ids, warnings };
    }
    let data;
    try {
      data = JSON.parse(rawState);
    } catch (error) {
      warnings.push("O estado local não é um JSON válido; o texto original foi preservado.");
      return { ids, warnings };
    }
    function walk(value) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      for (const [key, item] of Object.entries(value)) {
        if (["coverId", "imageId", "fileId"].includes(key) && typeof item === "string") ids.add(item);
        else walk(item);
      }
    }
    walk(data);
    return { ids, warnings };
  }

  async function createBackup() {
    const rawState = localStorage.getItem(STATE_KEY);
    const initial = await readFiles();
    const files = [];
    for (const [index, record] of initial.records.entries()) {
      report(`Preparando arquivo ${index + 1} de ${initial.records.length}…`);
      const { blob, key } = record;
      files.push({
        key,
        kind: blob instanceof File ? "File" : "Blob",
        name: blob instanceof File ? blob.name : null,
        type: blob.type,
        size: blob.size,
        lastModified: blob instanceof File ? blob.lastModified : null,
        sha256: await fingerprint(blob),
        dataUrl: await toDataURL(blob)
      });
    }
    const check = await readFiles();
    if (rawState !== localStorage.getItem(STATE_KEY) || initial.exists !== check.exists || files.length !== check.records.length) {
      throw new Error("Os dados mudaram durante o backup. Feche outras abas do site e tente novamente.");
    }
    for (let index = 0; index < files.length; index += 1) {
      const record = check.records[index];
      const file = files[index];
      const blob = record.blob;
      const kind = blob instanceof File ? "File" : "Blob";
      if (file.key !== record.key || file.kind !== kind || file.size !== blob.size || file.type !== blob.type ||
          file.name !== (kind === "File" ? blob.name : null) ||
          file.lastModified !== (kind === "File" ? blob.lastModified : null) ||
          file.sha256 !== await fingerprint(blob)) {
        throw new Error("Os arquivos mudaram durante o backup. Feche outras abas do site e tente novamente.");
      }
    }
    if (rawState !== localStorage.getItem(STATE_KEY)) {
      throw new Error("Os dados mudaram durante o backup. Feche outras abas do site e tente novamente.");
    }
    const found = new Set(files.map((file) => file.key));
    const refs = references(rawState);
    const missing = [...refs.ids].filter((key) => !found.has(key));
    if (missing.length) refs.warnings.push(`${missing.length} arquivo(s) referenciado(s) não foram encontrados no IndexedDB.`);
    return {
      format: "entrelinhas-local-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      localStorage: { key: STATE_KEY, value: rawState },
      indexedDB: { name: DATABASE, store: STORE, exists: initial.exists, records: files },
      missingReferences: missing,
      warnings: refs.warnings
    };
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    report("Preparando backup. Mantenha esta aba aberta e não edite os quadros.");
    try {
      const backup = await createBackup();
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `entrelinhas-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (backup.warnings.length) {
        report(`Backup gerado com alerta: ${backup.warnings.join(" ")}`, true);
      } else {
        report(`Backup gerado com ${backup.indexedDB.records.length} arquivo(s). Confira o download.`);
      }
    } catch (error) {
      console.error("Falha ao gerar backup:", error);
      report(`Não foi possível gerar o backup: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
})();
