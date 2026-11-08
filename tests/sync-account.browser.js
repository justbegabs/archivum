// Executar em origem HTTP local com os módulos carregados na página.
window.runAccountStoreTests = async function () {
  const name = `entrelinhas-store-test-${crypto.randomUUID()}`;
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const store = window.EntrelinhasAccountStore.create(indexedDB, name);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const file = (text, name) => new File([text], name, { type: "text/plain", lastModified: 1 });
  const board = { id: "board", title: "Teste", cards: [{ imageId: "image" }], connections: [] };
  const checks = [];
  try {
    const adapter = window.EntrelinhasAccountAdapter.create(store, async () => ({ userId: a, client: {} }));
    await store.putFiles(a, new Map([["image", file("primeiro", "a.txt")]]));
    await store.putFiles(b, new Map([["image", file("segundo", "b.txt")]]));
    assert(await (await store.readFile(a, "image")).text() === "primeiro", "Arquivo da conta A incorreto.");
    assert(await (await store.readFile(b, "image")).text() === "segundo", "Arquivo da conta B incorreto.");
    checks.push("isolamento de anexos");

    const written = await adapter.saveDraft(a, 0, { boards: [board], activeBoardId: board.id, theme: "light" });
    assert(written.version === 1 && (await store.read(b)).boards.length === 0, "Isolamento de contas falhou.");
    const race = await Promise.all([
      store.update(a, 1, (record) => ({ ...record, theme: "dark" })),
      store.update(a, 1, (record) => ({ ...record, theme: "light" }))
    ]);
    assert(race.filter(Boolean).length === 1, "Duas escritas com a mesma versão foram aceitas.");
    checks.push("isolamento de contas e escritas concorrentes");

    let refused = false;
    try {
      await store.putFiles(a, new Map([["new", file("novo", "n.txt")], ["image", file("alterado", "a.txt")]]));
    } catch (error) {
      if (!error.message.includes("conteúdo diferente")) throw error;
      refused = true;
    }
    assert(refused && !await store.readFile(a, "new"), "Uma escrita parcial foi aceita.");
    assert(await (await store.readFile(a, "image")).text() === "primeiro", "Arquivo original foi substituído.");
    checks.push("anexos imutáveis e reversão transacional");

    const snapshot = await store.snapshot(a);
    assert(snapshot.files.size === 1 && await snapshot.files.get("image").text() === "primeiro",
      "Retrato de backup misturou contas ou omitiu anexos.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const objectStore = tx.objectStore("files");
      const request = objectStore.get([a, "image"]);
      request.onsuccess = () => { request.result.hash = "corrompido"; objectStore.put(request.result, [a, "image"]); };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    let corrupted = false;
    try { await store.snapshot(a); } catch (error) {
      if (!error.message.includes("integridade")) throw error;
      corrupted = true;
    }
    assert(corrupted, "Backup aceitou metadados de integridade corrompidos.");
    checks.push("backup isolado e integridade de anexos");

    const beforeDelete = await store.read(a);
    const afterDelete = await adapter.saveDraft(a, beforeDelete.version, { boards: [], activeBoardId: null, theme: "light" });
    assert(afterDelete.archive.length === 1 && afterDelete.archive[0].board.id === board.id, "Quadro excluído não foi arquivado.");
    assert(await (await store.readFile(a, "image")).text() === "primeiro", "Anexo arquivado foi apagado.");
    checks.push("exclusão local preserva quadro e anexo");
    return checks;
  } finally {
    await store.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error("Falha ao remover banco de teste."));
      request.onblocked = () => reject(new Error("Banco de teste bloqueado."));
    });
  }
};
