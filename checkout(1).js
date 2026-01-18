// DetailHQ Checkout

const SUPABASE_URL = "https://qcilpodwbtbsxoabjfzc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWxwb2R3YnRic3hvYWJqZnpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNzAzNTQsImV4cCI6MjA4MDg0NjM1NH0.RZ4M0bMSVhNpYZnktEyKCuJDFEpSJoyCmLFQhQLXs_w";

let supabaseClient = null;
let currentUser = null;

const apiBase = "https://api.detailhq.de";

function $(id) {
  return document.getElementById(id);
}

function setLoading(isLoading) {
  const overlay = $("checkout-loading");
  if (!overlay) return;
  overlay.style.display = isLoading ? "flex" : "none";
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setStatusPill(kind, text) {
  const pill = $("checkout-status-pill");
  if (!pill) return;

  pill.classList.remove("payment-pill--paid", "payment-pill--partial", "payment-pill--open");
  pill.classList.add("payment-pill");

  if (kind === "paid") pill.classList.add("payment-pill--paid");
  else if (kind === "open") pill.classList.add("payment-pill--open");
  else pill.classList.add("payment-pill--partial");

  pill.textContent = text || "—";
}

async function initSupabase() {
  if (!window.supabase) throw new Error("Supabase SDK nicht geladen.");
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      autoRefreshToken: true,
    },
  });
}

async function loadProfile() {
  if (!currentUser) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("plan_status, trial_ends_at, company_name")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Checkout: Profil konnte nicht geladen werden:", error);
    return null;
  }

  return data || null;
}

function applyAuthUI(isAuthed) {
  const hint = $("checkout-auth-hint");
  const startMonthly = $("checkout-start-monthly");
  const startYearly = $("checkout-start-yearly");
  const managePortal = $("checkout-manage-portal");
  const back = $("checkout-back-to-app");
  const profileBtn = $("profile-button");

  if (hint) hint.style.display = isAuthed ? "none" : "block";
  if (startMonthly) startMonthly.disabled = !isAuthed;
  if (startYearly) startYearly.disabled = !isAuthed;
  if (managePortal) managePortal.disabled = !isAuthed;
  if (profileBtn) profileBtn.style.display = isAuthed ? "inline-flex" : "none";
  if (back) back.style.display = "inline-flex";
}

function setupProfileMenu() {
  const profileButton = $("profile-button");
  const menu = $("profile-menu");
  const logoutButton = $("profile-logout-button");
  const manageButton = $("profile-manage-button");

  if (profileButton && menu) {
    profileButton.addEventListener("click", (e) => {
      e.preventDefault();
      menu.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!menu.classList.contains("hidden")) {
        const t = e.target;
        if (t === profileButton || profileButton.contains(t) || menu.contains(t)) return;
        menu.classList.add("hidden");
      }
    });
  }

  if (manageButton) {
    manageButton.addEventListener("click", () => {
      window.location.href = "/app#settings";
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await supabaseClient.auth.signOut();
      } catch (e) {
        console.error("Checkout: Logout Fehler:", e);
      } finally {
        window.location.href = "/app";
      }
    });
  }
}

function setupButtons() {
  const startMonthly = $("checkout-start-monthly");
  const startYearly = $("checkout-start-yearly");
  const managePortal = $("checkout-manage-portal");

  if (startMonthly) {
    startMonthly.addEventListener("click", () => {
      if (!currentUser) return;
      const url = `${apiBase}/billing/subscription?user=${encodeURIComponent(currentUser.id)}`;
      window.location.href = url;
    });
  }

  if (startYearly) {
    startYearly.addEventListener("click", () => {
      if (!currentUser) return;
      const url = `${apiBase}/billing/subscription-yearly?user=${encodeURIComponent(currentUser.id)}`;
      window.location.href = url;
    });
  }

  if (managePortal) {
    managePortal.addEventListener("click", () => {
      if (!currentUser) return;
      const url = `${apiBase}/billing/portal?user=${encodeURIComponent(currentUser.id)}`;
      window.location.href = url;
    });
  }
}

function renderStatus(profile) {
  const statusText = $("checkout-status-text");
  const planTitle = $("checkout-plan-title");
  const planDetail = $("checkout-plan-detail");

  const monthlyBtn = $("checkout-start-monthly");
  const yearlyBtn = $("checkout-start-yearly");

  if (!profile) {
    if (planTitle) planTitle.textContent = "—";
    if (planDetail) planDetail.textContent = "Bitte in der App einloggen.";
    setStatusPill("open", "Login");
    return;
  }

  const status = profile.plan_status || "trial";
  const trialEndsAt = profile.trial_ends_at;

  if (monthlyBtn) monthlyBtn.disabled = false;
  if (yearlyBtn) yearlyBtn.disabled = false;

  if (status === "active") {
    if (planTitle) planTitle.textContent = "Monatlich aktiv";
    if (planDetail) planDetail.textContent = "Du kannst jederzeit im Stripe-Portal kündigen oder wechseln.";
    setStatusPill("paid", "Aktiv");

    if (monthlyBtn) {
  monthlyBtn.disabled = true;
  monthlyBtn.classList.add("is-striked");
}
if (yearlyBtn) yearlyBtn.classList.remove("is-striked");
  } else if (status === "active_yearly") {
    if (planTitle) planTitle.textContent = "Jährlich aktiv";
    if (planDetail) planDetail.textContent = "Du kannst jederzeit im Stripe-Portal kündigen oder wechseln.";
    setStatusPill("paid", "Aktiv");

    if (yearlyBtn) {
  yearlyBtn.disabled = true;
  yearlyBtn.classList.add("is-striked");
}
if (monthlyBtn) monthlyBtn.classList.remove("is-striked");
  } else if (status === "trial") {
    const endText = formatDateTime(trialEndsAt);
    if (planTitle) planTitle.textContent = "Testphase aktiv";
    if (planDetail) planDetail.textContent = endText ? `Endet am ${endText}` : "Testphase aktiv.";
    setStatusPill("partial", "Trial");
  } else {
    if (planTitle) planTitle.textContent = "Kein Abo aktiv";
    if (planDetail) planDetail.textContent = "Wähle einen Plan und starte direkt.";
    setStatusPill("open", "Inaktiv");
  }
}

async function bootstrap() {
  setLoading(true);

  await initSupabase();
  setupProfileMenu();
  setupButtons();

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data && data.session ? data.session.user : null;

  applyAuthUI(!!currentUser);

  if (!currentUser) {
    renderStatus(null);
    setLoading(false);
    return;
  }

const avatarImg = $("profile-avatar-image");
if (avatarImg && (!avatarImg.getAttribute("src") || avatarImg.getAttribute("src").trim() === "")) {
  avatarImg.src =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' rx='48' fill='rgba(255,255,255,0.10)'/%3E%3Cpath d='M48 50c10 0 18-8 18-18S58 14 48 14 30 22 30 32s8 18 18 18zm0 8c-14 0-26 8-30 20h60c-4-12-16-20-30-20z' fill='rgba(255,255,255,0.55)'/%3E%3C/svg%3E";
}

  const profile = await loadProfile();
  renderStatus(profile);

  setLoading(false);
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((e) => {
    console.error("Checkout Bootstrap Fehler:", e);
    setLoading(false);
    if (statusText) statusText.textContent = "Fehler beim Laden";
    setStatusPill("open", "Fehler");
  });
});
