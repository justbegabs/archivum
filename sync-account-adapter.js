(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sync-import-core.js"));
  } else {
    root.EntrelinhasAccountAdapter = factory(root.EntrelinhasImportCore);
  }
})(globalThis, function (core) {
  "use strict";

  function create(store, session, mayCommit = () => true) {
    async function files(ownerId, board) {
      const result = new Map();
      for (const key of core.references(board)) {
        const file = await store.readFile(ownerId, key);
        if (!(file instanceof Blob)) throw new Error(`Arquivo local ausente: ${key}`);
        result.set(key, file);
      }
      return result;
    }

    async function commit(ownerId, version, change) {
      const record = await store.update(ownerId, version, (data) => {
        if (!mayCommit(ownerId, change)) throw new Error("O editor mudou durante a sincronização.");
        const prior = data.boards.find((board) => board.id === change.id);
        if (change.remove) {
          if (!prior || !change.archive || core.canonical(prior) !== core.canonical(change.archive)) {
            throw new Error("O quadro mudou antes de ser arquivado.");
          }
          data.archive.push({ board: prior, reason: "exclusão remota" });
          data.boards = data.boards.filter((board) => board.id !== change.id);
        } else if (change.board) {
          data.boards = data.boards.filter((board) => board.id !== change.id);
          data.boards.push(change.board);
        }
        data.baseline = data.baseline.filter((entry) => entry.board.id !== change.id);
        data.baseline.push(change.baseline);
        if (!data.boards.some((board) => board.id === data.activeBoardId)) {
          data.activeBoardId = data.boards[0]?.id || null;
        }
        return data;
      });
      return record ? record.version : null;
    }

    async function saveDraft(ownerId, version, draft) {
      return store.update(ownerId, version, (data) => {
        const remaining = new Set(draft.boards.map((board) => board.id));
        for (const board of data.boards) {
          if (!remaining.has(board.id)) data.archive.push({ board, reason: "exclusão local" });
        }
        data.boards = structuredClone(draft.boards);
        data.activeBoardId = draft.activeBoardId;
        data.theme = draft.theme;
        return data;
      });
    }

    return {
      session,
      read: (ownerId) => store.read(ownerId),
      readFile: (ownerId, key) => store.readFile(ownerId, key),
      files,
      stageFiles: (ownerId, incoming) => store.putFiles(ownerId, incoming),
      commit,
      saveDraft
    };
  }

  return { create };
});
