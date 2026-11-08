(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sync-import-core.js").canonical);
  } else {
    root.EntrelinhasReconcile = factory(root.EntrelinhasImportCore.canonical);
  }
})(globalThis, function (canonical) {
  "use strict";

  function indexBoards(entries, kind) {
    if (!Array.isArray(entries)) throw new Error(`Lista ${kind} inválida.`);
    const result = new Map();
    for (const entry of entries) {
      const board = kind === "local" ? entry : entry?.board;
      if (!board || typeof board.id !== "string" || !board.id ||
          typeof board.title !== "string" || !Array.isArray(board.cards) ||
          !Array.isArray(board.connections) || result.has(board.id)) {
        throw new Error(`Quadro ${kind} inválido ou duplicado.`);
      }
      if (kind !== "local" && (!Number.isSafeInteger(entry.revision) || entry.revision < 0)) {
        throw new Error(`Revisão ${kind} inválida.`);
      }
      if (kind !== "local" && entry.deleted !== undefined && typeof entry.deleted !== "boolean") {
        throw new Error(`Estado de exclusão ${kind} inválido.`);
      }
      result.set(board.id, entry);
    }
    return result;
  }

  function plan(baseline, local, remote) {
    const bases = indexBoards(baseline, "base");
    const locals = indexBoards(local, "local");
    const remotes = indexBoards(remote, "remoto");
    const ids = new Set([...bases.keys(), ...locals.keys(), ...remotes.keys()]);
    const actions = [];
    for (const id of [...ids].sort()) {
      const base = bases.get(id);
      const current = locals.get(id);
      const cloud = remotes.get(id);
      const equal = (a, b) => canonical(a) === canonical(b);
      const deleted = (entry) => entry?.deleted === true;
      let action;
      if (!base) {
        if (!current) action = cloud && deleted(cloud) ? "adopt-delete" : "download";
        else if (!cloud) action = "create";
        else action = !deleted(cloud) && equal(current, cloud.board) ? "adopt" : "conflict";
      } else if (!cloud) {
        // Ausência não prova exclusão: a listagem ou o acesso podem ter falhado.
        action = "remote-missing";
      } else {
        if (cloud.revision < base.revision ||
            (cloud.revision === base.revision &&
             (!equal(cloud.board, base.board) || deleted(cloud) !== deleted(base)))) {
          throw new Error(`Revisão remota inconsistente para o quadro ${id}.`);
        }
        const remoteChanged = !equal(cloud.board, base.board) || deleted(cloud) !== deleted(base);
        const localChanged = current ? deleted(base) || !equal(current, base.board) : !deleted(base);
        if (!localChanged && !remoteChanged) action = deleted(base) ? "adopt-delete" : "adopt";
        else if (!localChanged) action = deleted(cloud) ? "delete-local" : "download";
        else if (!remoteChanged) action = current ? "upload" : "delete-remote";
        else if (!current && deleted(cloud)) action = "adopt-delete";
        else if (current && !deleted(cloud) && equal(current, cloud.board)) action = "adopt";
        else action = "conflict";
      }
      actions.push({ id, action });
    }
    return actions;
  }

  return { plan };
});
