(() => {
  const projectUrl = "https://rpmusdhpsfunguskemkz.supabase.co";
  const publishableKey = "sb_publishable_MWo4gf_NjtNdz53fjh8s0w_nqUzykG7";
  const login = document.querySelector("#cloud-login");
  const logout = document.querySelector("#cloud-logout");
  const label = document.querySelector("#cloud-account");
  const message = document.querySelector("#cloud-status");
  let client;

  function showError(text, error) {
    console.error(text, error);
    message.textContent = text;
    message.classList.add("error");
  }

  function showSession(session) {
    const user = session?.user;
    login.hidden = Boolean(user);
    logout.hidden = !user;
    label.textContent = user ? `Conectado: ${user.email || "conta Google"}` : "Não conectado";
  }

  async function initialize() {
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.10/+esm");
      client = createClient(projectUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      showSession(data.session);
      client.auth.onAuthStateChange((_event, session) => showSession(session));
      login.disabled = false;
    } catch (error) {
      showError("Não foi possível iniciar o login. Verifique a conexão e recarregue a página.", error);
    }
  }

  login.addEventListener("click", async () => {
    if (!client) return;
    login.disabled = true;
    message.textContent = "";
    message.classList.remove("error");
    try {
      const redirectTo = new URL(location.pathname, location.origin).href;
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
    } catch (error) {
      showError("Não foi possível entrar com Google. Verifique a configuração do Supabase.", error);
      login.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    if (!client) return;
    logout.disabled = true;
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      message.textContent = "";
      message.classList.remove("error");
      showSession(null);
    } catch (error) {
      showError("Não foi possível sair da conta.", error);
    } finally {
      logout.disabled = false;
    }
  });

  if (!["http:", "https:"].includes(location.protocol)) {
    showError("O login exige que o site seja aberto por HTTP ou HTTPS.", new Error("Origem incompatível"));
  } else {
    initialize();
  }
})();
