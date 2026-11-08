// Importação de um retrato imutável; não altera o armazenamento local.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EntrelinhasImportCore = api;
})(globalThis, function () {
  "use strict";

  const bucketName = "entrelinhas-sync-private";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function sha256(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error("A verificação de integridade exige HTTPS ou localhost.");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function boardId(ownerId, localId) {
    const hash = await sha256(new TextEncoder().encode(JSON.stringify(["entrelinhas-import-v1", ownerId, localId])));
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }

  function references(value, result = new Set()) {
    if (!value || typeof value !== "object") return result;
    if (Array.isArray(value)) {
      value.forEach((item) => references(item, result));
      return result;
    }
    for (const [key, item] of Object.entries(value)) {
      if (["coverId", "imageId", "fileId"].includes(key) && typeof item === "string") result.add(item);
      else references(item, result);
    }
    return result;
  }

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function errorMessage(error) {
    return error?.message || String(error);
  }

  async function readBoard(client, id) {
    const { data, error } = await client.from("entrelinhas_sync_boards")
      .select("id,owner_id,revision,document").eq("id", id).maybeSingle();
    if (error) throw new Error(`Não foi possível consultar o quadro remoto: ${errorMessage(error)}`);
    return data;
  }

  async function download(bucket, path) {
    const { data, error } = await bucket.download(path);
    if (error) {
      if (Number(error.status || error.statusCode) === 404) return null;
      throw new Error(`Não foi possível ler o arquivo remoto: ${errorMessage(error)}`);
    }
    if (!(data instanceof Blob)) throw new Error("O Storage retornou um arquivo inválido.");
    return data;
  }

  async function verifyFile(bucket, file) {
    const blob = await download(bucket, file.path);
    if (!blob) throw new Error(`Arquivo remoto ausente: ${file.key}`);
    if (blob.size !== file.size || await sha256(await blob.arrayBuffer()) !== file.sha256) {
      throw new Error(`O arquivo remoto não passou na verificação de integridade: ${file.key}`);
    }
  }

  async function prepareBoard(ownerId, sourceBoard, sourceFiles, deleted = false) {
    if (!uuidPattern.test(ownerId) || !sourceBoard || typeof sourceBoard.id !== "string" ||
        typeof sourceBoard.title !== "string" || !Array.isArray(sourceBoard.cards) ||
        !Array.isArray(sourceBoard.connections) || !(sourceFiles instanceof Map)) {
      throw new Error("Dados de importação inválidos.");
    }
    ownerId = ownerId.toLowerCase();
    // A cópia impede que alterações externas modifiquem o documento em trânsito.
    const board = JSON.parse(JSON.stringify(sourceBoard));
    const id = await boardId(ownerId, board.id);
    const files = [];
    for (const key of [...references(board)].sort()) {
      const blob = sourceFiles.get(key);
      if (!(blob instanceof Blob)) throw new Error(`Arquivo local ausente: ${key}`);
      const digest = await sha256(await blob.arrayBuffer());
      files.push({
        key, path: `${ownerId}/${digest}`, sha256: digest, size: blob.size,
        type: blob.type, kind: typeof File !== "undefined" && blob instanceof File ? "File" : "Blob",
        name: typeof File !== "undefined" && blob instanceof File ? blob.name : null,
        lastModified: typeof File !== "undefined" && blob instanceof File ? blob.lastModified : null
      });
    }
    const document = { format: "entrelinhas-import-v1", board, files };
    if (deleted) document.deleted = true;
    return { ownerId, id, document, files };
  }

  async function uploadFiles(client, files, sourceFiles) {
    const bucket = client.storage.from(bucketName);
    for (const file of files) {
      const existing = await download(bucket, file.path);
      if (existing) {
        if (existing.size !== file.size || await sha256(await existing.arrayBuffer()) !== file.sha256) {
          throw new Error(`O arquivo remoto existente está corrompido: ${file.key}`);
        }
      } else {
        const { error } = await bucket.upload(file.path, sourceFiles.get(file.key), {
          contentType: file.type || "application/octet-stream", upsert: false
        });
        if (error && Number(error.status || error.statusCode) !== 409) {
          throw new Error(`Não foi possível enviar o arquivo ${file.key}: ${errorMessage(error)}`);
        }
        await verifyFile(bucket, file);
      }
    }
  }

  async function importBoard(client, ownerId, sourceBoard, sourceFiles) {
    const prepared = await prepareBoard(ownerId, sourceBoard, sourceFiles);
    ({ ownerId } = prepared);
    const { id, document, files } = prepared;
    const expected = canonical(document);
    const bucket = client.storage.from(bucketName);
    let remote = await readBoard(client, id);
    if (remote && (remote.owner_id !== ownerId || canonical(remote.document) !== expected)) {
      throw new Error("O quadro remoto difere desta cópia local. Nenhuma versão foi sobrescrita.");
    }

    await uploadFiles(client, files, sourceFiles);
    if (!remote) {
      const { error } = await client.rpc("entrelinhas_sync_save", {
        p_expected_owner_id: ownerId, p_board_id: id, p_expected_revision: null, p_document: document
      });
      if (error) {
        // A resposta pode ter se perdido depois de uma gravação bem-sucedida.
        remote = await readBoard(client, id);
        if (!remote) throw new Error(`Não foi possível gravar o quadro: ${errorMessage(error)}`);
      }
    }
    remote = await readBoard(client, id);
    if (!remote || remote.owner_id !== ownerId || canonical(remote.document) !== expected) {
      throw new Error("A verificação do quadro remoto falhou. Nenhuma migração foi concluída.");
    }
    for (const file of files) await verifyFile(bucket, file);
    return { id, revision: remote.revision, files: files.length };
  }

  async function saveBoard(client, ownerId, sourceBoard, sourceFiles, expectedRevision, options = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Revisão inválida; o quadro não foi salvo.");
    }
    if (typeof options !== "object" || options === null ||
        (options.deleted !== undefined && typeof options.deleted !== "boolean")) {
      throw new Error("Opções de gravação inválidas.");
    }
    const prepared = await prepareBoard(ownerId, sourceBoard, sourceFiles, options.deleted === true);
    const { id, document, files } = prepared;
    const expected = canonical(document);
    const previous = await readBoard(client, id);
    if (previous && previous.owner_id === prepared.ownerId &&
        previous.revision === expectedRevision + 1 && canonical(previous.document) === expected) {
      for (const file of files) await verifyFile(client.storage.from(bucketName), file);
      return { id, revision: previous.revision };
    }
    if (!previous || previous.owner_id !== prepared.ownerId || previous.revision !== expectedRevision) {
      throw new Error("Conflito de revisão ou acesso indisponível. A edição local foi preservada.");
    }
    if (canonical(previous.document) === expected) {
      for (const file of files) await verifyFile(client.storage.from(bucketName), file);
      return { id, revision: expectedRevision };
    }
    await uploadFiles(client, files, sourceFiles);
    const { error } = await client.rpc("entrelinhas_sync_save", {
      p_expected_owner_id: prepared.ownerId, p_board_id: id, p_expected_revision: expectedRevision, p_document: document
    });
    const remote = await readBoard(client, id);
    if (!remote || remote.owner_id !== prepared.ownerId ||
        remote.revision !== expectedRevision + 1 || canonical(remote.document) !== expected) {
      throw new Error(error
        ? `Não foi possível salvar; a edição local foi preservada: ${errorMessage(error)}`
        : "Não foi possível verificar a revisão salva; a edição local foi preservada.");
    }
    for (const file of files) await verifyFile(client.storage.from(bucketName), file);
    return { id, revision: remote.revision };
  }

  async function loadBoard(client, ownerId, id) {
    if (!uuidPattern.test(ownerId) || !uuidPattern.test(id)) throw new Error("Identificador de quadro inválido.");
    ownerId = ownerId.toLowerCase();
    const remote = await readBoard(client, id);
    if (!remote || remote.owner_id !== ownerId || !Number.isSafeInteger(remote.revision) || remote.revision < 0) {
      throw new Error("Quadro indisponível ou revisão inválida.");
    }
    const document = remote.document;
    if (!document || document.format !== "entrelinhas-import-v1" || !document.board ||
        typeof document.board.id !== "string" || typeof document.board.title !== "string" ||
        !Array.isArray(document.board.cards) || !Array.isArray(document.board.connections) ||
        !Array.isArray(document.files) ||
        (document.deleted !== undefined && document.deleted !== true) ||
        await boardId(ownerId, document.board.id) !== id.toLowerCase()) {
      throw new Error("Documento remoto inválido.");
    }
    const expectedKeys = references(document.board);
    const files = new Map();
    const bucket = client.storage.from(bucketName);
    for (const item of document.files) {
      if (!item || typeof item.key !== "string" || !expectedKeys.has(item.key) || files.has(item.key) ||
          !/^[0-9a-f]{64}$/.test(item.sha256) || item.path !== `${ownerId}/${item.sha256}` ||
          !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.type !== "string" ||
          !["Blob", "File"].includes(item.kind) ||
          (item.kind === "File" && (typeof item.name !== "string" || !Number.isSafeInteger(item.lastModified)))) {
        throw new Error("Manifesto remoto de arquivos inválido.");
      }
      const blob = await download(bucket, item.path);
      if (!blob || blob.size !== item.size || await sha256(await blob.arrayBuffer()) !== item.sha256) {
        throw new Error(`Falha na integridade do arquivo remoto: ${item.key}`);
      }
      const value = item.kind === "File"
        ? new File([blob], item.name, { type: item.type, lastModified: item.lastModified })
        : new Blob([blob], { type: item.type });
      files.set(item.key, value);
    }
    if (files.size !== expectedKeys.size) throw new Error("O quadro remoto tem arquivos ausentes no manifesto.");
    return { board: structuredClone(document.board), revision: remote.revision, files, deleted: document.deleted === true };
  }

  async function listBoards(client, ownerId) {
    if (!uuidPattern.test(ownerId)) throw new Error("Identificador de conta inválido.");
    ownerId = ownerId.toLowerCase();
    const result = [];
    const seen = new Set();
    let cursor = null;
    for (;;) {
      let query = client.from("entrelinhas_sync_boards")
        .select("id,owner_id,revision")
        .eq("owner_id", ownerId)
        .order("id", { ascending: true })
        .limit(500);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw new Error(`Não foi possível listar os quadros: ${errorMessage(error)}`);
      if (!Array.isArray(data)) throw new Error("A lista de quadros retornada é inválida.");
      if (!data.length) return result;
      for (const row of data) {
        if (!row || typeof row.id !== "string" || !uuidPattern.test(row.id) ||
            row.owner_id !== ownerId || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
            seen.has(row.id) || (cursor && row.id <= cursor)) {
          throw new Error("A lista de quadros retornada é inválida ou incompleta.");
        }
        seen.add(row.id);
        result.push({ id: row.id, revision: row.revision });
        cursor = row.id;
      }
    }
  }

  return { importBoard, saveBoard, loadBoard, listBoards, canonical, references };
});
