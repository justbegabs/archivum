const test = require("node:test");
const assert = require("node:assert/strict");
const { importBoard, saveBoard, loadBoard } = require("../sync-import-core.js");

const owner = "01234567-89ab-cdef-0123-456789abcdef";
const other = "11234567-89ab-cdef-0123-456789abcdef";
const board = {
  id: "local-1", title: "Teste",
  cards: [{ id: "folder", type: "folder", cards: [{ imageId: "image" }], connections: [] }],
  connections: [], coverId: "image"
};
const files = () => new Map([["image", new File(["bytes"], "imagem.png", { type: "image/png", lastModified: 1 })]]);

function fakeServer(serverOwner = owner) {
  const rows = new Map();
  const objects = new Map();
  const control = { uploads: 0, writes: 0, failUpload: false, loseUploadResponse: false, corruptUpload: false, loseResponse: false, denyRead: false, race: false };
  const bucket = {
    async download(path) {
      if (control.denyRead) return { error: { status: 403, message: "proibido" } };
      return objects.has(path) ? { data: objects.get(path), error: null } : { data: null, error: { status: 404 } };
    },
    async upload(path, blob, options) {
      assert.equal(options.upsert, false);
      control.uploads += 1;
      if (control.failUpload) return { error: { status: 500, message: "falha" } };
      if (objects.has(path)) return { error: { status: 409 } };
      objects.set(path, control.corruptUpload ? new Blob(["corrompido"]) : blob);
      if (control.loseUploadResponse) return { error: { status: 500, message: "resposta perdida" } };
      return { data: {}, error: null };
    }
  };
  const client = {
    storage: { from: (name) => { assert.equal(name, "entrelinhas-sync-private"); return bucket; } },
    from: (name) => {
      assert.equal(name, "entrelinhas_sync_boards");
      return { select: () => ({ eq: (_column, id) => ({ maybeSingle: async () => ({ data: rows.get(id) || null, error: null }) }) }) };
    },
    async rpc(name, args) {
      assert.equal(name, "entrelinhas_sync_save");
      control.writes += 1;
      if (args.p_expected_owner_id !== serverOwner) return { error: { code: "42501", message: "conta incorreta" } };
      const current = rows.get(args.p_board_id);
      if (args.p_expected_revision === null) {
        if (current) return { error: { message: "duplicado" } };
        rows.set(args.p_board_id, { id: args.p_board_id, owner_id: serverOwner, revision: 0, document: structuredClone(args.p_document) });
      } else {
        if (control.race && current) {
          rows.set(args.p_board_id, { ...current, revision: current.revision + 1, document: { ...current.document, board: { ...current.document.board, title: "Edição concorrente" } } });
          return { error: { code: "40001", message: "conflito" } };
        }
        if (!current || current.owner_id !== serverOwner || current.revision !== args.p_expected_revision) {
          return { error: { message: "conflito" } };
        }
        rows.set(args.p_board_id, { ...current, revision: current.revision + 1, document: structuredClone(args.p_document) });
      }
      return control.loseResponse ? { error: { message: "resposta perdida" } } : { error: null };
    }
  };
  return { rows, objects, control, client };
}

test("importa, verifica e retoma sem duplicar ou modificar a origem", async () => {
  const server = fakeServer();
  const input = structuredClone(board);
  const first = await importBoard(server.client, owner, input, files());
  const second = await importBoard(server.client, owner, input, files());
  assert.deepEqual(first, second);
  assert.equal(first.files, 1);
  assert.equal(server.control.uploads, 1);
  assert.equal(server.control.writes, 1);
  assert.deepEqual(input, board);
});

test("interrupção de upload não grava quadro e pode ser retomada", async () => {
  const server = fakeServer();
  server.control.failUpload = true;
  await assert.rejects(importBoard(server.client, owner, board, files()), /enviar o arquivo/);
  assert.equal(server.rows.size, 0);
  server.control.failUpload = false;
  await importBoard(server.client, owner, board, files());
  assert.equal(server.rows.size, 1);
});

test("recupera resposta perdida sem duplicar quadro", async () => {
  const server = fakeServer();
  server.control.loseResponse = true;
  await importBoard(server.client, owner, board, files());
  await importBoard(server.client, owner, board, files());
  assert.equal(server.control.writes, 1);
});

test("retoma upload concluído cuja resposta se perdeu", async () => {
  const server = fakeServer();
  server.control.loseUploadResponse = true;
  await assert.rejects(importBoard(server.client, owner, board, files()), /enviar o arquivo/);
  assert.equal(server.rows.size, 0);
  server.control.loseUploadResponse = false;
  await importBoard(server.client, owner, board, files());
  assert.equal(server.control.uploads, 1);
  assert.equal(server.rows.size, 1);
});

test("não grava quadro se o arquivo enviado falhar na verificação", async () => {
  const server = fakeServer();
  server.control.corruptUpload = true;
  await assert.rejects(importBoard(server.client, owner, board, files()), /integridade/);
  assert.equal(server.rows.size, 0);
});

test("recusa quadros alterados sem sobrescrever dados remotos", async () => {
  const server = fakeServer();
  await importBoard(server.client, owner, board, files());
  const changed = { ...board, title: "Alterado" };
  await assert.rejects(importBoard(server.client, owner, changed, files()), /difere/);
  assert.equal(server.control.writes, 1);
});

test("recusa arquivos ausentes ou corrompidos e falhas de autorização", async () => {
  const server = fakeServer();
  await assert.rejects(importBoard(server.client, owner, board, new Map()), /local ausente/);
  await importBoard(server.client, owner, board, files());
  const path = [...server.objects.keys()][0];
  server.objects.set(path, new Blob(["bytes modificados"]));
  await assert.rejects(importBoard(server.client, owner, board, files()), /corrompido/);
  server.control.denyRead = true;
  await assert.rejects(importBoard(server.client, owner, board, files()), /proibido/);
});

test("identificadores de quadros são diferentes entre contas", async () => {
  const first = fakeServer();
  const second = fakeServer(other);
  const a = await importBoard(first.client, owner, { ...board, cards: [], coverId: undefined }, new Map());
  const b = await importBoard(second.client, other, { ...board, cards: [], coverId: undefined }, new Map());
  assert.notEqual(a.id, b.id);
});

test("mudança de conta antes de gravar impede gravar o quadro em outra conta", async () => {
  const server = fakeServer(other);
  await assert.rejects(importBoard(server.client, owner, board, files()), /conta incorreta/);
  assert.equal(server.rows.size, 0);
});

test("carrega o quadro e os anexos verificados sem alterar o original", async () => {
  const server = fakeServer();
  const result = await importBoard(server.client, owner, board, files());
  const loaded = await loadBoard(server.client, owner, result.id);
  assert.deepEqual(loaded.board, board);
  assert.equal(loaded.files.get("image").name, "imagem.png");
  assert.equal(await loaded.files.get("image").text(), "bytes");
  await assert.rejects(loadBoard(server.client, other, result.id), /indisponível/);
});

test("salva revisão esperada e recusa edição antiga sem sobrescrever", async () => {
  const server = fakeServer();
  const result = await importBoard(server.client, owner, board, files());
  const changed = { ...board, title: "Novo título" };
  const saved = await saveBoard(server.client, owner, changed, files(), 0);
  assert.equal(saved.revision, 1);
  await assert.rejects(saveBoard(server.client, owner, board, files(), 0), /Conflito/);
  assert.equal((await loadBoard(server.client, owner, result.id)).board.title, "Novo título");
});

test("confirma atualização mesmo se a resposta da gravação se perder", async () => {
  const server = fakeServer();
  await importBoard(server.client, owner, board, files());
  server.control.loseResponse = true;
  const saved = await saveBoard(server.client, owner, { ...board, title: "Novo" }, files(), 0);
  assert.equal(saved.revision, 1);
});

test("edição concorrente durante gravação não é sobrescrita", async () => {
  const server = fakeServer();
  const imported = await importBoard(server.client, owner, board, files());
  server.control.race = true;
  const local = { ...board, title: "Edição local" };
  await assert.rejects(saveBoard(server.client, owner, local, files(), 0), /edição local foi preservada/);
  assert.equal(local.title, "Edição local");
  assert.equal((await loadBoard(server.client, owner, imported.id)).board.title, "Edição concorrente");
});

test("recusa manifesto alterado e arquivo remoto corrompido ao carregar", async () => {
  const server = fakeServer();
  const result = await importBoard(server.client, owner, board, files());
  const row = server.rows.get(result.id);
  row.document.files[0].path = `${other}/${row.document.files[0].sha256}`;
  await assert.rejects(loadBoard(server.client, owner, result.id), /Manifesto/);
  row.document.files[0].path = `${owner}/${row.document.files[0].sha256}`;
  server.objects.set(row.document.files[0].path, new Blob(["errado"]));
  await assert.rejects(loadBoard(server.client, owner, result.id), /integridade/);
});
