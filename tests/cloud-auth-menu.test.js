const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("menu mostra foto Google confiável, preserva alternativa e atualiza ao sair", async () => {
  const elements = new Map();
  function element() {
    return {
      hidden: false, disabled: false, children: [], classList: { add() {}, remove() {} },
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text || ""; },
      addEventListener(name, callback) { this[name] = callback; },
      append(child) { this.children.push(child); },
      remove() { this.removed = true; }
    };
  }
  for (const id of ["cloud-login", "cloud-logout", "cloud-account", "account-menu-toggle", "cloud-status"]) {
    elements.set(`#${id}`, element());
  }
  let onAuthChange;
  const auth = {
    getSession: async () => ({ data: { session: { user: {
      id: "owner", email: "example@example.test",
      user_metadata: { avatar_url: "https://lh3.googleusercontent.com/photo" }
    } } }, error: null }),
    onAuthStateChange: (callback) => { onAuthChange = callback; }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "cloud-auth.js"), "utf8")
    .replace('import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.10/+esm")',
      "Promise.resolve({ createClient: () => ({ auth }) })");
  const context = {
    auth, URL, console, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { querySelector: (selector) => elements.get(selector), createElement: element },
    location: { protocol: "https:" }, window: { dispatchEvent() {} }
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  const avatar = elements.get("#account-menu-toggle");
  assert.equal(avatar.textContent, "E");
  assert.equal(avatar.children[0].src, "https://lh3.googleusercontent.com/photo");
  assert.equal(avatar.children[0].referrerPolicy, "no-referrer");
  avatar.children[0].error();
  assert.equal(avatar.children[0].removed, true);
  onAuthChange("SIGNED_IN", { user: { id: "owner", email: "example@example.test", user_metadata: { picture: "https://attacker.example/avatar" } } });
  assert.equal(avatar.children.length, 0);
  onAuthChange("SIGNED_OUT", null);
  assert.equal(avatar.textContent, "V");
  assert.equal(elements.get("#cloud-login").hidden, false);
  assert.equal(elements.get("#cloud-logout").hidden, true);
});
