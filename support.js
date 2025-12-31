// ================================
// Support Page (Login required)
// ================================

const SUPABASE_URL = "https://qcilpodwbtbsxoabjfzc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWxwb2R3YnRic3hvYWJqZnpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNzAzNTQsImV4cCI6MjA4MDg0NjM1NH0.RZ4M0bMSVhNpYZnktEyKCuJDFEpSJoyCmLFQhQLXs_w";

const APP_URL = "/app"; // Zurück zur App (dein Setup)

let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });
} catch (e) {
  console.error("Support: Supabase init failed", e);
}

const el = (id) => document.getElementById(id);

const backBtn = el("support-back");
const logoutBtn = el("support-logout");
const submitBtn = el("support-submit");

const topicEl = el("support-topic");
const msgEl = el("support-message");
const errEl = el("support-error");
const successEl = el("support-success");

function setError(text) {
  if (!errEl) return;
  errEl.textContent = text || "";
}

function setSuccess(visible) {
  if (!successEl) return;
  successEl.style.display = visible ? "block" : "none";
}

function normalizeTopic(value) {
  const map = {
    problem_mit_zahlung: "Problem mit Zahlung",
    abo_verwalten: "Abo verwalten",
    app_fehler: "App-Fehler",
    login_probleme: "Login-Probleme",
    fragen: "Fragen",
    sonstiges: "Sonstiges",
  };
  return map[value] || "Sonstiges";
}

async function requireSessionOrRedirect() {
  if (!supabaseClient) {
    window.location.href = APP_URL;
    return null;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    window.location.href = APP_URL;
    return null;
  }

  const session = data?.session || null;
  if (!session?.user) {
    window.location.href = APP_URL;
    return null;
  }

  return session;
}

async function logout() {
  try {
    if (supabaseClient) await supabaseClient.auth.signOut();
  } catch (e) {}
  window.location.href = APP_URL;
}

async function sendSupportTicket(session) {
  const user = session.user;

  const topicValue = (topicEl?.value || "").trim();
  const topicLabel = normalizeTopic(topicValue);
  const message = (msgEl?.value || "").trim();

  if (!message || message.length < 8) {
    setError("Bitte beschreibe dein Anliegen (mindestens 8 Zeichen).");
    return;
  }

  setError("");
  setSuccess(false);
  submitBtn.disabled = true;
  submitBtn.textContent = "Sende...";

  try {
    const API_BASE = "https://api.detailhq.de";

const res = await fetch(`${API_BASE}/support/ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // wichtig: Worker prüft Supabase JWT über /auth/v1/user
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        topic: topicLabel,
        message
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Support send failed: ${res.status} ${t}`);
    }

    msgEl.value = "";
    setSuccess(true);
  } catch (e) {
    console.error(e);
    setError("Konnte Ticket nicht senden. Bitte später erneut versuchen.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Absenden";
  }
}

async function init() {
  const session = await requireSessionOrRedirect();
  if (!session) return;

  backBtn?.addEventListener("click", () => {
    window.location.href = APP_URL;
  });

  logoutBtn?.addEventListener("click", logout);

  submitBtn?.addEventListener("click", async () => {
    const s = await requireSessionOrRedirect();
    if (!s) return;
    await sendSupportTicket(s);
  });

  // Optional: Enter verhindern im textarea (falls du das willst)
  // msgEl?.addEventListener("keydown", (e) => {
  //   if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitBtn.click();
  // });
}

init();
