(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sync-import-core.js"), require("./sync-reconcile.js"));
  } else {
    root.EntrelinhasDiagnostic = factory(root.EntrelinhasImportCore, root.EntrelinhasReconcile);
  }
})(globalThis, function (core, reconcile) {
  "use strict";

  async function digest(value) {
    if (!globalThis.crypto?.subtle) throw new Error("O diagnóstico exige HTTPS ou localhost.");
    const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function fingerprint(value) {
    return (await digest(value)).slice(0, 16);
  }

  async function report({ owner, record, visible, remote, conflicts, meta }) {
    const locals = new Map(record.boards.map((board) => [board.id, board]));
    const onScreen = new Map(visible.map((board) => [board.id, board]));
    const bases = new Map(record.baseline.map((entry) => [entry.board.id, entry]));
    const clouds = new Map(remote.map((entry) => [entry.board.id, entry]));
    const old = new Map(conflicts.map((entry) => [entry.id, entry]));
    const ids = new Set([...locals.keys(), ...onScreen.keys(), ...bases.keys(), ...clouds.keys(), ...old.keys()]);
    let actions;
    let reconciliationError = false;
    try {
      actions = new Map(reconcile.plan(record.baseline, record.boards, remote).map(({ id, action }) => [id, action]));
    } catch (error) {
      reconciliationError = true;
      actions = new Map();
    }
    const boards = [];
    for (const id of ids) {
      const local = locals.get(id);
      const screen = onScreen.get(id);
      const base = bases.get(id);
      const cloud = clouds.get(id);
      const conflict = old.get(id);
      const hashes = await Promise.all([local, screen, base?.board, cloud?.board, conflict?.remote?.board]
        .map((board) => board ? digest(core.canonical(board)) : null));
      const eq = (a, b) => hashes[a] === null || hashes[b] === null ? null : hashes[a] === hashes[b];
      const evidence = conflict?.evidence;
      boards.push({
        boardFingerprint: await fingerprint(id),
        remoteIdFingerprint: cloud?.remoteId ? await fingerprint(cloud.remoteId) : null,
        localPresent: Boolean(local), visiblePresent: Boolean(screen), baseRevision: base?.revision ?? null,
        remoteRevision: cloud?.revision ?? null, baseDeleted: base?.deleted === true,
        remoteDeleted: cloud?.deleted === true, localEqualsBase: eq(0, 2), remoteEqualsBase: eq(3, 2),
        localEqualsRemote: eq(0, 3), visibleEqualsLocal: eq(1, 0), visibleEqualsRemote: eq(1, 3),
        localChangePending: base ? (local ? base.deleted === true || !eq(0, 2) : base.deleted !== true) : Boolean(local),
        conflictRemoteEqualsCurrentRemote: eq(4, 3), currentPlan: actions.get(id) || null,
        previousConflict: conflict ? {
          reason: ["conflict", "remote-missing", "file-mismatch"].includes(conflict.reason) ? conflict.reason : "outro",
          attempt: conflict.diagnosticAttempt ?? null, attemptAt: conflict.diagnosticAttemptAt ?? null,
          observed: evidence ? {
            capturedAt: evidence.capturedAt, baseRevision: evidence.baseRevision, remoteRevision: evidence.remoteRevision,
            baseDeleted: evidence.baseDeleted, remoteDeleted: evidence.remoteDeleted, localPresent: evidence.localPresent,
            localEqualsBase: evidence.localEqualsBase, remoteEqualsBase: evidence.remoteEqualsBase,
            localEqualsRemote: evidence.localEqualsRemote, attachmentConflicts: evidence.attachmentConflicts
          } : null
        } : null,
        conflictRemoteRevision: conflict?.remote?.revision ?? null
      });
    }
    return {
      format: "entrelinhas-diagnostic-v1", generatedAt: new Date().toISOString(),
      authentication: "conta verificada", remoteQuery: "concluída",
      accountFingerprint: await fingerprint(owner.toLowerCase()),
      appVersion: meta.appVersion, localRecordVersion: record.version,
      localBoards: record.boards.length, visibleBoards: visible.length, remoteBoards: remote.length,
      pendingJournals: meta.pendingJournals, journalChangedDuringRead: meta.journalChangedDuringRead,
      localChangedDuringRead: meta.localChangedDuringRead, editorChangedDuringRead: meta.editorChangedDuringRead,
      remoteListChangedDuringRead: meta.remoteListChangedDuringRead,
      syncInProgress: meta.syncInProgress, syncAttemptChangedDuringRead: meta.syncAttemptChangedDuringRead,
      lastAttempt: meta.lastAttempt, lastSuccess: meta.lastSuccess, lastStage: meta.lastStage,
      lastErrorCategory: meta.lastErrorCategory, attempts: meta.attempts,
      blocked: meta.blocked, online: meta.online, nextAttempt: meta.nextAttempt,
      events: meta.events, reconciliationError, boards,
      note: "Comparações de SHA-256 são calculadas localmente; hashes dos documentos não são exportados. O plano atual não inclui comparação de anexos. Leituras não são uma transação global."
    };
  }

  return { report };
});
