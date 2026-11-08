(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sync-import-core.js"), require("./sync-reconcile.js"));
  } else {
    root.EntrelinhasSyncEngine = factory(root.EntrelinhasImportCore, root.EntrelinhasReconcile);
  }
})(globalThis, function (core, reconcile) {
  "use strict";

  async function digest(file) {
    if (!globalThis.crypto?.subtle) throw new Error("A verificação de arquivos exige HTTPS ou localhost.");
    const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function sameFile(first, second) {
    if (!(first instanceof Blob) || !(second instanceof Blob)) return false;
    const isFile = (value) => typeof File !== "undefined" && value instanceof File;
    if (first.size !== second.size || first.type !== second.type || isFile(first) !== isFile(second)) return false;
    if (isFile(first) && (first.name !== second.name || first.lastModified !== second.lastModified)) return false;
    return await digest(first) === await digest(second);
  }

  // O adaptador deve isolar contas e gravar estado e base juntos com CAS.
  function create(adapter, operations = core, observe = () => {}) {
    let active = false;

    async function checkSession(ownerId) {
      const session = await adapter.session();
      if (!session || session.userId !== ownerId) {
        throw new Error("A conta conectada mudou. Sincronização interrompida.");
      }
      return session.client;
    }

    async function run(ownerId) {
      if (active) throw new Error("Uma sincronização já está em andamento.");
      active = true;
      try {
        observe("autenticação");
        const client = await checkSession(ownerId);
        observe("leitura local");
        const snapshot = structuredClone(await adapter.read(ownerId));
        observe("consulta remota");
        const listed = await operations.listBoards(client, ownerId);
        const remote = [];
        for (const row of listed) {
          await checkSession(ownerId);
          observe("leitura remota e anexos");
          const value = await operations.loadBoard(client, ownerId, row.id);
          if (value.revision !== row.revision) {
            throw new Error("Um quadro mudou durante a consulta. Tente sincronizar novamente.");
          }
          remote.push({ ...value, remoteId: row.id });
        }
        await checkSession(ownerId);
        observe("reconciliação");
        const actions = reconcile.plan(snapshot.baseline, snapshot.boards, remote);
        const localById = new Map(snapshot.boards.map((board) => [board.id, board]));
        const baseById = new Map(snapshot.baseline.map((entry) => [entry.board.id, entry]));
        const remoteById = new Map(remote.map((entry) => [entry.board.id, entry]));
        const results = [];
        let version = snapshot.version;
        for (const { id, action } of actions) {
          await checkSession(ownerId);
          const board = localById.get(id);
          const cloud = remoteById.get(id);
          let localFiles = new Map();
          const deletionBoard = action === "delete-remote" ? baseById.get(id)?.board : null;
          if (board) localFiles = await adapter.files(ownerId, board);
          else if (deletionBoard) localFiles = cloud.files;
          const fileConflicts = [];
          if (cloud && action !== "delete-remote") {
            const stagesRemote = ["download", "adopt", "delete-local", "adopt-delete", "conflict"].includes(action);
            for (const [key, file] of cloud.files) {
              const local = localFiles.get(key) || (stagesRemote && adapter.readFile && await adapter.readFile(ownerId, key));
              if (local && !await sameFile(local, file)) fileConflicts.push(key);
            }
          }
          if (action === "conflict" || action === "remote-missing" || fileConflicts.length) {
            const base = baseById.get(id);
            const equal = (first, second) => first && second ? core.canonical(first) === core.canonical(second) : null;
            results.push({ id, action: "conflict", reason: fileConflicts.length ? "file-mismatch" : action, remote: cloud, fileConflicts,
              evidence: { capturedAt: new Date().toISOString(), baseRevision: base?.revision ?? null,
                remoteRevision: cloud?.revision ?? null, baseDeleted: base?.deleted === true,
                remoteDeleted: cloud?.deleted === true, localPresent: Boolean(board),
                localEqualsBase: equal(board, base?.board), remoteEqualsBase: equal(cloud?.board, base?.board),
                localEqualsRemote: equal(board, cloud?.board), attachmentConflicts: fileConflicts.length } });
            continue;
          }

          if ((action === "download" || action === "delete-local") && adapter.deferRemote?.()) {
            results.push({ id, action: "deferred" });
            continue;
          }

          let baseline;
          if (action === "create") {
            await checkSession(ownerId);
            observe("envio e verificação remota");
            const result = await operations.importBoard(client, ownerId, board, localFiles);
            baseline = { board, revision: result.revision };
          } else if (action === "upload" || action === "delete-remote") {
            await checkSession(ownerId);
            observe("envio e verificação remota");
            const result = await operations.saveBoard(client, ownerId, board || deletionBoard, localFiles, cloud.revision,
              { deleted: action === "delete-remote" });
            baseline = { board: board || deletionBoard, revision: result.revision, deleted: action === "delete-remote" };
          } else {
            baseline = { board: cloud.board, revision: cloud.revision, deleted: cloud.deleted === true };
          }

          await checkSession(ownerId);
          if (action === "download" || action === "adopt" || action === "delete-local" || action === "adopt-delete") {
            observe("armazenamento de anexos");
            await adapter.stageFiles(ownerId, cloud.files);
          }
          await checkSession(ownerId);
          observe("aplicação local");
          const nextVersion = await adapter.commit(ownerId, version, {
            id, baseline: structuredClone(baseline),
            board: action === "download" ? structuredClone(cloud.board) : undefined,
            archive: action === "delete-local" ? structuredClone(board) : undefined,
            remove: action === "delete-local"
          });
          if (nextVersion === null || nextVersion === undefined) {
            throw new Error("Os dados locais mudaram durante a sincronização. Nenhuma edição local foi substituída.");
          }
          version = nextVersion;
          results.push({ id, action });
        }
        return results;
      } finally {
        active = false;
      }
    }

    return { run };
  }

  return { create, sameFile };
});
