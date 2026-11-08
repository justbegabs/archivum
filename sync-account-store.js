(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EntrelinhasAccountStore = api;
})(globalThis, function () {
  "use strict";

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function userKey(ownerId) {
    if (typeof ownerId !== "string" || !uuid.test(ownerId)) throw new Error("Conta inválida.");
    return ownerId.toLowerCase();
  }

  function empty() {
    return { version: 0, boards: [], activeBoardId: null, baseline: [], archive: [], theme: "light" };
  }

  function validate(record) {
    if (!record || !Number.isSafeInteger(record.version) || record.version < 0 ||
        !Array.isArray(record.boards) || !Array.isArray(record.baseline) || !Array.isArray(record.archive) ||
        (record.boards.length ? !record.boards.some((board) => board.id === record.activeBoardId) : record.activeBoardId !== null)) {
      throw new Error("Armazenamento da conta inválido.");
    }
  }

  async function fingerprint(file) {
    if (!(file instanceof Blob)) throw new Error("Arquivo inválido.");
    if (!globalThis.crypto?.subtle) throw new Error("A verificação de arquivos exige HTTPS ou localhost.");
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const isFile = typeof File !== "undefined" && file instanceof File;
    return {
      blob: file, hash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      size: file.size, type: file.type, kind: isFile ? "File" : "Blob",
      name: isFile ? file.name : null, modified: isFile ? file.lastModified : null
    };
  }

  function sameMetadata(a, b) {
    return ["hash", "size", "type", "kind", "name", "modified"].every((key) => a[key] === b[key]);
  }

  function create(indexedDB, name = "entrelinhas-account-sync-v1") {
    let opening;
    function database() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore("accounts");
            request.result.createObjectStore("files");
          };
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); opening = null; };
            resolve(db);
          };
          request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento."));
          request.onblocked = () => reject(new Error("Armazenamento bloqueado por outra aba."));
        }).catch((error) => { opening = null; throw error; });
      }
      return opening;
    }

    async function read(ownerId) {
      const owner = userKey(ownerId);
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("accounts", "readonly");
        const request = tx.objectStore("accounts").get(owner);
        tx.oncomplete = () => {
          try {
            const result = request.result || empty();
            validate(result);
            resolve(result);
          } catch (error) { reject(error); }
        };
        tx.onerror = () => reject(tx.error || new Error("Falha ao ler a conta."));
        tx.onabort = () => reject(tx.error || new Error("Leitura da conta cancelada."));
      });
    }

    async function update(ownerId, expectedVersion, change) {
      const owner = userKey(ownerId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Versão local inválida.");
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("accounts", "readwrite");
        const store = tx.objectStore("accounts");
        const request = store.get(owner);
        let result = null;
        let failure;
        request.onsuccess = () => {
          try {
            const record = request.result || empty();
            validate(record);
            if (record.version !== expectedVersion) return;
            const next = change(structuredClone(record));
            if (!next || next.version !== record.version) throw new Error("Alteração local inválida.");
            next.version += 1;
            validate(next);
            store.put(next, owner);
            result = next;
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(failure || tx.error || new Error("Falha ao salvar a conta."));
        tx.onabort = () => reject(failure || tx.error || new Error("Gravação da conta cancelada."));
      });
    }

    async function readFile(ownerId, key) {
      const owner = userKey(ownerId);
      if (typeof key !== "string" || !key) throw new Error("Identificador de arquivo inválido.");
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readonly");
        const request = tx.objectStore("files").get([owner, key]);
        tx.oncomplete = () => resolve(request.result?.blob);
        tx.onerror = () => reject(tx.error || new Error("Falha ao ler o arquivo."));
        tx.onabort = () => reject(tx.error || new Error("Leitura do arquivo cancelada."));
      });
    }

    async function putFiles(ownerId, files) {
      const owner = userKey(ownerId);
      if (!(files instanceof Map)) throw new Error("Lista de arquivos inválida.");
      const entries = [];
      for (const [key, file] of files) {
        if (typeof key !== "string" || !key) throw new Error("Identificador de arquivo inválido.");
        entries.push([key, await fingerprint(file)]);
      }
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        let failure;
        for (const [key, metadata] of entries) {
          const request = store.get([owner, key]);
          request.onsuccess = () => {
            const previous = request.result;
            if (previous && !sameMetadata(previous, metadata)) {
              failure = new Error(`O arquivo ${key} já existe com conteúdo diferente. Nenhum arquivo foi substituído.`);
              tx.abort();
            } else if (!previous) store.add(metadata, [owner, key]);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure || tx.error || new Error("Falha ao salvar arquivos."));
        tx.onabort = () => reject(failure || tx.error || new Error("Gravação de arquivos cancelada."));
      });
    }

    async function close() {
      if (!opening) return;
      const db = await opening;
      db.close();
      opening = null;
    }

    return { read, update, readFile, putFiles, close };
  }

  return { create };
});
