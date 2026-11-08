(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sync-import-core.js"));
  else root.EntrelinhasAccountBackup = factory(root.EntrelinhasImportCore);
})(globalThis, function (core) {
  "use strict";

  const format = "entrelinhas-account-backup-v1";
  const ownerPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function hash(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error("A verificação do backup exige HTTPS ou localhost.");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function encode(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(text);
  }

  function decode(text) {
    if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
      throw new Error("Conteúdo de arquivo inválido no backup.");
    }
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  }

  function checkBoard(board) {
    if (!board || typeof board.id !== "string" || !board.id || typeof board.title !== "string" ||
        !Array.isArray(board.cards) || !Array.isArray(board.connections)) throw new Error("Quadro inválido no backup.");
  }

  function remap(value, mapping) {
    if (Array.isArray(value)) return value.map((item) => remap(item, mapping));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, ["coverId", "imageId", "fileId"].includes(key) && typeof item === "string" && mapping.has(item)
        ? mapping.get(item) : remap(item, mapping)]));
  }

  async function packFiles(files) {
    if (!(files instanceof Map)) throw new Error("Arquivos do backup inválidos.");
    const result = [];
    for (const [key, blob] of files) {
      if (typeof key !== "string" || !key || !(blob instanceof Blob)) throw new Error("Arquivo inválido no armazenamento da conta.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const isFile = typeof File !== "undefined" && blob instanceof File;
      result.push({ key, data: encode(bytes), hash: await hash(bytes), size: blob.size, type: blob.type,
        kind: isFile ? "File" : "Blob", name: isFile ? blob.name : null, modified: isFile ? blob.lastModified : null });
    }
    return result;
  }

  async function unpackFiles(items) {
    if (!Array.isArray(items)) throw new Error("Lista de arquivos inválida no backup.");
    const files = new Map();
    for (const item of items) {
      if (!item || typeof item.key !== "string" || !item.key || files.has(item.key) ||
          !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.type !== "string" ||
          !["File", "Blob"].includes(item.kind) ||
          (item.kind === "File" && (typeof item.name !== "string" || !Number.isSafeInteger(item.modified))) ||
          (item.kind === "Blob" && (item.name !== null || item.modified !== null))) {
        throw new Error("Metadados de arquivo inválidos no backup.");
      }
      const bytes = decode(item.data);
      if (bytes.length !== item.size || await hash(bytes) !== item.hash) throw new Error(`Integridade do arquivo ${item.key} inválida.`);
      const blob = item.kind === "File"
        ? new File([bytes], item.name, { type: item.type, lastModified: item.modified })
        : new Blob([bytes], { type: item.type });
      if (blob.type !== item.type) throw new Error("Tipo de arquivo inválido no backup.");
      files.set(item.key, blob);
    }
    return files;
  }

  function checkReferences(value, files) {
    for (const key of core.references(value)) {
      if (!files.has(key)) throw new Error(`Arquivo ${key} ausente; o backup não está completo.`);
    }
  }

  async function create(owner, snapshot, journals, remote) {
    if (!ownerPattern.test(owner) || !snapshot || !(snapshot.files instanceof Map) ||
        !snapshot.record || !Array.isArray(journals) || !Array.isArray(remote)) throw new Error("Dados de backup inválidos.");
    const record = structuredClone(snapshot.record);
    if (!Array.isArray(record.boards) || !Array.isArray(record.baseline) || !Array.isArray(record.archive)) throw new Error("Conta inválida.");
    for (const board of record.boards) checkBoard(board);
    for (const entry of [...record.baseline, ...record.archive]) checkBoard(entry.board);
    for (const journal of journals) {
      if (!journal || !Array.isArray(journal.state?.boards)) throw new Error("Rascunho inválido; backup interrompido.");
      journal.state.boards.forEach(checkBoard);
    }
    checkReferences({ record, journals }, snapshot.files);
    const packedRemote = [];
    for (const item of remote) {
      checkBoard(item.board);
      checkReferences(item.board, item.files);
      packedRemote.push({ board: item.board, revision: item.revision, deleted: item.deleted === true,
        remoteId: item.remoteId, files: await packFiles(item.files) });
    }
    const payload = { format, owner: owner.toLowerCase(), createdAt: new Date().toISOString(),
      record, journals, files: await packFiles(snapshot.files), remote: packedRemote };
    return { payload, sha256: await hash(new TextEncoder().encode(core.canonical(payload))) };
  }

  async function prepareRestore(owner, backup, newId) {
    if (!ownerPattern.test(owner) || !backup || !backup.payload || backup.payload.format !== format ||
        backup.payload.owner !== owner.toLowerCase() || typeof newId !== "function") {
      throw new Error("Backup inválido ou pertencente a outra conta.");
    }
    const payload = backup.payload;
    if (await hash(new TextEncoder().encode(core.canonical(payload))) !== backup.sha256) throw new Error("Integridade do backup inválida.");
    const local = await unpackFiles(payload.files);
    if (!payload.record || !Array.isArray(payload.record.boards) || !Array.isArray(payload.record.archive) ||
        !Array.isArray(payload.record.baseline) || !Array.isArray(payload.journals) || !Array.isArray(payload.remote)) {
      throw new Error("Estrutura de conta inválida no backup.");
    }
    checkReferences({ record: payload.record, journals: payload.journals }, local);
    const staged = new Map();
    function copyFiles(files) {
      const mapping = new Map();
      for (const [key, file] of files) {
        const fresh = newId();
        if (typeof fresh !== "string" || !fresh || staged.has(fresh)) throw new Error("Identificador de arquivo duplicado.");
        mapping.set(key, fresh);
        staged.set(fresh, file);
      }
      return mapping;
    }
    const localMap = copyFiles(local);
    function copyBoard(board, mapping, suffix) {
      checkBoard(board);
      const result = remap(board, mapping);
      result.id = newId();
      if (typeof result.id !== "string" || !result.id) throw new Error("Identificador de quadro inválido.");
      result.title += suffix;
      return result;
    }
    const boards = payload.record.boards.map((board) => copyBoard(board, localMap, " (backup)"));
    const localIds = new Set(payload.record.boards.map((board) => board.id));
    const archive = [];
    for (const entry of payload.record.archive) archive.push({ ...entry, board: copyBoard(entry.board, localMap, ""), reason: `Backup: ${entry.reason || "arquivo"}` });
    for (const entry of payload.record.baseline) archive.push({ board: copyBoard(entry.backupBoard || entry.board, localMap, ""), revision: entry.revision, reason: "Backup: base de sincronização" });
    for (const journal of payload.journals) {
      if (!Array.isArray(journal.state?.boards)) throw new Error("Rascunho inválido no backup.");
      for (const board of journal.state.boards) archive.push({ board: copyBoard(board, localMap, ""), reason: "Backup: rascunho" });
    }
    for (const entry of payload.remote) {
      const files = await unpackFiles(entry.files);
      checkBoard(entry.board);
      checkReferences(entry.board, files);
      const mapping = copyFiles(files);
      if (!entry.deleted && !localIds.has(entry.board.id)) {
        boards.push(copyBoard(entry.board, mapping, " (backup da nuvem)"));
        localIds.add(entry.board.id);
      } else {
        archive.push({ board: copyBoard(entry.board, mapping, ""), revision: entry.revision,
          reason: entry.deleted ? "Backup: versão remota excluída" : "Backup: versão remota" });
      }
    }
    return { boards, archive, files: staged };
  }

  return { create, prepareRestore, remap };
});
