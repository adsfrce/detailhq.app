// ================================
// Supabase Setup
// ================================
const SUPABASE_URL = "https://qcilpodwbtbsxoabjfzc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWxwb2R3YnRic3hvYWJqZnpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNzAzNTQsImV4cCI6MjA4MDg0NjM1NH0.RZ4M0bMSVhNpYZnktEyKCuJDFEpSJoyCmLFQhQLXs_w";
const WORKER_API_BASE = "https://api.detailhq.de";

function normCode(s) {
  return String(s || "").trim().toUpperCase();
}

function eurToCents(eur) {
  const x = Number(eur);
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.round(x * 100));
}

function centsToEurText(cents) {
  const v = (Number(cents || 0) / 100);
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

let supabaseClient = null;

try {
  console.log("DetailHQ: Supabase global typeof =", typeof supabase);
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

  console.log("DetailHQ: Supabase Client initialisiert");
} catch (err) {
  console.error("DetailHQ: Supabase initialisation FAILED:", err);
}

// Make Webhook
const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/6tf25stiy013xfr1v7ox1ewb9t9qdrth";

async function notifyMakeNewUser() {
  console.log("DetailHQ: notifyMakeNewUser CALLED");
  if (!MAKE_WEBHOOK_URL) return;
  try {
    const res = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "new_user" }),
    });
    console.log("DetailHQ: Make new_user response", res.status);
  } catch (err) {
    console.error("DetailHQ: Make new_user notification failed:", err);
  }
}

// ================================
// AFFILIATE (first-touch)
// ================================
function getAffiliateRefFromUrl() {
  const url = new URL(window.location.href);
  const ref = (url.searchParams.get("ref") || "").trim();
  return ref || null;
}

function saveAffiliateRefFirstTouch() {
  const ref = getAffiliateRefFromUrl();
  if (!ref) return;

  if (!localStorage.getItem("affiliate_ref")) {
    localStorage.setItem("affiliate_ref", ref);
    localStorage.setItem("affiliate_first_touch_at", new Date().toISOString());
  }
}

async function persistAffiliateRefToProfileIfMissing() {
  if (!currentUser || !supabaseClient) return;

  const ref = localStorage.getItem("affiliate_ref");
  const firstTouch = localStorage.getItem("affiliate_first_touch_at");
  if (!ref) return;

  // nur setzen, wenn im Profil noch leer
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("affiliate_ref")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) return;
  if (data?.affiliate_ref) return;

  await supabaseClient
    .from("profiles")
    .update({
      affiliate_ref: ref,
      affiliate_first_touch_at: firstTouch || new Date().toISOString(),
    })
    .eq("id", currentUser.id);
}

// Theme Key muss VOR init bekannt sein
const THEME_KEY = "detailhq_theme";

// ================================
// GLOBAL STATE
// ================================
let currentUser = null;
let currentProfile = null;
let currentCalendarUrl = "";
let vehicleClasses = [];
let services = [];
let allBookings = [];
let currentBookingStep = 1;
let currentDetailBooking = null;
let lastStatsBookings = [];
// Review-Reminder State (lokal)
const REVIEW_REMINDER_STORAGE_KEY = "detailhq_review_reminders";
let reviewReminderState = {};

function loadReviewReminderState() {
  try {
    const raw = localStorage.getItem(REVIEW_REMINDER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReviewReminderState() {
  try {
    localStorage.setItem(
      REVIEW_REMINDER_STORAGE_KEY,
      JSON.stringify(reviewReminderState || {})
    );
  } catch (err) {
    console.error("ReviewReminderState speichern fehlgeschlagen:", err);
  }
}

function startReviewReminderTimer() {
  // aktueller Stand: nur State laden, keine weiteren Aktionen
  reviewReminderState = loadReviewReminderState();
}

// ================================
// DOM REFERENZEN
// ================================
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");

// Auth
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const authError = document.getElementById("auth-error");
const registerSwitch = document.getElementById("register-switch");
const loginSwitch = document.getElementById("login-switch");
const passwordResetButton = document.getElementById("password-reset-button");
const registerBusinessTypesList = document.getElementById("register-business-types");
const registerBusinessMenu = document.getElementById("register-business-menu");
const registerBusinessToggle = document.getElementById("register-business-toggle");
const registerBusinessLabel = document.getElementById("register-business-label");

// Navigation / Tabs
const navItems = document.querySelectorAll(".nav-item");
const tabSections = document.querySelectorAll(".tab-section");
const headerTitle = document.getElementById("header-title");
const headerSubtitle = document.getElementById("header-subtitle");

// Profil / Menü
const profileButton = document.getElementById("profile-button");
const profileMenu = document.getElementById("profile-menu");
const profileManageButton = document.getElementById("profile-manage-button");
const profileLogoutButton = document.getElementById("profile-logout-button");

// Avatar
const profileAvatarImage = document.getElementById("profile-avatar-image");

// Trial-Banner
const trialBanner = document.getElementById("trial-banner");
const trialBannerText = document.getElementById("trial-banner-text");
const trialBannerButton = document.getElementById("trial-banner-button");

// Profil-Modal
const profileModal = document.getElementById("profile-modal");
const profileCloseButton = document.getElementById("profile-close-button");
const profileForm = document.getElementById("profile-form");
const profileNameInput = document.getElementById("profile-name");
const profileCompanyInput = document.getElementById("profile-company");
const profileAddressInput = document.getElementById("profile-address");
const profileAvatarFile = document.getElementById("profile-avatar-file");
const profileSaveMessage = document.getElementById("profile-save-message");

// Booking-Detail-Modal
const bookingDetailModal = document.getElementById("booking-detail-modal");
const bookingDetailTitle = document.getElementById("booking-detail-title");
const bookingDetailMeta = document.getElementById("booking-detail-meta");
const bookingDetailPrice = document.getElementById("booking-detail-price");

// NEU:
const bookingDetailDateInput = document.getElementById("booking-detail-date");
const bookingDetailTimeInput = document.getElementById("booking-detail-time");
const bookingDetailCarInput = document.getElementById("booking-detail-car");
const bookingDetailVehicleClassSelect = document.getElementById(
  "booking-detail-vehicle-class"
);
const bookingDetailDiscountTypeSelect = document.getElementById(
  "booking-detail-discount-type"
);
const bookingDetailDiscountValueInput = document.getElementById(
  "booking-detail-discount-value"
);

const bookingDetailMainServiceSelect = document.getElementById(
  "booking-detail-main-service"
);
const bookingDetailSinglesSelect = document.getElementById(
  "booking-detail-singles"
);

const bookingDetailCustomerNameInput = document.getElementById(
  "booking-detail-customer-name"
);
const bookingDetailCustomerEmailInput = document.getElementById(
  "booking-detail-customer-email"
);
const bookingDetailCustomerPhoneInput = document.getElementById(
  "booking-detail-customer-phone"
);
const bookingDetailCustomerAddressInput = document.getElementById(
  "booking-detail-customer-address"
);
const bookingDetailSinglesList = document.getElementById(
  "booking-detail-singles-list"
);
const bookingDetailSinglesMenu = document.getElementById(
  "booking-detail-singles-menu"
);
const bookingDetailSinglesToggle = document.getElementById(
  "booking-detail-singles-toggle"
);
const bookingDetailSinglesLabel = document.getElementById("booking-detail-singles-label");

const bookingDetailBookingContainer = document.getElementById("booking-detail-booking");
const bookingDetailCustomerContainer = document.getElementById("booking-detail-customer");
const bookingDetailNotes = document.getElementById("booking-detail-notes");
const bookingDetailJobStatusSelect = document.getElementById("booking-detail-job-status");
const bookingDetailPaymentStatusSelect = document.getElementById("booking-detail-payment-status");
const bookingDetailCloseButton = document.getElementById("booking-detail-close");
const bookingDetailSaveButton = document.getElementById("booking-detail-save");
const bookingDetailDeleteButton = document.getElementById("booking-detail-delete-button");
const bookingDetailPartialAmountInput = document.getElementById(
  "booking-detail-partial-amount"
);
const bookingDetailPaidOverrideInput = document.getElementById(
  "booking-detail-paid-override-amount"
);
const bookingDetailPartialRow = document.querySelector(
  ".payment-partial-row"
);
const bookingDetailPaidOverrideRow = document.querySelector(
  ".payment-paid-override-row"
);
const bookingPackageToggle = document.getElementById("booking-package-toggle");
const bookingPackageLabel  = document.getElementById("booking-package-label");
const bookingPackageMenu   = document.getElementById("booking-package-menu");

const bookingDetailPackageToggle = document.getElementById("booking-detail-package-toggle");
const bookingDetailPackageLabel  = document.getElementById("booking-detail-package-label");
const bookingDetailPackageMenu   = document.getElementById("booking-detail-package-menu");

// Theme
const themeRadioInputs = document.querySelectorAll('input[name="theme"]');

// Kalender
const calendarPreferenceInputs = document.querySelectorAll(
  'input[name="calendar-preference"]'
);
const calendarOpenButton = document.getElementById("calendar-open-button");

// Billing
const billingManageButton = document.getElementById(
  "billing-manage-plan-button"
);
const billingYearlyButton = document.getElementById(
  "billing-subscription-yearly-button"
);
const billingMonthlyButton = document.getElementById(
  "billing-subscription-monthly-button"
);
const billingOpenCheckoutButton = document.getElementById(
  "billing-open-checkout-button"
);

// Bewertungen
const settingsReviewLinkInput = document.getElementById(
  "settings-review-link"
);
const settingsReviewSaveButton = document.getElementById(
  "settings-review-save-button"
);
const settingsReviewSaveStatus = document.getElementById(
  "settings-review-save-status"
);

const settingsBookingLinkInput = document.getElementById("settings-booking-link");
const settingsBookingLinkCopyBtn = document.getElementById("settings-booking-link-copy");
const settingsBookingLinkOpenBtn = document.getElementById("settings-booking-link-open");
const settingsBookingLinkStatus = document.getElementById("settings-booking-link-status");

// Gutscheine
const promoCodeInput = document.getElementById("promo-code-input");
const promoTypePercent = document.getElementById("promo-type-percent");
const promoTypeAmount = document.getElementById("promo-type-amount");
const promoValueInput = document.getElementById("promo-value-input");
const promoMaxUsesInput = document.getElementById("promo-max-uses");
const promoValidUntilInput = document.getElementById("promo-valid-until");
const promoCreateBtn = document.getElementById("promo-create-btn");
const promoStatus = document.getElementById("promo-status");
const promoList = document.getElementById("promo-list");

const giftAmountInput = document.getElementById("gift-amount-input");
const giftToEmail = document.getElementById("gift-to-email");
const giftToName = document.getElementById("gift-to-name");
const giftMessage = document.getElementById("gift-message");
const giftIssueBtn = document.getElementById("gift-issue-btn");
const giftStatus = document.getElementById("gift-status");
const giftLast = document.getElementById("gift-last");
const giftList = document.getElementById("gift-list");
const promoDetails = promoList?.closest("details");
const giftDetails = giftList?.closest("details");

// Öffnungszeiten
const openingHoursSaveButton = document.getElementById("opening-hours-save-button");
const openingHoursSaveStatus = document.getElementById("opening-hours-save-status");
// Öffnungszeiten (Checkboxen "offen")
const openingHoursDayOpen = {
  mon: document.getElementById("oh-mon-open"),
  tue: document.getElementById("oh-tue-open"),
  wed: document.getElementById("oh-wed-open"),
  thu: document.getElementById("oh-thu-open"),
  fri: document.getElementById("oh-fri-open"),
  sat: document.getElementById("oh-sat-open"),
  sun: document.getElementById("oh-sun-open"),
};

// Kunde-Booking Limit pro Tag (1–10)
const publicDailyLimitSelect = document.getElementById("settings-public-daily-limit");

async function loadPromoCodes() {
  if (!promoList) return;
  promoList.innerHTML = `<p class="form-hint">Lädt...</p>`;

  const user = await supabaseClient.auth.getUser();
  const uid = user?.data?.user?.id;
  if (!uid) {
    promoList.innerHTML = `<p class="form-hint">Nicht eingeloggt.</p>`;
    return;
  }

  const { data, error } = await supabaseClient
    .from("promo_codes")
    .select("*")
    .eq("detailer_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    promoList.innerHTML = `<p class="form-hint">Fehler beim Laden.</p>`;
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    promoList.innerHTML = `<p class="form-hint">Noch keine Promo-Codes.</p>`;
    return;
  }

  promoList.innerHTML = rows
    .map((r) => {
      const typ = r.discount_type === "percent" ? `${r.discount_value}%` : centsToEurText(r.discount_value);
      const active = r.active ? "Aktiv" : "Inaktiv";
      const code = normCode(r.code);
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid rgba(0,0,0,0.08);border-radius:14px;margin-bottom:8px;background:rgba(255,255,255,0.6);">
          <div>
            <div style="font-weight:700;">${code}</div>
            <div style="font-size:12px;color:#6b7280;">${typ} · ${active}</div>
          </div>
          <div style="display:flex; gap:8px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" class="btn btn-ghost btn-small" data-promo-disable="${r.id}">Deaktivieren</button>
            <button type="button" class="btn btn-ghost btn-small" data-promo-delete="${r.id}">Löschen</button>
          </div>
      `;
    })
    .join("");

  promoList.querySelectorAll("[data-promo-disable]").forEach((btn) => {
    btn.addEventListener("click", async () => {
        promoList.querySelectorAll("[data-promo-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-promo-delete");
      if (!id) return;
      await supabaseClient.from("promo_codes").delete().eq("id", id);
      await loadPromoCodes();
    });
  });

      const id = btn.getAttribute("data-promo-disable");
      if (!id) return;
      await supabaseClient.from("promo_codes").update({ active: false }).eq("id", id);
      await loadPromoCodes();
    });
  });

  promoList.querySelectorAll("[data-promo-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-promo-delete");
      if (!id) return;
      await supabaseClient.from("promo_codes").delete().eq("id", id);
      await loadPromoCodes();
    });
  });
}

async function createPromoCode() {
  if (!promoCreateBtn) return;

  const user = await supabaseClient.auth.getUser();
  const uid = user?.data?.user?.id;
  if (!uid) return;

  const code = normCode(promoCodeInput?.value || "");
  const isPercent = !!promoTypePercent?.checked;
  const rawVal = Number(promoValueInput?.value || 0);

  if (!code) {
    if (promoStatus) promoStatus.textContent = "Code fehlt.";
    return;
  }

  let discount_type = isPercent ? "percent" : "amount";
  let discount_value = 0;
  const max_redemptions = promoMaxUsesInput?.value ? Math.max(1, Math.floor(Number(promoMaxUsesInput.value))) : null;

  // Date -> ends_at (23:59:59)
const v = String(promoValidUntilInput?.value || "").trim();
let ends_at = null;
if (v) {
  const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) ends_at = new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59.000Z`).toISOString();
}

  if (discount_type === "percent") {
    discount_value = Math.max(1, Math.min(100, Math.round(rawVal)));
  } else {
    discount_value = eurToCents(rawVal);
  }

  if (!discount_value) {
    if (promoStatus) promoStatus.textContent = "Wert fehlt.";
    return;
  }

  if (promoStatus) promoStatus.textContent = "Speichere...";
  
  const { error } = await supabaseClient.from("promo_codes").insert({
    detailer_id: uid,
    code,
    discount_type,
    discount_value,
    active: true,
    max_redemptions,
    ends_at,
    redeemed_count: 0,
  });

  if (error) {
    if (promoStatus) promoStatus.textContent = "Fehler beim Speichern.";
    return;
  }

  if (promoStatus) promoStatus.textContent = "Gespeichert.";
  if (promoCodeInput) promoCodeInput.value = "";
  if (promoValueInput) promoValueInput.value = "";
  if (promoMaxUsesInput) promoMaxUsesInput.value = "";
  if (promoValidUntilInput) promoValidUntilInput.value = "";
  await loadPromoCodes();
}

async function loadGiftCards() {
  if (!giftList) return;
  giftList.innerHTML = `<p class="form-hint">Lädt...</p>`;

  const user = await supabaseClient.auth.getUser();
  const uid = user?.data?.user?.id;
  if (!uid) {
    giftList.innerHTML = `<p class="form-hint">Nicht eingeloggt.</p>`;
    return;
  }

  const { data, error } = await supabaseClient
    .from("gift_cards")
    .select("*")
    .eq("detailer_id", uid)
    .order("created_at", { ascending: false });

  if (error) {
    giftList.innerHTML = `<p class="form-hint">Fehler beim Laden.</p>`;
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    giftList.innerHTML = `<p class="form-hint">Noch keine Gutscheinkarten.</p>`;
    return;
  }

  giftList.innerHTML = rows
    .map((r) => {
      const code = normCode(r.code);
      const bal = centsToEurText(r.balance_cents);
      const init = centsToEurText(r.initial_balance_cents);
      const active = r.active ? "Aktiv" : "Inaktiv";
      const pdfUrl = `${WORKER_API_BASE}/public/giftcard/pdf?detailer_id=${encodeURIComponent(uid)}&code=${encodeURIComponent(code)}`;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid rgba(0,0,0,0.08);border-radius:14px;margin-bottom:8px;background:rgba(255,255,255,0.6);">
          <div>
            <div style="font-weight:700;">${code}</div>
            <div style="font-size:12px;color:#6b7280;">Saldo: ${bal} · Start: ${init} · ${active}</div>
            <div style="margin-top:6px;">
              <a href="${pdfUrl}" target="_blank" rel="noopener" style="font-size:12px;">PDF öffnen</a>
            </div>
          </div>
<div style="display:flex;gap:8px;">
  <button type="button" class="btn btn-ghost btn-small" data-gift-disable="${r.id}">Deaktivieren</button>
  <button type="button" class="btn btn-ghost btn-small" data-gift-delete="${r.id}">Löschen</button>
</div>
        </div>
      `;
    })
    .join("");

giftList.querySelectorAll("[data-gift-delete]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-gift-delete");
    if (!id) return;
    await supabaseClient.from("gift_cards").delete().eq("id", id);
    await loadGiftCards();
  });
});
}

async function issueGiftCard() {
  const session = await supabaseClient.auth.getSession();
  const token = session?.data?.session?.access_token;
  if (!token) return;

  const amountCents = eurToCents(giftAmountInput?.value || 0);
  if (!amountCents) {
    if (giftStatus) giftStatus.textContent = "Wert fehlt.";
    return;
  }

  if (giftStatus) giftStatus.textContent = "Erstelle...";

  const res = await fetch(`${WORKER_API_BASE}/giftcards/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      amount_cents: amountCents,
      to_email: String(giftToEmail?.value || "").trim(),
      to_name: String(giftToName?.value || "").trim(),
      message: String(giftMessage?.value || "").trim(),
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    if (giftStatus) giftStatus.textContent = "Fehler beim Erstellen.";
    return;
  }

  if (giftStatus) giftStatus.textContent = `Erstellt: ${data.code}`;

  if (giftLast) {
    giftLast.style.display = "";
    giftLast.innerHTML = `
      <div style="padding:10px 12px;border:1px solid rgba(0,0,0,0.08);border-radius:14px;background:rgba(255,255,255,0.6);">
        <div style="font-weight:700;">${normCode(data.code)}</div>
        <div style="margin-top:6px;">
          <a href="${data.pdf_url}" target="_blank" rel="noopener" style="font-size:12px;">PDF öffnen</a>
        </div>
      </div>
    `;
  }

  if (giftAmountInput) giftAmountInput.value = "";
  if (giftToEmail) giftToEmail.value = "";
  if (giftToName) giftToName.value = "";
  if (giftMessage) giftMessage.value = "";

  await loadGiftCards();
}

function setupDiscountsUIHandlers() {
  if (promoCreateBtn) promoCreateBtn.addEventListener("click", createPromoCode);
  if (giftIssueBtn) giftIssueBtn.addEventListener("click", issueGiftCard);
  if (promoDetails) promoDetails.addEventListener("toggle", () => { if (promoDetails.open) loadPromoCodes(); });
  if (giftDetails) giftDetails.addEventListener("toggle", () => { if (giftDetails.open) loadGiftCards(); });
}

// ================================
// ÖFFNUNGSZEITEN (Settings)
// ================================
const OPENING_HOURS_KEYS = [
  { key: "mon", label: "Montag", openId: "oh-mon-open", startId: "oh-mon-start", endId: "oh-mon-end" },
  { key: "tue", label: "Dienstag", openId: "oh-tue-open", startId: "oh-tue-start", endId: "oh-tue-end" },
  { key: "wed", label: "Mittwoch", openId: "oh-wed-open", startId: "oh-wed-start", endId: "oh-wed-end" },
  { key: "thu", label: "Donnerstag", openId: "oh-thu-open", startId: "oh-thu-start", endId: "oh-thu-end" },
  { key: "fri", label: "Freitag", openId: "oh-fri-open", startId: "oh-fri-start", endId: "oh-fri-end" },
  { key: "sat", label: "Samstag", openId: "oh-sat-open", startId: "oh-sat-start", endId: "oh-sat-end" },
  { key: "sun", label: "Sonntag", openId: "oh-sun-open", startId: "oh-sun-start", endId: "oh-sun-end" },
];

function getDefaultOpeningHours() {
  return {
    mon: { start: "09:00", end: "18:00" },
    tue: { start: "09:00", end: "18:00" },
    wed: { start: "09:00", end: "18:00" },
    thu: { start: "09:00", end: "18:00" },
    fri: { start: "09:00", end: "18:00" },
    sat: { start: "10:00", end: "14:00" },
    sun: { start: "00:00", end: "00:00" },
  };
}

function applyOpeningHoursToForm(openingHours) {
  const oh = openingHours && typeof openingHours === "object"
    ? openingHours
    : getDefaultOpeningHours();

  OPENING_HOURS_KEYS.forEach((d) => {
    const openEl = document.getElementById(d.openId);
    const startEl = document.getElementById(d.startId);
    const endEl = document.getElementById(d.endId);
    if (!openEl || !startEl || !endEl) return;

    const v = oh[d.key] || {};
    const isOpen = (v.open != null)
      ? !!v.open
      : !!(v.start && v.end); // fallback: alt-format ohne "open"

    openEl.checked = isOpen;

    if (!isOpen) {
      startEl.value = "";
      endEl.value = "";
      startEl.disabled = true;
      endEl.disabled = true;
    } else {
      startEl.disabled = false;
      endEl.disabled = false;
      startEl.value = v.start || "";
      endEl.value = v.end || "";
    }
  });

  // Limit (nur Kunden-Buchung)
  if (publicDailyLimitSelect && currentProfile) {
    const v = currentProfile.public_daily_limit;
    if (v != null && String(v).trim() !== "") {
      publicDailyLimitSelect.value = String(v);
    }
  }
}

function setupOpeningHoursHandlers() {
  if (!openingHoursSaveButton) return;

  // Checkbox -> Inputs aktiv/leer
  OPENING_HOURS_KEYS.forEach((d) => {
    const openEl = document.getElementById(d.openId);
    const startEl = document.getElementById(d.startId);
    const endEl = document.getElementById(d.endId);
    if (!openEl || !startEl || !endEl) return;

    const apply = () => {
      const isOpen = !!openEl.checked;

      if (!isOpen) {
        startEl.value = "";
        endEl.value = "";
        startEl.disabled = true;
        endEl.disabled = true;
      } else {
        startEl.disabled = false;
        endEl.disabled = false;
        // optional defaults, falls leer:
        if (!startEl.value) startEl.value = "09:00";
        if (!endEl.value) endEl.value = "18:00";
      }
    };

    openEl.addEventListener("change", apply);
    apply(); // initial
  });

  openingHoursSaveButton.addEventListener("click", async () => {
    if (!currentUser) {
      if (openingHoursSaveStatus) openingHoursSaveStatus.textContent = "Bitte zuerst anmelden.";
      return;
    }

    const opening_hours = {};

    OPENING_HOURS_KEYS.forEach((d) => {
      const openEl = document.getElementById(d.openId);
      const startEl = document.getElementById(d.startId);
      const endEl = document.getElementById(d.endId);
      if (!openEl || !startEl || !endEl) return;

      const isOpen = !!openEl.checked;

      if (!isOpen) {
        opening_hours[d.key] = { open: false, start: null, end: null };
        return;
      }

      const start = (startEl.value || "").trim();
      const end = (endEl.value || "").trim();

      opening_hours[d.key] = {
        open: true,
        start: start || null,
        end: end || null,
      };
    });

const public_daily_limit = Math.max(
  1,
  Math.min(10, parseInt(publicDailyLimitSelect?.value || "2", 10) || 2)
);

    if (openingHoursSaveStatus) openingHoursSaveStatus.textContent = "Speichern...";

    try {
      const { error } = await supabaseClient
        .from("profiles")
        .update({
          opening_hours,
          public_daily_limit,
        })
        .eq("id", currentUser.id);

      if (error) {
        console.error("DetailHQ: Öffnungszeiten speichern fehlgeschlagen:", error);
        if (openingHoursSaveStatus) openingHoursSaveStatus.textContent = "Fehler beim Speichern.";
        return;
      }

      if (currentProfile) {
        currentProfile.opening_hours = opening_hours;
        currentProfile.public_daily_limit = public_daily_limit;
      }

      if (openingHoursSaveStatus) {
        openingHoursSaveStatus.textContent = "Gespeichert.";
        setTimeout(() => (openingHoursSaveStatus.textContent = ""), 2000);
      }
    } catch (e) {
      console.warn("DetailHQ: Öffnungszeiten/Limit konnte nicht gespeichert werden (Spalte fehlt evtl.)");
      if (openingHoursSaveStatus) openingHoursSaveStatus.textContent = "Gespeichert.";
      setTimeout(() => (openingHoursSaveStatus.textContent = ""), 2000);
    }
  });
}

// Services / Vehicle Classes
const vehicleClassesList = document.getElementById("vehicle-classes-list");
const vehicleClassAddButton = document.getElementById(
  "vehicle-class-add-button"
);
const vehicleClassModal = document.getElementById("vehicle-class-modal");
const vehicleClassModalTitle = document.getElementById(
  "vehicle-class-modal-title"
);
const vehicleClassModalClose = document.getElementById(
  "vehicle-class-modal-close"
);
const vehicleClassForm = document.getElementById("vehicle-class-form");
const vehicleClassNameInput = document.getElementById("vehicle-class-name");
const vehicleClassPriceDeltaInput = document.getElementById(
  "vehicle-class-price-delta"
);
const vehicleClassModalError = document.getElementById(
  "vehicle-class-modal-error"
);
const vehicleClassesDropdownToggle = document.getElementById(
  "vehicle-classes-dropdown-toggle"
);
const servicesDropdownToggle = document.getElementById(
  "services-dropdown-toggle"
);

const servicesList = document.getElementById("services-list");
const serviceAddButton = document.getElementById("service-add-button");
const serviceModal = document.getElementById("service-modal");
const serviceModalTitle = document.getElementById("service-modal-title");
const serviceModalClose = document.getElementById("service-modal-close");
const serviceForm = document.getElementById("service-form");
const serviceKindInput = document.getElementById("service-kind");
const serviceCategoryInput = document.getElementById("service-category");
const serviceNameInput = document.getElementById("service-name");
const servicePriceInput = document.getElementById("service-base-price-input");
const serviceDurationInput = document.getElementById("service-duration-input");
const serviceDescriptionInput = document.getElementById("service-notes-input");
const serviceModalError = document.getElementById("service-modal-error");
// Service Preis-Empfehlung UI
const servicePriceRecoWrap = document.getElementById("service-price-reco");
const servicePriceRecoMin = document.getElementById("service-price-reco-min");
const servicePriceRecoMax = document.getElementById("service-price-reco-max");
const servicePriceRecoHint = document.getElementById("service-price-reco-hint");

// Booking modal / New order
const newBookingButton = document.getElementById("new-booking-button");
const newBookingButton2 = document.getElementById("new-booking-button-2");
const bookingModal = document.getElementById("booking-modal");
const bookingCloseButton = document.getElementById("booking-close-button");
const bookingForm = document.getElementById("booking-form");

const bookingStep1 = document.getElementById("booking-step-1");
const bookingStep2 = document.getElementById("booking-step-2");
const bookingStep3 = document.getElementById("booking-step-3");
const bookingStepIndicator1 = document.getElementById(
  "booking-step-indicator-1"
);
const bookingStepIndicator2 = document.getElementById(
  "booking-step-indicator-2"
);
const bookingStepIndicator3 = document.getElementById(
  "booking-step-indicator-3"
);
const bookingDiscountTypeSelect = document.getElementById(
  "booking-discount-type"
);
const bookingDiscountValueInput = document.getElementById(
  "booking-discount-value"
);

const bookingNext1 = document.getElementById("booking-next-1");
const bookingNext2 = document.getElementById("booking-next-2");
const bookingBack2 = document.getElementById("booking-back-2");
const bookingBack3 = document.getElementById("booking-back-3");

const bookingVehicleClassSelect = document.getElementById(
  "booking-vehicle-class"
);
const bookingCarInput = document.getElementById("booking-car");
const bookingMainServiceSelect = document.getElementById(
  "booking-main-service"
);
const bookingSinglesList = document.getElementById("booking-singles-list");
const bookingSinglesToggle = document.getElementById("booking-singles-toggle");
const bookingSinglesMenu = document.getElementById("booking-singles-menu");
const bookingSinglesLabel = document.getElementById("booking-singles-label");
const bookingSinglesMenuUI = bookingSinglesMenu; // Alias, damit dein renderSingles nicht crasht

const bookingDateInput = document.getElementById("booking-date");
const bookingTimeInput = document.getElementById("booking-time");
const bookingCustomerNameInput = document.getElementById(
  "booking-customer-name"
);
const bookingCustomerEmailInput = document.getElementById(
  "booking-customer-email"
);
const bookingCustomerPhoneInput = document.getElementById(
  "booking-customer-phone"
);
const bookingCustomerAddressInput = document.getElementById(
  "booking-customer-address"
);
const bookingNotesInput = document.getElementById("booking-notes");
const bookingSummaryPrice = document.getElementById("booking-summary-price");
const bookingSummaryDuration = document.getElementById(
  "booking-summary-duration"
);
const bookingError = document.getElementById("booking-error");

// Dashboard / Schedule Lists
const todayBookingsContainer = document.getElementById("today-bookings");
const scheduleListContainer = document.getElementById("schedule-list");
// Dashboard: Bewertungen fällig
const reviewRemindersContainer = document.getElementById("review-reminders");

// Review-Modal
const reviewModal = document.getElementById("review-modal");
const reviewModalText = document.getElementById("review-modal-text");
const reviewModalClose = document.getElementById("review-modal-close");
const reviewModalCopyButton = document.getElementById("review-modal-copy");
const reviewModalDoneButton = document.getElementById("review-modal-done");

// Annahmeprotokoll (Orders Tab + Modal) — HTML IDs
const intakeStartButton = document.getElementById("intake-start-button");
const intakeBookingSelect = document.getElementById("intake-booking-select");
const intakeOpenButton = document.getElementById("intake-open-button");
const intakeStartError = document.getElementById("intake-start-error");
const ordersProtocolsList = document.getElementById("intake-list");
const ordersNewIntakeButton = document.getElementById("orders-new-intake-button");
const bookingDetailIntakeButton = document.getElementById("booking-detail-intake-button");

const intakeModal = document.getElementById("intake-modal");
const intakeCloseButton = document.getElementById("intake-close-button");
const intakeForm = document.getElementById("intake-form");

const intakeBookingSummary = document.getElementById("intake-booking-summary");
const intakeDocDate = document.getElementById("intake-doc-date");
if (intakeDocDate && !intakeDocDate.value) {
  intakeDocDate.value = new Date().toISOString().slice(0, 10);
}
const intakeCustomerNote = document.getElementById("intake-customer-note");
const intakeInternalNote = document.getElementById("intake-internal-note");

const intakeVehicleMakeModel = document.getElementById("intake-vehicle-make-model");
const intakeVehiclePlate = document.getElementById("intake-vehicle-plate");
const intakeVehicleVin = document.getElementById("intake-vehicle-vin");
const intakeVehicleYear = document.getElementById("intake-vehicle-year");
const intakeVehicleMileage = document.getElementById("intake-vehicle-mileage");

const intakeQDamages = document.getElementById("intake-q-damages");
const intakeQDamagesNote = document.getElementById("intake-q-damages-note");
const intakeQSmell = document.getElementById("intake-q-odors");
const intakeQSmellNote = document.getElementById("intake-q-smell-note");
const intakeQValuables = document.getElementById("intake-q-valuables");
const intakeQValuablesNote = document.getElementById("intake-q-valuables-note");
const intakeQWarnings = document.getElementById("intake-q-warnings");
const intakeQWarningsNote = document.getElementById("intake-q-warnings-note");
const intakeQWheels = document.getElementById("intake-q-wheels");
const intakeQWheelsNote = document.getElementById("intake-q-wheels-note");
const intakeQFuel = document.getElementById("intake-q-fuel");
const intakeQFuelNote = document.getElementById("intake-q-fuel-note");
const intakeQKeys = document.getElementById("intake-q-keys");
const intakeQKeysNote = document.getElementById("intake-q-keys-note");
const intakeQAccessories = document.getElementById("intake-q-accessories");
const intakeQAccessoriesNote = document.getElementById("intake-q-accessories-note");

const intakeExteriorList = document.getElementById("intake-exterior-list");
const intakeInteriorList = document.getElementById("intake-interior-list");

const intakeLegalHandover = document.getElementById("intake-legal-handover");
const intakeLegalAgb = document.getElementById("intake-legal-terms");
const intakeLegalNote = document.getElementById("intake-legal-hidden-damages");

const intakeSignatureCanvas = document.getElementById("intake-signature-canvas");
let __sigCtx = null;
let __sigDrawing = false;

if (intakeSignatureCanvas) {
  __sigCtx = intakeSignatureCanvas.getContext("2d");
  __sigCtx.lineWidth = 2;
  __sigCtx.lineCap = "round";
  __sigCtx.strokeStyle = "#000";

  const getPos = (e) => {
    const rect = intakeSignatureCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  intakeSignatureCanvas.addEventListener("mousedown", (e) => {
    __sigDrawing = true;
    const p = getPos(e);
    __sigCtx.beginPath();
    __sigCtx.moveTo(p.x, p.y);
  });

  intakeSignatureCanvas.addEventListener("mousemove", (e) => {
    if (!__sigDrawing) return;
    const p = getPos(e);
    __sigCtx.lineTo(p.x, p.y);
    __sigCtx.stroke();
  });

  window.addEventListener("mouseup", () => {
    __sigDrawing = false;
  });
}

const intakeSignatureClear = document.getElementById("intake-signature-clear");
if (intakeSignatureClear && intakeSignatureCanvas && __sigCtx) {
  intakeSignatureClear.addEventListener("click", () => {
    __sigCtx.clearRect(
      0,
      0,
      intakeSignatureCanvas.width,
      intakeSignatureCanvas.height
    );
  });
}

const intakeSendEmail = document.getElementById("intake-send-email");
const intakeEmailRow = document.getElementById("intake-email-panel");
const intakeCustomerEmail = document.getElementById("intake-customer-email");

const intakeStatus = document.getElementById("intake-status");

const intakeStep1 = document.getElementById("intake-step-1");
const intakeStep2 = document.getElementById("intake-step-2");
const intakeStep3 = document.getElementById("intake-step-3");
const intakeStep4 = document.getElementById("intake-step-4");
const intakeStep5 = document.getElementById("intake-step-5");
const intakeStep6 = document.getElementById("intake-step-6");

const intakeStepIndicator1 = document.getElementById("intake-step-indicator-1");
const intakeStepIndicator2 = document.getElementById("intake-step-indicator-2");
const intakeStepIndicator3 = document.getElementById("intake-step-indicator-3");
const intakeStepIndicator4 = document.getElementById("intake-step-indicator-4");
const intakeStepIndicator5 = document.getElementById("intake-step-indicator-5");
const intakeStepIndicator6 = document.getElementById("intake-step-indicator-6");

const intakeNext1 = document.getElementById("intake-next-1");
const intakeNext2 = document.getElementById("intake-next-2");
const intakeNext3 = document.getElementById("intake-next-3");
const intakeNext4 = document.getElementById("intake-next-4");
const intakeNext5 = document.getElementById("intake-next-5");

const intakeBack2 = document.getElementById("intake-back-2");
const intakeBack3 = document.getElementById("intake-back-3");
const intakeBack4 = document.getElementById("intake-back-4");
const intakeBack5 = document.getElementById("intake-back-5");
const intakeBack6 = document.getElementById("intake-back-6");
// Aktueller Review-Booking
let currentReviewBooking = null;

// Dashboard-KPIs
const revenueTodayElement = document.getElementById("revenue-today");
const volumeTodayElement = document.getElementById("volume-today");
const dashboardPeriodToggle = document.getElementById(
  "dashboard-period-toggle"
);

// ================================
// BOOKING STEP HELPER (global)
// ================================
// ===== BOOK PACKAGE UI (copied from book.js) =====
function euro(cents) {
  const v = Number(cents || 0) / 100;
  return v.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 1:1 aus book.js
function renderPackages() {
  bookingMainServiceSelect.innerHTML = "";
  bookingPackageMenu.innerHTML = "";

  const packages = services.filter(
    (s) =>
      s &&
      (s.kind === "package" ||
        s.is_single_service === false ||
        s.is_single_service === 0 ||
        s.is_single_service === "false")
  );

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Paket wählen";
  bookingMainServiceSelect.appendChild(ph);

  if (!packages.length) {
    bookingPackageMenu.innerHTML =
      `<p class="form-hint">Keine Pakete verfügbar.</p>`;
    bookingPackageLabel.textContent = "Paket wählen";
    return;
  }

  packages.forEach((svc) => {
    // hidden select
    const o = document.createElement("option");
    o.value = String(svc.id);
    o.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;
    bookingMainServiceSelect.appendChild(o);

    // visible row
    const row = document.createElement("div");
    row.className = "settings-dropdown-item";
    row.dataset.value = String(svc.id);

    const radio = document.createElement("div");
    radio.className = "booking-singles-item-checkbox";

    const col = document.createElement("div");
    col.className = "service-col";

    const headerRow = document.createElement("div");
    headerRow.className = "service-header-row";

    const txt = document.createElement("div");
    txt.className = "booking-singles-item-label";
    txt.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;

    headerRow.appendChild(txt);

const desc = (svc.description || "").trim();
let panel = null;

if (desc) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "service-desc-toggle";
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `Details <span class="service-desc-chevron">▾</span>`;

  panel = document.createElement("div");
  panel.className = "service-desc-panel hidden";

  const text = document.createElement("div");
  text.className = "service-desc-text";
  text.textContent = desc;

  panel.appendChild(text);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    panel.classList.toggle("hidden", open);
  });

  headerRow.appendChild(btn);
}

col.appendChild(headerRow);

if (panel) {
  const wrap = document.createElement("div");
  wrap.className = "service-desc-wrap";
  wrap.appendChild(panel);
  col.appendChild(wrap);
}

    row.appendChild(radio);
    row.appendChild(col);

    row.addEventListener("click", () => {
      bookingMainServiceSelect.value = String(svc.id);
      bookingPackageLabel.textContent = txt.textContent;
      row.closest(".settings-dropdown")?.classList.remove("open");
    });

    bookingPackageMenu.appendChild(row);
  });
}

function renderSingles() {
  if (!bookingSinglesMenuUI || !bookingSinglesList) return;

  // Selection merken (falls renderSingles erneut läuft)
  const prevSelected = new Set(
    Array.from(bookingSinglesList.selectedOptions || []).map((o) => String(o.value))
  );

  bookingSinglesMenuUI.innerHTML = "";
  bookingSinglesList.innerHTML = "";

  const singles = (services || []).filter(
    (s) => s && (s.kind === "single" || s.kind === "addon")
  );

  if (!singles.length) {
    bookingSinglesMenuUI.innerHTML = `<p class="form-hint">Noch keine Einzelleistungen.</p>`;
    updateBookingSinglesToggleText();
    return;
  }

  singles.forEach((svc) => {
    // hidden select option
    const opt = document.createElement("option");
    opt.value = String(svc.id);
    opt.textContent = svc.name;
    if (prevSelected.has(opt.value)) opt.selected = true;
    bookingSinglesList.appendChild(opt);

    // visible row
    const row = document.createElement("div");
    row.className = "settings-dropdown-item";
    row.dataset.value = String(svc.id);
    row.classList.toggle("selected", opt.selected);

    const box = document.createElement("div");
    box.className = "booking-singles-item-checkbox";

    const col = document.createElement("div");
    col.className = "service-col";

    const headerRow = document.createElement("div");
    headerRow.className = "service-header-row";

    const txt = document.createElement("div");
    txt.className = "booking-singles-item-label";
    txt.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;
    headerRow.appendChild(txt);

    const desc = (svc.description || "").trim();
    let panel = null;

    if (desc) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-desc-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `Details <span class="service-desc-chevron">▾</span>`;

      panel = document.createElement("div");
      panel.className = "service-desc-panel hidden";

      const text = document.createElement("div");
      text.className = "service-desc-text";
      text.textContent = desc;

      panel.appendChild(text);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        panel.classList.toggle("hidden", open);
      });

      headerRow.appendChild(btn);
    }

    col.appendChild(headerRow);

    if (panel) {
      const wrap = document.createElement("div");
      wrap.className = "service-desc-wrap";
      wrap.appendChild(panel);
      col.appendChild(wrap);
    }

    row.appendChild(box);
    row.appendChild(col);

    row.addEventListener("click", (e) => {
      // wenn "Details" geklickt wurde -> nicht selektieren
      if (e.target.closest(".service-desc-toggle")) return;

      opt.selected = !opt.selected;
      row.classList.toggle("selected", opt.selected);

      updateBookingSinglesToggleText();
      recalcBookingSummary();
    });

    bookingSinglesMenuUI.appendChild(row);
  });

  updateBookingSinglesToggleText();
}

function updateBookingSinglesToggleText() {
  if (!bookingSinglesToggle || !bookingSinglesList) return;

  const labels = Array.from(bookingSinglesList.selectedOptions || [])
    .map((o) => o.textContent)
    .filter(Boolean);

  const text = labels.length ? labels.join(", ") : "Einzelleistungen wählen";

  const chevron = bookingSinglesToggle.querySelector(".settings-dropdown-chevron");
  bookingSinglesToggle.textContent = text + " ";
  if (chevron) bookingSinglesToggle.appendChild(chevron);
}

function showBookingStep(step) {
  currentBookingStep = step;

  const steps = [bookingStep1, bookingStep2, bookingStep3];
  const indicators = [
    bookingStepIndicator1,
    bookingStepIndicator2,
    bookingStepIndicator3,
  ];

  steps.forEach((el, idx) => {
    if (!el) return;
    const s = idx + 1;
    if (s === step) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  indicators.forEach((el, idx) => {
    if (!el) return;
    const s = idx + 1;
    el.classList.toggle("active", s === step);
  });

  recalcBookingSummary();
}

const SERVICE_PRICE_RULES_URL = "./detailer_einzelleistungen_keywords_preise_2025.json?v=1.5";
let SERVICE_PRICE_RULES = [];
let servicePriceRulesLoaded = false;
let servicePriceRulesLoadPromise = null;

function wireRequiredRedBorders(root = document) {
  const fields = root.querySelectorAll("input[required], select[required], textarea[required]");
  fields.forEach((el) => {
    const apply = () => {
      const v = (el.value ?? "").toString().trim();
      el.classList.toggle("is-invalid", v.length === 0);
    };
    el.addEventListener("input", apply);
    el.addEventListener("change", apply);
    el.addEventListener("blur", apply);
    apply();
  });
}

// ================================
// INIT
// ================================
(async function init() {
// ================================
// PASSWORD RECOVERY GUARD
// ================================
const hash = window.location.hash || "";
if (hash.includes("type=recovery")) {
  console.log("DetailHQ: Password recovery flow detected");

  // Wenn Supabase auf /#... (root) landet, direkt auf die Reset-Seite umleiten
  // Hash muss mit, weil access_token/refresh_token da drin stehen
  const target = `/reset-password.html${hash}`;
  window.location.replace(target);
  return;
}

// ================================
// After password reset: force auth view
// ================================
const qs = new URLSearchParams(window.location.search);
if (qs.get("reset") === "1") {
  hideLoadingView();
  showAuthView();
  applyAuthModeFromUrl();
  return;
}

  console.log("DetailHQ init startet...");
  saveAffiliateRefFirstTouch();
  showLoadingView();

  // ================================
  // PUBLIC BOOKING ROUTE GUARD
  // Wenn URL = /<uuid>, niemals App/Dashboard laden
  // ================================
  const __path = (window.location.pathname || "/").replace(/^\/+/, "").trim();
  const __uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // /book.html soll nie hier reinlaufen
  if (__path.toLowerCase() === "book.html") {
    // App kann normal weiter initten (falls du book.html jemals main.js geben würdest)
  } else if (__uuidRe.test(__path)) {
    // Wichtig: replace, damit Back-Button nicht wieder in die SPA fällt
    window.location.replace(`/book.html?user=${encodeURIComponent(__path)}`);
    return;
  }

  if (!supabaseClient) {
    console.error("DetailHQ: Kein Supabase-Client – Auth funktioniert nicht.");
    // Kein supabaseClient => NICHTS davon aufrufen. Nur Login anzeigen.
    showAuthView();
    return;
  }

  initThemeFromStorage();
  setupAuthHandlers();
  setupRegisterBusinessTypeDropdown();
  setupPasswordToggleButtons();
  setupNavHandlers();
  setupSettingsSubViews();
  setupThemeHandlers();
  setupProfileMenuHandlers();
  setupBillingHandlers();
  setupCalendarHandlers();
  setupTrialBannerHandlers();
  setupReviewSettingsHandlers();
  setupOpeningHoursHandlers();
  setupServiceManagementHandlers();
  await loadServicePriceRules();
  setupBookingHandlers();
  setupBookingDetailHandlers();
  setupDashboardPeriodHandlers();
  setupReviewModalHandlers();
  startReviewReminderTimer();

  function setupPasswordToggleButtons() {
  const buttons = document.querySelectorAll(".password-toggle[data-target]");
  if (!buttons || buttons.length === 0) return;

  buttons.forEach((btn) => {
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;

    btn.addEventListener("click", () => {
      const isHidden = input.getAttribute("type") === "password";
      input.setAttribute("type", isHidden ? "text" : "password");
      btn.textContent = isHidden ? "Verbergen" : "Anzeigen";
    });
  });
}

function attachDropdownToggle(wrapperSelector, toggleId, menuId) {
  const wrapper = wrapperSelector
    ? document.querySelector(wrapperSelector)
    : null;
  const toggle = document.getElementById(toggleId);
  const menu = document.getElementById(menuId);

  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => {
    const container = wrapper || toggle.closest(".settings-dropdown");
    if (!container) return;
    const isOpen = container.classList.toggle("open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
}
attachDropdownToggle(null, "booking-package-toggle", "booking-package-menu");
attachDropdownToggle(null, "booking-detail-package-toggle", "booking-detail-package-menu");

function setupRegisterBusinessTypeDropdown() {
  if (!registerBusinessToggle || !registerBusinessMenu || !registerBusinessTypesList) return;

  // Seed hidden multi-select
  const OPTIONS = [
    { value: "fahrzeugaufbereiter", label: "Fahrzeugaufbereiter" },
    { value: "folierer", label: "Folierer (Wrap/PPF)" },
  ];

  registerBusinessTypesList.innerHTML = "";
  registerBusinessMenu.innerHTML = "";

  OPTIONS.forEach((opt) => {
    // hidden select option
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    registerBusinessTypesList.appendChild(o);

    // visible item (same styling as your multi select items)
    const item = document.createElement("div");
    item.className = "booking-singles-item";
    item.dataset.value = opt.value;

    const labelEl = document.createElement("div");
    labelEl.className = "booking-singles-item-label";
    labelEl.textContent = opt.label;

    const checkbox = document.createElement("div");
    checkbox.className = "booking-singles-item-checkbox";

    item.appendChild(labelEl);
    item.appendChild(checkbox);

    item.addEventListener("click", () => {
      const nowSelected = item.classList.toggle("selected");
      const optEl = registerBusinessTypesList.querySelector(`option[value="${opt.value}"]`);
      if (optEl) optEl.selected = nowSelected;
      updateRegisterBusinessToggleText();
    });

    registerBusinessMenu.appendChild(item);
  });

  function updateRegisterBusinessToggleText() {
    const selectedLabels = Array.from(registerBusinessTypesList.selectedOptions || []).map((x) => x.textContent);
    const text = selectedLabels.length ? selectedLabels.join(", ") : "Branche wählen";
    if (registerBusinessLabel) registerBusinessLabel.textContent = text;
  }

  // Toggle open/close (same behavior style as your other dropdowns)
  registerBusinessToggle.addEventListener("click", () => {
    const wrapper = registerBusinessToggle.closest(".settings-dropdown");
    if (!wrapper) return;

    const isOpen = wrapper.classList.contains("open");

    // close other dropdowns
    document.querySelectorAll(".settings-dropdown.open").forEach((el) => el.classList.remove("open"));

    wrapper.classList.toggle("open", !isOpen);
    registerBusinessToggle.setAttribute("aria-expanded", !isOpen ? "true" : "false");
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    const wrapper = registerBusinessToggle.closest(".settings-dropdown");
    if (!wrapper) return;
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove("open");
      registerBusinessToggle.setAttribute("aria-expanded", "false");
    }
  });

  updateRegisterBusinessToggleText();
}

  function setupReviewSettingsHandlers() {
    if (!settingsReviewSaveButton || !settingsReviewLinkInput) return;

    settingsReviewSaveButton.addEventListener("click", async () => {
      if (!currentUser) {
        if (settingsReviewSaveStatus) {
          settingsReviewSaveStatus.textContent = "Bitte zuerst anmelden.";
        }
        return;
      }

      const link = settingsReviewLinkInput.value.trim();

      if (settingsReviewSaveStatus) {
        settingsReviewSaveStatus.textContent = "Speichern...";
      }

      const { error } = await supabaseClient
        .from("profiles")
        .update({ review_link: link || null })
        .eq("id", currentUser.id);

      if (error) {
        console.error(
          "DetailHQ: review_link speichern fehlgeschlagen:",
          error
        );
        if (settingsReviewSaveStatus) {
          settingsReviewSaveStatus.textContent =
            "Fehler beim Speichern. Bitte später erneut versuchen.";
        }
        return;
      }

      if (currentProfile) {
        currentProfile.review_link = link || null;
      }

      if (settingsReviewSaveStatus) {
        settingsReviewSaveStatus.textContent = "Gespeichert.";
        setTimeout(() => {
          settingsReviewSaveStatus.textContent = "";
        }, 2000);
      }
    });
  }

  console.log("DetailHQ: Setup-Funktionen ausgeführt, hole aktuellen User...");

  const { data, error } = await supabaseClient.auth.getUser();
  if (error) {
    console.error("DetailHQ: Fehler bei getUser:", error);
  }

  const user = data?.user || null;

  if (user) {
    console.log("DetailHQ: Benutzer bereits eingeloggt:", user.id);
    currentUser = user;

    await ensureProfile();
    await loadProfileIntoForm();
    setupCalendarUrlForUser();

    await loadVehicleClasses();
    await loadServices();
    await loadBookingsForDashboardAndSchedule();
    
    hideLoadingView();
    showAppView();
} else {
  console.log("DetailHQ: Kein aktiver User -> Login anzeigen");
  hideLoadingView();
  showAuthView();
  applyAuthModeFromUrl();
}
})();

// ================================
// VIEW SWITCHING
// ================================
function showLoadingView() {
  if (authView) authView.classList.remove("active");
  if (appView) appView.classList.remove("active");
  const lv = document.getElementById("loadingView");
  if (lv) lv.style.display = "flex";
}

function hideLoadingView() {
  const lv = document.getElementById("loadingView");
  if (lv) lv.style.display = "none";
}

function showAuthView() {
  console.log("DetailHQ: showAuthView");
  if (authView) authView.classList.add("active");
  if (appView) appView.classList.remove("active");
}

function applyAuthModeFromUrl() {
  const qs = new URLSearchParams(window.location.search);
  const mode = (qs.get("mode") || qs.get("auth") || "").toLowerCase();
  const forceRegister = mode === "register" || qs.get("register") === "1";

  if (!forceRegister) return;

  // Register-Form anzeigen
  if (loginForm) loginForm.classList.add("hidden");
  if (registerForm) registerForm.classList.remove("hidden");
  if (authError) authError.textContent = "";
}

function showAppView() {
  console.log("DetailHQ: showAppView");
  if (authView) authView.classList.remove("active");
  if (appView) appView.classList.add("active");

  // Pull-to-refresh einmalig initialisieren (nur Daten reloaden, kein Auth)
  if (!window.__detailhqPtrSetup) {
    window.__detailhqPtrSetup = true;
    setupPullToRefresh();
  }
}

// ================================
// AUTH HANDLER
// ================================
function setupAuthHandlers() {
  console.log("DetailHQ: setupAuthHandlers");

  if (registerSwitch && loginForm && registerForm) {
    registerSwitch.addEventListener("click", () => {
      console.log("DetailHQ: Switch -> Register");
      loginForm.classList.add("hidden");
      registerForm.classList.remove("hidden");
      if (authError) authError.textContent = "";
    });
  }

  if (loginSwitch && loginForm && registerForm) {
    loginSwitch.addEventListener("click", () => {
      console.log("DetailHQ: Switch -> Login");
      registerForm.classList.add("hidden");
      loginForm.classList.remove("hidden");
      if (authError) authError.textContent = "";
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (authError) authError.textContent = "";
      console.log("DetailHQ: Login submit");

      const emailEl = document.getElementById("login-email");
      const pwEl = document.getElementById("login-password");
      const email = emailEl ? emailEl.value.trim() : "";
      const password = pwEl ? pwEl.value.trim() : "";

      if (!email || !password) {
        if (authError)
          authError.textContent = "Bitte E-Mail und Passwort eingeben.";
        return;
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("DetailHQ: Login-Fehler:", error);
        if (authError)
          authError.textContent =
            error.message || "Anmeldung fehlgeschlagen.";
        return;
      }

      currentUser = data.user;
      await ensureProfile();
      await loadProfileIntoForm();
      setupCalendarUrlForUser();
      await loadVehicleClasses();
      await loadServices();
      await loadBookingsForDashboardAndSchedule();
      hideLoadingView();
      showAppView();
    });
  }

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authError) authError.textContent = "";
    console.log("DetailHQ: Register submit");
    
const emailEl = document.getElementById("register-email");
const pwEl = document.getElementById("register-password");
const companyEl = document.getElementById("register-company");

const email = emailEl ? emailEl.value.trim() : "";
const password = pwEl ? pwEl.value.trim() : "";
const companyName = companyEl ? companyEl.value.trim() : "";
    
const businessTypes = registerBusinessTypesList
  ? Array.from(registerBusinessTypesList.selectedOptions || []).map((o) => o.value)
  : [];

if (!email || !password || !companyName || businessTypes.length === 0) {
  if (authError)
    authError.textContent = "Bitte E-Mail, Passwort, Firmenname und Branche auswählen.";
  return;
}

    // 1) REGISTRIEREN
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error("DetailHQ: Register-Fehler:", error);
      if (authError)
        authError.textContent =
          error.message || "Registrierung fehlgeschlagen.";
      return;
    }

    // 2) SOFORT Make informieren (NEUER NUTZER)
    await notifyMakeNewUser();

    // 3) Auto-Login (optional – nur für UX)
    const { data: signInData, error: signInError } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

    if (signInError) {
      console.error(
        "DetailHQ: Auto-Login nach Register fehlgeschlagen:",
        signInError
      );
      if (authError)
        authError.textContent =
          signInError.message || "Automatische Anmeldung fehlgeschlagen.";
      // Wichtig: hier KEIN return, weil User ist zumindest registriert
      // aber wir brechen UI-Aufbau ab
      return;
    }

    currentUser = signInData.user;
    await ensureProfile();
    
try {
  await supabaseClient
    .from("profiles")
    .update({ company_name: companyName })
    .eq("id", currentUser.id);
} catch (e) {
  console.warn("DetailHQ: company_name konnte nicht gespeichert werden.");
}

// Branche(n) speichern (falls Spalte nicht existiert: nicht crashen)
try {
  await supabaseClient
    .from("profiles")
    .update({ business_types: businessTypes })
    .eq("id", currentUser.id);
} catch (e) {
  console.warn("DetailHQ: business_types konnte nicht gespeichert werden (Spalte fehlt evtl.)");
}

    // Signup Event einmalig loggen (für Monatsreport)
try {
  await supabaseClient.from("signup_events").insert({ user_id: currentUser.id });
} catch (e) {}
    await ensureProfile();
    await persistAffiliateRefToProfileIfMissing();
    await loadProfileIntoForm();
    setupCalendarUrlForUser();
    await loadVehicleClasses();
    await loadServices();
    await loadBookingsForDashboardAndSchedule();
    hideLoadingView();
    showAppView();
    wireRequiredRedBorders(document);
  });
}


  if (passwordResetButton) {
    passwordResetButton.addEventListener("click", async () => {
      if (authError) authError.textContent = "";

      const emailInput = document.getElementById("login-email");
      const email = emailInput ? emailInput.value.trim() : "";

      if (!email) {
        if (authError) {
          authError.textContent =
            'Bitte gib oben deine E-Mail ein und klicke dann auf "Passwort vergessen?".';
        }
        return;
      }

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
  redirectTo: "https://detailhq.de/reset-password.html",
});

      if (error) {
        console.error("Passwort-Reset Fehler:", error);
        if (authError) {
          authError.textContent =
            error.message || "Zurücksetzen des Passworts fehlgeschlagen.";
        }
        return;
      }

      if (authError) {
        authError.textContent =
          "Wenn die E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.";
      }
    });
  }
}

// ================================
// NAVIGATION / TABS
// ================================
function isTrialExpiredAndUnpaid(profile) {
  if (!profile) return false;

  const status = profile.plan_status || "trial";

  // Wenn schon Abo / Lifetime => nicht gesperrt
  if (
    status === "active" ||
    status === "active_yearly" ||
    status === "lifetime"
  ) {
    return false;
  }

  // Wenn kein trial_ends_at => kein Lock
  if (!profile.trial_ends_at) return false;

  const endsAt = new Date(profile.trial_ends_at);
  const today = new Date();

  // Beide auf Mitternacht, damit wir wirklich ganze Tage vergleichen
  endsAt.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  // Gesperrt erst, wenn Trial-Datum vor "heute" liegt
  return endsAt.getTime() < today.getTime();
}

function updateAccessUI() {
  if (!currentProfile) return;

  const locked = isTrialExpiredAndUnpaid(currentProfile);

  // Bestimmte Settings-Gruppen ausblenden:
  // - "Dienste & Preise"
  // - "Kalender"
  // - "Bewertungen"
  const settingsGroups = document.querySelectorAll(".settings-group");

  settingsGroups.forEach((group) => {
    const titleEl = group.querySelector("h3");
    if (!titleEl) return;

    const title = (titleEl.textContent || "").trim();

    const isServices = title.startsWith("Dienste & Preise");
    const isCalendar = title.startsWith("Kalender");
    const isReviews = title.startsWith("Bewertungen");

    if (locked && (isServices || isCalendar || isReviews)) {
      group.classList.add("hidden");
    } else {
      group.classList.remove("hidden");
    }
  });

  // Tabs Dashboard / Zeitplan optisch sperren
  navItems.forEach((item) => {
    const tab = item.getAttribute("data-tab");
    if (!tab || tab === "settings") return;

    if (locked) {
      item.classList.add("nav-item-locked");
    } else {
      item.classList.remove("nav-item-locked");
    }
  });

  // Wenn gesperrt und aktuell NICHT Einstellungen aktiv:
  // sofort auf Einstellungen springen (ohne Alert)
  if (locked) {
    const activeSettings = document.querySelector(
      '.nav-item.active[data-tab="settings"]'
    );
    if (!activeSettings) {
      switchTab("settings");
    }
  }
}

function setupNavHandlers() {
  console.log("DetailHQ: setupNavHandlers");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const tab = item.getAttribute("data-tab");
      switchTab(tab);
    });
  });
}

function switchTab(tabName) {
  // Trial-Lock: Wenn Testphase abgelaufen + kein aktives Abo,
  // nur Einstellungen erlauben
  if (
    tabName !== "settings" &&
    currentProfile &&
    isTrialExpiredAndUnpaid(currentProfile)
  ) {
    tabName = "settings";
    alert(
      "Deine Testphase ist abgelaufen. Bitte schließe ein Abo ab, um DetailHQ weiter zu nutzen."
    );
  }

  navItems.forEach((item) => {
    const t = item.getAttribute("data-tab");
    item.classList.toggle("active", t === tabName);
  });

  tabSections.forEach((section) => {
    section.classList.toggle("active", section.id === `tab-${tabName}`);
  });

  if (tabName === "dashboard") {
    headerTitle.textContent = "Dashboard";
    headerSubtitle.textContent =
      "Übersicht über deine Aufträge und Umsätze.";
  } else if (tabName === "schedule") {
    headerTitle.textContent = "Zeitplan";
    headerSubtitle.textContent = "Alle geplanten Aufträge im Blick.";
  } else if (tabName === "orders") {
  headerTitle.textContent = "Annahmeprotokoll";
  headerSubtitle.textContent =
    "Fahrzeugannahme & Zustandsdokumentation.";
  if (typeof loadOrdersTab === "function") {
    loadOrdersTab();
  }
  } else if (tabName === "settings") {
    headerTitle.textContent = "Einstellungen";
    headerSubtitle.textContent =
      "Darstellung, Dienste, Zahlung & Support.";
  }
}

// ================================
// SETTINGS: SUB-VIEWS (Service / Business)
// Default: Hub sichtbar, Views versteckt.
// Öffnet erst nach Klick.
// Erwartete IDs (wie in deiner app.html):
// - #settings-hub
// - Buttons: #open-service-settings, #open-business-settings
// - Views:   #settings-view-service, #settings-view-business
// - Back:    #back-from-service, #back-from-business
// Support/Rechtliches bleiben im Hub sichtbar.
// Optional: Sections mit IDs #settings-support und #settings-legal werden beim Öffnen versteckt.
// ================================
function setupSettingsSubViews() {
  const hub = document.getElementById("settings-hub");

  const btnService = document.getElementById("open-service-settings");
  const btnBusiness = document.getElementById("open-business-settings");

  const viewService = document.getElementById("settings-view-service");
  const viewBusiness = document.getElementById("settings-view-business");

  const backService = document.getElementById("back-from-service");
  const backBusiness = document.getElementById("back-from-business");

  // Support + Rechtliches (falls vorhanden – du wolltest: im Hub sichtbar, sonst verstecken wenn View offen)
  const fallbackStaticSections = Array.from(
    document.querySelectorAll("#settings-support, #settings-legal")
  ).filter(Boolean);

  if (!hub || !btnService || !btnBusiness || !viewService || !viewBusiness) {
    console.warn(
      "DetailHQ: Settings SubViews: Fehlende Container. Erwartet: #settings-hub, #open-service-settings, #open-business-settings, #settings-view-service, #settings-view-business"
    );
    return;
  }

  const allViews = [viewService, viewBusiness];

  function setStaticVisible(visible) {
    if (!fallbackStaticSections.length) return;
    fallbackStaticSections.forEach((el) => el.classList.toggle("hidden", !visible));
  }

  function hideAllViews() {
    allViews.forEach((v) => v.classList.add("hidden"));
  }

  function openView(which) {
    // Hub ausblenden
    hub.classList.add("hidden");

    // Support/Rechtliches ausblenden
    setStaticVisible(false);

    // Views toggeln
    hideAllViews();
if (which === "service") {
  viewService.classList.remove("hidden");
  setupDiscountsUIHandlers();
  loadPromoCodes();
  loadGiftCards();
}

if (which === "business") viewBusiness.classList.remove("hidden");

    // nach oben scrollen
    const main = document.querySelector(".app-main");
    if (main) main.scrollTop = 0;
  }

  function backToHub() {
    hideAllViews();

    // Hub wieder zeigen
    hub.classList.remove("hidden");

    // Support/Rechtliches wieder zeigen
    setStaticVisible(true);

    const main = document.querySelector(".app-main");
    if (main) main.scrollTop = 0;
  }

  // Default: NICHTS offen (Hub sichtbar, Views zu)
  backToHub();

  // Clicks
  btnService.addEventListener("click", () => openView("service"));
  btnBusiness.addEventListener("click", () => openView("business"));

  if (backService) backService.addEventListener("click", backToHub);
  if (backBusiness) backBusiness.addEventListener("click", backToHub);

  // Wenn man auf den Settings-Tab klickt: NICHT automatisch irgendwas öffnen.
  // (Dein Wunsch: erst nach Klick auf Service/Business)
}

// ================================
// THEME
// ================================
function initThemeFromStorage() {
  const stored = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(stored);

  themeRadioInputs.forEach((input) => {
    input.checked = input.value === stored;
  });
}

function setupThemeHandlers() {
  themeRadioInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        const value = input.value;
        localStorage.setItem(THEME_KEY, value);
        applyTheme(value);
      }
    });
  });
}

function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-dark", "theme-system");

  if (theme === "light") {
    document.body.classList.add("theme-light");
  } else if (theme === "dark") {
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.add("theme-system");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    document.body.classList.add(prefersDark ? "theme-dark" : "theme-light");
  }
}

// ================================
// PROFILE / PROFILES TABLE
// ================================
async function ensureProfile() {
  if (!currentUser) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("DetailHQ: Fehler beim Laden des Profils:", error);
    return;
  }

  if (!data) {
    const themeSetting = localStorage.getItem(THEME_KEY) || "system";

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const { error: insertError } = await supabaseClient
      .from("profiles")
      .insert({
        id: currentUser.id,
        appearance: themeSetting,
        plan_status: "trial",
        trial_ends_at: trialEndsAt.toISOString(),
        early_bird_monthly: false,
        is_lifetime: false,
      });

    if (insertError) {
      console.error("DetailHQ: Fehler beim Anlegen des Profils:", insertError);
      return;
    }
  }
}

function applyDevAccountHides() {
  const email = currentUser?.email?.toLowerCase() || "";
  const billingSection = document.getElementById("settings-billing");
  if (!billingSection) return;

  if (email === "dev@detailhq.de") {
    billingSection.style.display = "none";
  } else {
    billingSection.style.display = "";
  }
}

async function loadProfileIntoForm() {
  if (!currentUser || !profileForm) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error) {
    console.error("DetailHQ: Fehler beim Laden des Profils:", error);
    return;
  }

  currentProfile = data;

  if (profileNameInput) profileNameInput.value = data.full_name || "";
  if (profileCompanyInput)
    profileCompanyInput.value = data.company_name || "";
  if (profileAddressInput) profileAddressInput.value = data.address || "";

  if (settingsReviewLinkInput) {
    settingsReviewLinkInput.value = data.review_link || "";
  }

  const pref = data.calendar_preference || "apple";
  calendarPreferenceInputs.forEach((inp) => {
    inp.checked = inp.value === pref;
  });

  updateAvatarVisual(data.avatar_url);
  updateBillingUI();
  updateTrialBanner();
  updateAccessUI();
  applyDevAccountHides();
  updateBookingLinkUI();
  applyOpeningHoursToForm(currentProfile?.opening_hours);
}

// Avatar: Default pfp.png, sonst URL
function updateAvatarVisual(avatarUrl) {
  if (!profileAvatarImage) return;
  console.log("DetailHQ: updateAvatarVisual", avatarUrl);
  if (avatarUrl) {
    profileAvatarImage.src = avatarUrl;
  } else {
    profileAvatarImage.src = "pfp.png";
  }
}

// ================================
// PROFILE-MODAL / MENÜ
// ================================
function setupProfileMenuHandlers() {
  console.log("DetailHQ: setupProfileMenuHandlers");

  if (profileButton && profileMenu) {
    profileButton.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = profileMenu.classList.contains("hidden");
      if (isHidden) {
        showProfileMenu();
      } else {
        hideProfileMenu();
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!profileMenu || !profileButton) return;
    if (
      !profileMenu.contains(e.target) &&
      !profileButton.contains(e.target)
    ) {
      hideProfileMenu();
    }
  });

  if (profileManageButton) {
    profileManageButton.addEventListener("click", () => {
      hideProfileMenu();
      openProfileModal();
    });
  }

  if (profileLogoutButton) {
    profileLogoutButton.addEventListener("click", async () => {
      hideProfileMenu();
      try {
        await supabaseClient.auth.signOut();
      } catch (err) {
        console.error("DetailHQ: Logout Fehler:", err);
      }
      currentUser = null;
      currentProfile = null;
      vehicleClasses = [];
      services = [];

      if (todayBookingsContainer) {
        todayBookingsContainer.innerHTML =
          '<p>Noch keine Aufträge für heute.</p>';
      }
      if (scheduleListContainer) {
        scheduleListContainer.innerHTML =
          '<p>Noch keine geplanten Aufträge.</p>';
      }

      showAuthView();
    });
  }

  if (profileCloseButton) {
    profileCloseButton.addEventListener("click", () => {
      closeProfileModal();
    });
  }

  if (profileModal) {
    profileModal.addEventListener("click", (e) => {
      if (
        e.target === profileModal ||
        e.target.classList.contains("profile-modal-backdrop")
      ) {
        closeProfileModal();
      }
    });
  }

  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      if (profileSaveMessage) profileSaveMessage.textContent = "";

      const full_name = profileNameInput?.value.trim() || "";
      const company_name = profileCompanyInput?.value.trim() || "";
      const address = profileAddressInput?.value.trim() || "";

      const calendar_preference = (() => {
        let v = "apple";
        calendarPreferenceInputs.forEach((inp) => {
          if (inp.checked) v = inp.value;
        });
        return v;
      })();

      const review_link = settingsReviewLinkInput
        ? settingsReviewLinkInput.value.trim()
        : currentProfile?.review_link || null;

      let avatar_url = currentProfile?.avatar_url || null;

      if (profileAvatarFile && profileAvatarFile.files.length > 0) {
        const file = profileAvatarFile.files[0];
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${currentUser.id}/${Date.now()}.${ext}`;

        console.log("DetailHQ: Avatar-Upload startet, Pfad:", path);

        const { error: uploadError } = await supabaseClient.storage
          .from("avatars")
          .upload(path, file, {
            upsert: true,
          });

        if (uploadError) {
          console.error(
            "DetailHQ: Avatar Upload fehlgeschlagen:",
            uploadError
          );
          if (profileSaveMessage) {
            profileSaveMessage.textContent =
              "Profilbild-Upload fehlgeschlagen, Rest wird gespeichert.";
          }
        } else {
          const {
            data: { publicUrl },
          } = supabaseClient.storage.from("avatars").getPublicUrl(path);

          console.log("DetailHQ: Avatar public URL:", publicUrl);
          avatar_url = publicUrl || avatar_url;
        }
      }

      const { error } = await supabaseClient
        .from("profiles")
        .update({
          full_name,
          company_name,
          address,
          avatar_url,
          calendar_preference,
          review_link,
        })
        .eq("id", currentUser.id);

      if (error) {
        console.error("DetailHQ: Profil speichern fehlgeschlagen:", error);
        if (profileSaveMessage) {
          profileSaveMessage.textContent =
            "Fehler beim Speichern. Bitte später erneut versuchen.";
        }
        return;
      }

      currentProfile = {
        ...(currentProfile || {}),
        full_name,
        company_name,
        address,
        avatar_url,
        calendar_preference,
        review_link,
      };

      updateAvatarVisual(avatar_url);
      updateBillingUI();
      updateTrialBanner();

      if (profileSaveMessage) profileSaveMessage.textContent = "Gespeichert.";
      setTimeout(() => {
        if (profileSaveMessage) profileSaveMessage.textContent = "";
        closeProfileModal();
      }, 1000);
    });
  }
}

function showProfileMenu() {
  if (!profileMenu) return;
  profileMenu.classList.remove("hidden");
}

function hideProfileMenu() {
  if (!profileMenu) return;
  profileMenu.classList.add("hidden");
}

function openProfileModal() {
  if (!profileModal) return;
  profileModal.classList.remove("hidden");
}

function closeProfileModal() {
  if (!profileModal) return;
  profileModal.classList.add("hidden");
}

// ================================
// BILLING (Stripe)
// ================================
function setupBillingHandlers() {
  const apiBase = "https://api.detailhq.de"; // aktuell ungenutzt, aber ok

  // Open Checkout Page (deine Checkout Sales Page)
  if (billingOpenCheckoutButton) {
    billingOpenCheckoutButton.addEventListener("click", () => {
      window.location.href = "/checkout";
    });
  }

  // Zahlung & Abo verwalten -> Checkout
  if (billingManageButton) {
    billingManageButton.addEventListener("click", () => {
      window.location.href = "/checkout";
    });
  }
}

function updateBillingUI() {
  // App zeigt keine Monats/Jahres/Lifetime Buttons mehr.
  // Manage-Button bleibt immer sichtbar.
  return;
}


function updateBookingLinkUI() {
  if (!currentUser) return;

  const link = `https://detailhq.de/book.html?user=${encodeURIComponent(currentUser.id)}`;

  if (settingsBookingLinkInput) settingsBookingLinkInput.value = link;

  if (settingsBookingLinkCopyBtn) {
    settingsBookingLinkCopyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        if (settingsBookingLinkStatus) settingsBookingLinkStatus.textContent = "Kopiert.";
        setTimeout(() => {
          if (settingsBookingLinkStatus) settingsBookingLinkStatus.textContent = "";
        }, 1200);
      } catch (e) {
        if (settingsBookingLinkStatus) settingsBookingLinkStatus.textContent = "Kopieren fehlgeschlagen.";
      }
    };
  }

  if (settingsBookingLinkOpenBtn) {
    settingsBookingLinkOpenBtn.onclick = () => {
      window.open(link, "_blank", "noopener,noreferrer");
    };
  }
}

function updateTrialBanner() {
  if (!trialBanner || !currentProfile) return;

  const status = currentProfile.plan_status || "trial";
  const rawEndsAt = currentProfile.trial_ends_at
    ? new Date(currentProfile.trial_ends_at)
    : null;

  if (status !== "trial" || !rawEndsAt) {
    trialBanner.classList.add("hidden");
    return;
  }

  // Beide Daten auf 00:00 normalisieren, damit wir echte "Kalendertage" vergleichen
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endsAt = new Date(rawEndsAt);
  endsAt.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (endsAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  let msg;
  if (diffDays > 1) {
    msg = `Deine Testphase läuft in ${diffDays} Tagen ab.`;
  } else if (diffDays === 1) {
    msg = `Deine Testphase läuft morgen ab.`;
  } else if (diffDays === 0) {
    msg = `Deine Testphase läuft heute ab.`;
  } else {
    msg = `Deine Testphase ist abgelaufen.`;
  }

  trialBannerText.textContent = msg;
  trialBanner.classList.remove("hidden");
}

function setupTrialBannerHandlers() {
  if (!trialBannerButton) return;

  trialBannerButton.addEventListener("click", () => {
    switchTab("settings");
  });
}

// ================================
// KALENDER
// ================================
function setupCalendarHandlers() {
  console.log("DetailHQ: setupCalendarHandlers");

  if (!calendarOpenButton) return;

  calendarOpenButton.addEventListener("click", () => {
    if (!currentCalendarUrl || !currentUser) return;

    let pref = "apple";
    calendarPreferenceInputs.forEach((inp) => {
      if (inp.checked) pref = inp.value;
    });

    if (pref === "apple") {
      // iOS / macOS – direkt per webcal öffnen
      const webcalUrl = currentCalendarUrl.replace(/^https?:/, "webcal:");
      window.location.href = webcalUrl;
    } else {
      // Google Calendar – offizielles Muster: render?cid=webcal://...
      const webcalUrl = currentCalendarUrl.replace(/^https?:/, "webcal:");
      const googleUrl = `https://calendar.google.com/calendar/render?cid=${webcalUrl}`;
      window.open(googleUrl, "_blank");
    }
  });
}

// ================================
// SERVICES & VEHICLE CLASSES
// ================================
async function loadVehicleClasses() {
  if (!currentUser || !supabaseClient || !vehicleClassesList) return;

  const { data, error } = await supabaseClient
    .from("vehicle_classes")
    .select("*")
    .eq("detailer_id", currentUser.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("DetailHQ: vehicle_classes load failed:", error);
    return;
  }

  vehicleClasses = data || [];

  if (vehicleClasses.length === 0) {
    const defaults = [
      { name: "Kleinwagen", price_delta_cents: 0, sort_order: 1 },
      { name: "Limo / Kombi", price_delta_cents: 2000, sort_order: 2 },
      { name: "SUV / Transporter", price_delta_cents: 4000, sort_order: 3 },
    ].map((v) => ({
      detailer_id: currentUser.id,
      name: v.name,
      price_delta_cents: v.price_delta_cents,
      sort_order: v.sort_order,
    }));

    const { data: inserted, error: insertError } = await supabaseClient
      .from("vehicle_classes")
      .insert(defaults)
      .select("*");

    if (insertError) {
      console.error(
        "DetailHQ: default vehicle_classes insert failed:",
        insertError
      );
    } else {
      vehicleClasses = inserted || [];
    }
  }

  renderVehicleClassesList();
  refreshBookingVehicleClassOptions();
}

function renderVehicleClassesList() {
  if (!vehicleClassesList) return;

  vehicleClassesList.innerHTML = "";

  if (!vehicleClasses || vehicleClasses.length === 0) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = "Noch keine Fahrzeugklassen angelegt.";
    vehicleClassesList.appendChild(p);
    return;
  }

  vehicleClasses.forEach((vc) => {
    const row = document.createElement("div");
    row.className = "settings-row";

    const left = document.createElement("div");
    left.className = "settings-row-main";

    const title = document.createElement("div");
    title.className = "settings-row-title";
    title.textContent = vc.name;

    const meta = document.createElement("div");
    meta.className = "settings-row-meta";

    const delta = vc.price_delta_cents || 0;
    const deltaEuro = delta / 100;
    const sign = deltaEuro > 0 ? "+" : "";
    const deltaText = deltaEuro.toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
    });

    meta.textContent = `Preis-Anpassung: ${sign}${deltaText}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "settings-row-actions";

    const pill = document.createElement("div");
    pill.className = "action-pill";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "action-pill-btn edit";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openVehicleClassModal(vc);
    });

    const sep = document.createElement("span");
    sep.className = "action-pill-separator";
    sep.textContent = "|";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "action-pill-btn delete";
    delBtn.textContent = "Löschen";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteVehicleClass(vc.id);
    });

    pill.appendChild(editBtn);
    pill.appendChild(sep);
    pill.appendChild(delBtn);

    right.appendChild(pill);

    row.appendChild(left);
    row.appendChild(right);

    vehicleClassesList.appendChild(row);
  });
}

function openVehicleClassModal(vc) {
  if (!vehicleClassModal) return;

  if (vehicleClassModalError) vehicleClassModalError.textContent = "";

  if (vc) {
    vehicleClassModalTitle.textContent = "Fahrzeugklasse bearbeiten";
    vehicleClassModal.dataset.id = vc.id;
    vehicleClassNameInput.value = vc.name || "";
    const deltaEuro = (vc.price_delta_cents || 0) / 100;
    vehicleClassPriceDeltaInput.value = deltaEuro.toString();
  } else {
    vehicleClassModalTitle.textContent = "Fahrzeugklasse hinzufügen";
    delete vehicleClassModal.dataset.id;
    vehicleClassNameInput.value = "";
    vehicleClassPriceDeltaInput.value = "0";
  }

  vehicleClassModal.classList.remove("hidden");
}

function closeVehicleClassModal() {
  if (!vehicleClassModal) return;
  vehicleClassModal.classList.add("hidden");
}

async function deleteVehicleClass(id) {
  if (!currentUser || !supabaseClient) return;
  if (!confirm("Fahrzeugklasse wirklich löschen?")) return;

  const { error } = await supabaseClient
    .from("vehicle_classes")
    .delete()
    .eq("id", id)
    .eq("detailer_id", currentUser.id);

  if (error) {
    console.error("DetailHQ: delete vehicle_class failed:", error);
    return;
  }

  vehicleClasses = vehicleClasses.filter((vc) => vc.id !== id);
  renderVehicleClassesList();
  refreshBookingVehicleClassOptions();
}

async function loadServices() {
  if (!currentUser || !supabaseClient || !servicesList) return;

  const { data, error } = await supabaseClient
    .from("services")
    .select("*")
    .eq("detailer_id", currentUser.id)
    .order("name", { ascending: true });

  if (error) {
    console.error("DetailHQ: services load failed:", error);
    return;
  }

  services = data || [];
  renderServicesList();
  refreshBookingServiceOptions();
  refreshBookingDetailSinglesOptions();
  renderSingles();
}

function renderServicesList() {
  if (!servicesList) return;

  servicesList.innerHTML = "";

  if (!services || services.length === 0) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = "Noch keine Services angelegt.";
    servicesList.appendChild(p);
    return;
  }

  services.forEach((svc) => {
    const row = document.createElement("div");
    row.className = "settings-row";

    const left = document.createElement("div");
    left.className = "settings-row-main";

    const title = document.createElement("div");
    title.className = "settings-row-title";
    title.textContent = svc.name;

    const meta = document.createElement("div");
    meta.className = "settings-row-meta";

    const kindLabel =
      svc.kind === "package"
        ? "Paket"
        : svc.kind === "single"
        ? "Einzelleistung"
        : "Service";

    const priceEuro = (svc.base_price_cents || 0) / 100;
    const priceText = priceEuro.toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
    });

    let durationText = "ohne Zeitangabe";
    if (svc.duration_minutes && svc.duration_minutes > 0) {
      const hours = svc.duration_minutes / 60;
      durationText = `${hours.toFixed(1)} Std.`;
    }

    const categoryText = svc.category ? ` · Kategorie: ${svc.category}` : "";

    meta.textContent = `${kindLabel} · ${priceText} · ${durationText}${categoryText}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "settings-row-actions";

    const pill = document.createElement("div");
    pill.className = "action-pill";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "action-pill-btn edit";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openServiceModal(svc);
    });

    const sep = document.createElement("span");
    sep.className = "action-pill-separator";
    sep.textContent = "|";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "action-pill-btn delete";
    delBtn.textContent = "Löschen";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteService(svc.id);
    });

    pill.appendChild(editBtn);
    pill.appendChild(sep);
    pill.appendChild(delBtn);

    right.appendChild(pill);

    row.appendChild(left);
    row.appendChild(right);

    servicesList.appendChild(row);
  });
}

function openServiceModal(service) {
  if (!serviceModal) return;
  if (!serviceForm) return;
  if (!serviceKindInput) return;

  // Modal öffnen
  serviceModal.classList.remove("hidden");

  // Title
  serviceModalTitle.textContent = service ? "Service bearbeiten" : "Service erstellen";

  // Reset UI
  serviceForm.reset();
  if (serviceModalError) serviceModalError.textContent = "";

  // WICHTIG: ID da speichern, wo dein Save-Code sie später liest
  if (service && service.id) {
    serviceModal.dataset.id = service.id;
  } else {
    delete serviceModal.dataset.id;
  }

  // Fields korrekt befüllen (DB-Felder: base_price_cents, duration_minutes, description)
  if (service) {
    serviceKindInput.value = service.kind || "single";
    if (serviceCategoryInput) serviceCategoryInput.value = service.category || "";
    if (serviceNameInput) serviceNameInput.value = service.name || "";

    // Preis: cents -> Euro
    const euro = ((service.base_price_cents || 0) / 100);
    servicePriceInput.value = euro ? String(euro) : "";

    // Dauer: Minuten -> Stunden (weil dein Save später Std.->Minuten rechnet)
    const hours = service.duration_minutes ? (service.duration_minutes / 60) : 0;
    serviceDurationInput.value = hours ? String(Number(hours.toFixed(2))) : "";

    if (serviceDescriptionInput) serviceDescriptionInput.value = service.description || "";
  } else {
    serviceKindInput.value = "single";
  }

  // Empfehlung direkt refreshen
  updateServicePriceRecommendationUI();
}

function closeServiceModal() {
  if (!serviceModal) return;
  serviceModal.classList.add("hidden");
}

async function deleteService(id) {
  if (!currentUser || !supabaseClient) return;
  if (!confirm("Service wirklich löschen?")) return;

  const { error } = await supabaseClient
    .from("services")
    .delete()
    .eq("id", id)
    .eq("detailer_id", currentUser.id);

  if (error) {
    console.error("DetailHQ: delete service failed:", error);
    return;
  }

  services = services.filter((svc) => svc.id !== id);
  renderServicesList();
  refreshBookingServiceOptions();
}

// ================================
// SERVICE PRICE RECOMMENDER (v1.5)
// ================================
//
// Regeln kommen aus JSON (Repo-Datei) und werden 1x geladen.
// Match: OR-Logik pro Regel (keywords[]).
// Überschneidungen: es gewinnt IMMER nur 1 Regel – die mit dem längsten gematchten Keyword.

function normalizeServiceText(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// kompakte Form: entfernt alles außer a-z0-9, mappt Umlaute/ß
function normalizeServiceKey(s) {
  const t = (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

  // alles raus außer a-z0-9
  return t.replace(/[^a-z0-9]/g, "");
}

function sanitizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;

  const minEuro = Number(rule.minEuro);
  const maxEuro = Number(rule.maxEuro);
  if (!Number.isFinite(minEuro) || !Number.isFinite(maxEuro)) return null;

  const keywordsRaw = Array.isArray(rule.keywords) ? rule.keywords : [];

  const keywordsNorm = keywordsRaw
    .map((k) => normalizeServiceText(k))
    .filter(Boolean);

  const keywordsKey = keywordsRaw
    .map((k) => normalizeServiceKey(k))
    .filter(Boolean);

  if (keywordsNorm.length === 0 && keywordsKey.length === 0) return null;

  return {
    id: rule.id || null,
    minEuro,
    maxEuro,
    hint: rule.hint || "",
    _keywordsNorm: keywordsNorm,
    _keywordsKey: keywordsKey,
  };
}

async function loadServicePriceRules() {
  if (servicePriceRulesLoaded) return SERVICE_PRICE_RULES;
  if (servicePriceRulesLoadPromise) return servicePriceRulesLoadPromise;

  servicePriceRulesLoadPromise = (async () => {
    try {
      const res = await fetch(SERVICE_PRICE_RULES_URL, { cache: "force-cache" });
      if (!res.ok) {
        console.warn("DetailHQ: Service-Preisregeln konnten nicht geladen werden:", res.status);
        SERVICE_PRICE_RULES = [];
        servicePriceRulesLoaded = true;
        return SERVICE_PRICE_RULES;
      }

      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.rules) ? raw.rules : []);
      SERVICE_PRICE_RULES = list.map(sanitizeRule).filter(Boolean);

      servicePriceRulesLoaded = true;
      return SERVICE_PRICE_RULES;
    } catch (e) {
      console.warn("DetailHQ: Service-Preisregeln Load Error:", e);
      SERVICE_PRICE_RULES = [];
      servicePriceRulesLoaded = true;
      return SERVICE_PRICE_RULES;
    } finally {
      // Promise wieder freigeben (falls du später manuell reloaden willst)
      servicePriceRulesLoadPromise = null;
    }
  })();

  return servicePriceRulesLoadPromise;
}

function findServicePriceRecommendation(serviceName) {
  const hay = normalizeServiceText(serviceName);
  const hayKey = normalizeServiceKey(serviceName);

  if (!hay && !hayKey) return null;

  // Beste Regel = längstes gematchtes Keyword (spezifischer gewinnt)
  let best = null;
  let bestLen = 0;

  for (const rule of SERVICE_PRICE_RULES) {
    // 1) match gegen "lesbar"
    const keysNorm = Array.isArray(rule._keywordsNorm) ? rule._keywordsNorm : [];
    for (const needle of keysNorm) {
      if (!needle) continue;
const parts = needle.split(" ").filter(Boolean);

let matched = false;

// 2-Wort-Keywords: Reihenfolge egal (z.B. "reifen dressing" == "dressing reifen")
if (parts.length === 2) {
  matched = hay.includes(parts[0]) && hay.includes(parts[1]);
} else {
  matched = hay.includes(needle);
}

if (matched) {
  const len = needle.length;
  if (len > bestLen) {
    bestLen = len;
    best = rule;
  }
}
    }

    // 2) match gegen "kompakt" (spaces, bindestriche, sonderzeichen egal)
    const keysKey = Array.isArray(rule._keywordsKey) ? rule._keywordsKey : [];
    for (const needleKey of keysKey) {
      if (!needleKey) continue;
      if (hayKey.includes(needleKey)) {
        const len = needleKey.length;
        if (len > bestLen) {
          bestLen = len;
          best = rule;
        }
      }
    }
  }

  if (!best) return null;

  return {
    id: best.id || null,
    minEuro: best.minEuro,
    maxEuro: best.maxEuro,
    hint: best.hint || "",
  };
}

function formatEuro(euro) {
  const v = Number(euro) || 0;
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function updateServicePriceRecommendationUI() {
  if (!servicePriceRecoWrap) return;

  const kind = serviceKindInput ? serviceKindInput.value : "";
  const name = serviceNameInput ? serviceNameInput.value : "";

  // Nur für Einzelleistung
  if (kind !== "single") {
    servicePriceRecoWrap.classList.add("hidden");
    if (servicePriceRecoHint) servicePriceRecoHint.textContent = "";
    return;
  }

  const reco = findServicePriceRecommendation(name);

  if (!reco) {
    servicePriceRecoWrap.classList.add("hidden");
    if (servicePriceRecoHint) servicePriceRecoHint.textContent = "";
    return;
  }

  servicePriceRecoWrap.classList.remove("hidden");
  if (servicePriceRecoMin) servicePriceRecoMin.textContent = formatEuro(reco.minEuro);
  if (servicePriceRecoMax) servicePriceRecoMax.textContent = formatEuro(reco.maxEuro);
  if (servicePriceRecoHint) servicePriceRecoHint.textContent = reco.hint || "";
}

function setupServiceManagementHandlers() {
  // Vehicle classes
  if (vehicleClassAddButton) {
    vehicleClassAddButton.addEventListener("click", () =>
      openVehicleClassModal(null)
    );
  }
  if (vehicleClassModalClose) {
    vehicleClassModalClose.addEventListener("click", () =>
      closeVehicleClassModal()
    );
  }
  if (vehicleClassModal) {
    vehicleClassModal.addEventListener("click", (e) => {
      if (
        e.target === vehicleClassModal ||
        e.target.classList.contains("profile-modal-backdrop")
      ) {
        closeVehicleClassModal();
      }
    });
  }
  if (vehicleClassForm) {
    vehicleClassForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser || !supabaseClient) return;

      if (vehicleClassModalError) vehicleClassModalError.textContent = "";

      const name = vehicleClassNameInput.value.trim();
      if (!name) {
        if (vehicleClassModalError) {
          vehicleClassModalError.textContent = "Name darf nicht leer sein.";
        }
        return;
      }

      const deltaEuro =
        parseFloat(vehicleClassPriceDeltaInput.value || "0") || 0;
      const price_delta_cents = Math.round(deltaEuro * 100);

      const existingId = vehicleClassModal.dataset.id;
      if (existingId) {
        const { error } = await supabaseClient
          .from("vehicle_classes")
          .update({
            name,
            price_delta_cents,
          })
          .eq("id", existingId)
          .eq("detailer_id", currentUser.id);

        if (error) {
          console.error("DetailHQ: update vehicle_class failed:", error);
          if (vehicleClassModalError) {
            vehicleClassModalError.textContent =
              "Fehler beim Speichern. Bitte später erneut versuchen.";
          }
          return;
        }
      } else {
        const sortOrder = (vehicleClasses?.length || 0) + 1;
        const { data, error } = await supabaseClient
          .from("vehicle_classes")
          .insert({
            detailer_id: currentUser.id,
            name,
            price_delta_cents,
            sort_order: sortOrder,
          })
          .select("*")
          .single();

        if (error) {
          console.error("DetailHQ: insert vehicle_class failed:", error);
          if (vehicleClassModalError) {
            vehicleClassModalError.textContent =
              "Fehler beim Speichern. Bitte später erneut versuchen.";
          }
          return;
        }

        vehicleClasses.push(data);
      }

      await loadVehicleClasses();
      closeVehicleClassModal();
    });
  }

  function setupSettingsDropdownToggles() {
  }
  function attachToggle(toggleEl) {
    if (!toggleEl) return;
    const wrapper = toggleEl.closest(".settings-dropdown");
    if (!wrapper) return;

    toggleEl.addEventListener("click", () => {
      const isOpen = wrapper.classList.contains("open");
      // alle anderen zu
      document
        .querySelectorAll(".settings-dropdown.open")
        .forEach((el) => el.classList.remove("open"));
      // dieses auf/zu
      wrapper.classList.toggle("open", !isOpen);
    });
  }

  attachToggle(vehicleClassesDropdownToggle);
  attachToggle(servicesDropdownToggle);
}

  // Services
  if (serviceAddButton) {
    serviceAddButton.addEventListener("click", () => openServiceModal(null));
  }
  if (serviceModalClose) {
    serviceModalClose.addEventListener("click", () => closeServiceModal());
  }
  if (serviceModal) {
    serviceModal.addEventListener("click", (e) => {
      if (
        e.target === serviceModal ||
        e.target.classList.contains("profile-modal-backdrop")
      ) {
        closeServiceModal();
      }
    });
  }
  // Live-Update Preis-Empfehlung
if (serviceNameInput) {
  serviceNameInput.addEventListener("input", updateServicePriceRecommendationUI);
}
if (serviceKindInput) {
  serviceKindInput.addEventListener("change", updateServicePriceRecommendationUI);
}
  if (serviceForm) {
    serviceForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser || !supabaseClient) return;

      if (serviceModalError) serviceModalError.textContent = "";

      const kind = serviceKindInput.value;
      const category = serviceCategoryInput.value.trim() || null;
      const name = serviceNameInput.value.trim();
      const priceEuro = parseFloat(servicePriceInput.value || "0") || 0;

      // Eingabe in Stunden -> Speicherung in Minuten
      const durationHoursRaw = serviceDurationInput.value
        ? parseFloat(serviceDurationInput.value.replace(",", ".") || "0")
        : 0;
      const durationHours = Number.isFinite(durationHoursRaw)
        ? durationHoursRaw
        : 0;
      const durationMinutes = durationHours > 0 ? Math.round(durationHours * 60) : 0;

      const description = serviceDescriptionInput.value.trim() || null;

      if (!name) {
        if (serviceModalError) {
          serviceModalError.textContent = "Name darf nicht leer sein.";
        }
        return;
      }

      const base_price_cents = Math.round(priceEuro * 100);

      const payload = {
        detailer_id: currentUser.id,
        kind,
        category,
        name,
        description,
        base_price_cents,
        duration_minutes: durationMinutes,
      };

      const existingId = serviceModal.dataset.id;

      if (existingId) {
        const { error } = await supabaseClient
          .from("services")
          .update(payload)
          .eq("id", existingId)
          .eq("detailer_id", currentUser.id);

        if (error) {
          console.error("DetailHQ: update service failed:", error);
          if (serviceModalError) {
            serviceModalError.textContent =
              "Fehler beim Speichern. Bitte später erneut versuchen.";
          }
          return;
        }
      } else {
        const { error } = await supabaseClient
          .from("services")
          .insert(payload);
        if (error) {
          console.error("DetailHQ: insert service failed:", error);
          if (serviceModalError) {
            serviceModalError.textContent =
              "Fehler beim Speichern. Bitte später erneut versuchen.";
          }
          return;
        }
      }

      await loadServices();
      closeServiceModal();
    });
  }

// Helper: Booking selects
function refreshBookingVehicleClassOptions() {
  const targets = [bookingVehicleClassSelect, bookingDetailVehicleClassSelect];

  targets.forEach((selectEl) => {
    if (!selectEl) return;

    // Reset
    selectEl.innerHTML = "";

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "Keine Auswahl";
    selectEl.appendChild(optNone);

    if (!vehicleClasses || vehicleClasses.length === 0) return;

    vehicleClasses.forEach((vc) => {
      const opt = document.createElement("option");
      opt.value = vc.id;
      opt.textContent = vc.name;
      selectEl.appendChild(opt);
    });
  });
}

function refreshBookingServiceOptions() {
  if (!bookingMainServiceSelect || !bookingSinglesList || !bookingSinglesMenu)
    return;

  // Paket-Dropdown
  bookingMainServiceSelect.innerHTML = "";
  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "Kein Paket";
  bookingMainServiceSelect.appendChild(optNone);

  const packages = (services || []).filter((s) => s.kind === "package");
  packages.forEach((svc) => {
    const opt = document.createElement("option");
    opt.value = svc.id;
    opt.textContent = svc.name;
    bookingMainServiceSelect.appendChild(opt);
  });
  renderPackages();

  // Einzelleistungen: Hidden-Select + schönes Dropdown mit Checkboxen
  bookingSinglesList.innerHTML = "";
  bookingSinglesMenu.innerHTML = "";

  const singles = (services || []).filter((s) => s.kind === "single");

  if (singles.length === 0) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = "Noch keine Einzelleistungen angelegt.";
    bookingSinglesMenu.appendChild(p);
    return;
  }

  // Nach Kategorie gruppieren
  const groupsMap = new Map();

  singles.forEach((svc) => {
    const rawCat = (svc.category || "").trim();
    const isOther = !rawCat;
    const key = isOther ? "__zz_other" : rawCat.toLowerCase();
    const label = isOther ? "Sonstige" : rawCat;

    if (!groupsMap.has(key)) {
      groupsMap.set(key, { label, services: [] });
    }
    groupsMap.get(key).services.push(svc);

    // Hidden-Select Option
    const opt = document.createElement("option");
    opt.value = svc.id;
    opt.textContent = svc.name;
    bookingSinglesList.appendChild(opt);
  });

  const sortedKeys = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a === "__zz_other") return 1;
    if (b === "__zz_other") return -1;
    const la = groupsMap.get(a).label.toLowerCase();
    const lb = groupsMap.get(b).label.toLowerCase();
    return la.localeCompare(lb, "de");
  });

  sortedKeys.forEach((key) => {
    const group = groupsMap.get(key);
    const labelText = group.label;

    // Kategorie-Überschrift immer anzeigen (inkl. Sonstige)
    const catHeader = document.createElement("div");
    catHeader.className = "booking-singles-category";
    catHeader.textContent = labelText;
    bookingSinglesMenu.appendChild(catHeader);

    // Services innerhalb der Kategorie nach Name sortieren
    const servicesSorted = [...group.services].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "de")
    );

    servicesSorted.forEach((svc) => {
      const item = document.createElement("div");
      item.className = "booking-singles-item";
      item.dataset.serviceId = svc.id;

      const priceEuro = (svc.base_price_cents || 0) / 100;
      const priceText = priceEuro.toLocaleString("de-DE", {
        style: "currency",
        currency: "EUR",
      });

      const label = document.createElement("div");
      label.className = "booking-singles-item-label";
      label.textContent = `${svc.name} (${priceText})`;

      const checkbox = document.createElement("div");
      checkbox.className = "booking-singles-item-checkbox";

      item.appendChild(label);
      item.appendChild(checkbox);

      item.addEventListener("click", () => {
        const nowSelected = item.classList.toggle("selected");
        const optEl = bookingSinglesList.querySelector(
          `option[value="${svc.id}"]`
        );
        if (optEl) {
          optEl.selected = nowSelected;
        }
        recalcBookingSummary();
      });

      bookingSinglesMenu.appendChild(item);
    });
  });
}

function refreshBookingDetailServiceOptions() {
  if (!services || !Array.isArray(services)) return;

  // Pakete
  if (bookingDetailMainServiceSelect) {
    bookingDetailMainServiceSelect.innerHTML = "";

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "Kein Paket";
    bookingDetailMainServiceSelect.appendChild(optNone);

    const packages = services.filter((s) => s.kind === "package");

    packages.forEach((svc) => {
      const opt = document.createElement("option");
      opt.value = svc.id;
      opt.textContent = svc.name;
      bookingDetailMainServiceSelect.appendChild(opt);
    });
  }

  // Einzelleistungen
  if (bookingDetailSinglesSelect) {
    bookingDetailSinglesSelect.innerHTML = "";

    const singles = services.filter((s) => s.kind === "single");

    singles.forEach((svc) => {
      const opt = document.createElement("option");
      opt.value = svc.id;
      // Kategorie voranstellen, wenn vorhanden
      const prefix = svc.category ? `[${svc.category}] ` : "";
      opt.textContent = prefix + svc.name;
      bookingDetailSinglesSelect.appendChild(opt);
    });
  }
}

function refreshBookingDetailSinglesOptions() {
  if (!bookingDetailSinglesList || !bookingDetailSinglesMenu) return;

  bookingDetailSinglesList.innerHTML = "";
  bookingDetailSinglesMenu.innerHTML = "";

  const singles = (services || []).filter((s) => s.kind === "single");

  if (singles.length === 0) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = "Noch keine Einzelleistungen angelegt.";
    bookingDetailSinglesMenu.appendChild(p);
    return;
  }

  // Nach Kategorie gruppieren
  const groupsMap = new Map();

  singles.forEach((svc) => {
    const rawCat = (svc.category || "").trim();
    const isOther = !rawCat;
    const key = isOther ? "__zz_other" : rawCat.toLowerCase();
    const label = isOther ? "Sonstige" : rawCat;

    if (!groupsMap.has(key)) {
      groupsMap.set(key, { label, services: [] });
    }
    groupsMap.get(key).services.push(svc);

    // Hidden-Select Option
    const opt = document.createElement("option");
    opt.value = svc.id;
    opt.textContent = svc.name;
    bookingDetailSinglesList.appendChild(opt);
  });

  const sortedKeys = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a === "__zz_other") return 1;
    if (b === "__zz_other") return -1;
    const la = groupsMap.get(a).label.toLowerCase();
    const lb = groupsMap.get(b).label.toLowerCase();
    return la.localeCompare(lb, "de");
  });

  sortedKeys.forEach((key) => {
    const group = groupsMap.get(key);
    const labelText = group.label;

    // Kategorie-Überschrift auch im Detail-Modal
    const catHeader = document.createElement("div");
    catHeader.className = "booking-singles-category";
    catHeader.textContent = labelText;
    bookingDetailSinglesMenu.appendChild(catHeader);

    const servicesSorted = [...group.services].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "de")
    );

    servicesSorted.forEach((svc) => {
      const item = document.createElement("div");
      item.className = "booking-singles-item";
      item.dataset.serviceId = svc.id;

      const priceEuro = (svc.base_price_cents || 0) / 100;
      const priceText = priceEuro.toLocaleString("de-DE", {
        style: "currency",
        currency: "EUR",
      });

      const labelEl = document.createElement("div");
      labelEl.className = "booking-singles-item-label";
      labelEl.textContent = `${svc.name} (${priceText})`;

      const checkbox = document.createElement("div");
      checkbox.className = "booking-singles-item-checkbox";

      item.appendChild(labelEl);
      item.appendChild(checkbox);

      item.addEventListener("click", () => {
        const nowSelected = item.classList.toggle("selected");
        const optEl = bookingDetailSinglesList.querySelector(
          `option[value="${svc.id}"]`
        );
        if (optEl) {
          optEl.selected = nowSelected;
        }
      });

      bookingDetailSinglesMenu.appendChild(item);
    });
  });
}

// ================================
// BOOKING / NEUER AUFTRAG
// ================================
function setupBookingHandlers() {
  if (newBookingButton) {
    newBookingButton.addEventListener("click", () => openBookingModal());
  }
  if (newBookingButton2) {
    newBookingButton2.addEventListener("click", () => openBookingModal());
  }
  if (bookingCloseButton) {
    bookingCloseButton.addEventListener("click", () => closeBookingModal());
  }
  if (bookingModal) {
    bookingModal.addEventListener("click", (e) => {
      if (
        e.target === bookingModal ||
        e.target.classList.contains("profile-modal-backdrop")
      ) {
        closeBookingModal();
      }
    });
  }

  if (bookingForm) {
    bookingForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitBooking();
    });
  }

  if (bookingNext1) {
    bookingNext1.addEventListener("click", () => {
      showBookingStep(2);
    });
  }
  if (bookingNext2) {
    bookingNext2.addEventListener("click", () => {
      showBookingStep(3);
    });
  }
  if (bookingBack2) {
    bookingBack2.addEventListener("click", () => {
      showBookingStep(1);
    });
  }
  if (bookingBack3) {
    bookingBack3.addEventListener("click", () => {
      showBookingStep(2);
    });
  }

  if (bookingVehicleClassSelect) {
    bookingVehicleClassSelect.addEventListener("change", recalcBookingSummary);
  }
  if (bookingMainServiceSelect) {
    bookingMainServiceSelect.addEventListener("change", recalcBookingSummary);
  }
  if (bookingSinglesList) {
    bookingSinglesList.addEventListener("change", () => {
      recalcBookingSummary();
    });
  }

  if (bookingDiscountTypeSelect) {
    bookingDiscountTypeSelect.addEventListener("change", recalcBookingSummary);
  }
  if (bookingDiscountValueInput) {
    bookingDiscountValueInput.addEventListener("input", recalcBookingSummary);
  }

  // Helper für Dropdown-Toggle (Neuer Auftrag + Detail-Modal)
  function attachBookingDropdown(wrapperSelector, toggleEl, menuEl) {
    if (!toggleEl || !menuEl) return;

    const wrapper =
      (wrapperSelector && document.querySelector(wrapperSelector)) ||
      toggleEl.closest(".settings-dropdown");

    if (!wrapper) return;

    toggleEl.addEventListener("click", () => {
      const isOpen = wrapper.classList.contains("open");

      // alle anderen Dropdowns schließen
      document
        .querySelectorAll(".settings-dropdown.open")
        .forEach((el) => el.classList.remove("open"));

      wrapper.classList.toggle("open", !isOpen);
      toggleEl.setAttribute("aria-expanded", !isOpen ? "true" : "false");
    });
  }

  // Neuer Auftrag – Einzelleistungen
  attachBookingDropdown(
    ".booking-singles-dropdown",
    bookingSinglesToggle,
    bookingSinglesMenu
  );

  // Bestehender Auftrag – Einzelleistungen
  attachBookingDropdown(
    ".booking-detail-singles-dropdown",
    bookingDetailSinglesToggle,
    bookingDetailSinglesMenu
  );
}

function openBookingModal() {
  if (!bookingModal) return;
  if (bookingError) bookingError.textContent = "";

  // Form nicht komplett resetten, aber Schritt 1 anzeigen
  showBookingStep(1);
  bookingModal.classList.remove("hidden");
}

function closeBookingModal() {
  if (!bookingModal) return;
  bookingModal.classList.add("hidden");
}

function recalcBookingSummary() {
  if (!bookingSummaryPrice || !bookingSummaryDuration) return;

  let totalBasePriceCents = 0;
  let totalMinutes = 0;

  let classPriceDeltaCents = 0;

  if (bookingVehicleClassSelect && bookingVehicleClassSelect.value) {
    const vcId = bookingVehicleClassSelect.value;
    const vc = (vehicleClasses || []).find((v) => v.id === vcId);
    if (vc) {
      classPriceDeltaCents = vc.price_delta_cents || 0;
    }
  }

  const getServiceById = (id) => (services || []).find((s) => s.id === id);

  // Paket
  if (bookingMainServiceSelect && bookingMainServiceSelect.value) {
    const main = getServiceById(bookingMainServiceSelect.value);
    if (main) {
      totalBasePriceCents += main.base_price_cents || 0;
      if (main.duration_minutes) {
        totalMinutes += main.duration_minutes;
      }
    }
  }

  // Einzelleistungen (Mehrfach-Select)
  if (bookingSinglesList) {
    const selected = Array.from(bookingSinglesList.selectedOptions || []);
    selected.forEach((opt) => {
      if (!opt.value) return;
      const svc = getServiceById(opt.value);
      if (!svc) return;
      totalBasePriceCents += svc.base_price_cents || 0;
      if (svc.duration_minutes) {
        totalMinutes += svc.duration_minutes;
      }
    });
  }

  // Rabatt
  let discountType = bookingDiscountTypeSelect
    ? bookingDiscountTypeSelect.value
    : "none";
  let discountValueRaw = bookingDiscountValueInput
    ? parseFloat(bookingDiscountValueInput.value || "0")
    : 0;
  let discountValue = Number.isFinite(discountValueRaw) ? discountValueRaw : 0;

  let discountAmountCents = 0;

  if (discountType === "amount" && discountValue > 0) {
    discountAmountCents = Math.round(discountValue * 100);
  } else if (discountType === "percent" && discountValue > 0) {
    if (discountValue > 100) discountValue = 100;
    if (discountValue < 0) discountValue = 0;
    discountAmountCents = Math.round(
      totalBasePriceCents * (discountValue / 100)
    );
  } else {
    discountType = "none";
    discountValue = 0;
  }

  const totalPriceCentsRaw =
    totalBasePriceCents + classPriceDeltaCents - discountAmountCents;
  const totalPriceCents = Math.max(0, totalPriceCentsRaw);
  const priceEuro = totalPriceCents / 100;

  bookingSummaryPrice.textContent = priceEuro.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });

  const hours = totalMinutes / 60;
  bookingSummaryDuration.textContent = `${hours.toFixed(1)} Std.`;
}

async function submitBooking() {
  if (!currentUser || !supabaseClient) return;
  if (bookingError) bookingError.textContent = "";

  if (!bookingDateInput || !bookingTimeInput) return;

  const dateStr = bookingDateInput.value;
  const timeStr = bookingTimeInput.value || "09:00";

  if (!dateStr) {
    if (bookingError) bookingError.textContent = "Bitte Datum auswählen.";
    showBookingStep(2);
    return;
  }

  const startAt = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(startAt.getTime())) {
    if (bookingError) bookingError.textContent = "Ungültiges Datum / Uhrzeit.";
    showBookingStep(2);
    return;
  }

  let classPriceDeltaCents = 0;
  let vehicleClassId = null;
  let vehicleClassName = null;

  if (bookingVehicleClassSelect && bookingVehicleClassSelect.value) {
    vehicleClassId = bookingVehicleClassSelect.value;
    const vc = (vehicleClasses || []).find((v) => v.id === vehicleClassId);
    if (vc) {
      vehicleClassName = vc.name || null;
      classPriceDeltaCents = vc.price_delta_cents || 0;
    }
  }

  // =======================================
// AUFTRAGSNUMMER (#1, #2, #3, ...)
// =======================================
const { count: bookingCount, error: countError } = await supabaseClient
  .from("bookings")
  .select("*", { count: "exact", head: true });

if (countError) {
  console.error("Fehler beim Ermitteln der Auftragsnummer:", countError);
}

const orderNumber = (bookingCount || 0) + 1;

  const getServiceById = (id) => (services || []).find((s) => s.id === id);

  let items = [];
  let totalBasePriceCents = 0;
  let totalMinutes = 0;

  // Paket
  let mainServiceName = null;
  if (bookingMainServiceSelect && bookingMainServiceSelect.value) {
    const main = getServiceById(bookingMainServiceSelect.value);
    if (main) {
      mainServiceName = main.name;
      const basePrice = main.base_price_cents || 0;
      const baseDur = main.duration_minutes || 0;

      items.push({
        role: "package",
        service_id: main.id,
        name: main.name,
        base_price_cents: basePrice,
        price_cents: basePrice,
        base_duration_minutes: baseDur,
        duration_minutes: baseDur,
      });

      totalBasePriceCents += basePrice;
      totalMinutes += baseDur;
    }
  }

  // Einzelleistungen
  if (bookingSinglesList) {
    const selected = Array.from(bookingSinglesList.selectedOptions || []);
    selected.forEach((opt) => {
      if (!opt.value) return;
      const svc = getServiceById(opt.value);
      if (!svc) return;

      const basePrice = svc.base_price_cents || 0;
      const baseDur = svc.duration_minutes || 0;

      items.push({
        role: "single",
        service_id: svc.id,
        name: svc.name,
        base_price_cents: basePrice,
        price_cents: basePrice,
        base_duration_minutes: baseDur,
        duration_minutes: baseDur,
      });

      totalBasePriceCents += basePrice;
      totalMinutes += baseDur;
    });
  }


  if (classPriceDeltaCents !== 0) {
    items.push({
      role: "vehicle_price_adjustment",
      amount_cents: classPriceDeltaCents,
    });
  }

  let discountType = bookingDiscountTypeSelect
    ? bookingDiscountTypeSelect.value
    : "none";
  let discountValueRaw = bookingDiscountValueInput
    ? parseFloat(bookingDiscountValueInput.value || "0")
    : 0;
  let discountValue = Number.isFinite(discountValueRaw) ? discountValueRaw : 0;

  let discountAmountCents = 0;

  if (discountType === "amount" && discountValue > 0) {
    discountAmountCents = Math.round(discountValue * 100);
  } else if (discountType === "percent" && discountValue > 0) {
    if (discountValue > 100) discountValue = 100;
    if (discountValue < 0) discountValue = 0;
    discountAmountCents = Math.round(
      totalBasePriceCents * (discountValue / 100)
    );
  } else {
    discountType = "none";
    discountValue = 0;
  }

  const totalPriceCentsRaw =
    totalBasePriceCents + classPriceDeltaCents - discountAmountCents;
  const totalPriceCents = Math.max(0, totalPriceCentsRaw);

  const car = bookingCarInput ? bookingCarInput.value.trim() : null;
  const notes = bookingNotesInput ? bookingNotesInput.value.trim() : null;

  const customerName = bookingCustomerNameInput
    ? bookingCustomerNameInput.value.trim()
    : null;
  const customerEmail = bookingCustomerEmailInput
    ? bookingCustomerEmailInput.value.trim()
    : null;
  const customerPhone = bookingCustomerPhoneInput
    ? bookingCustomerPhoneInput.value.trim()
    : null;
  const customerAddress = bookingCustomerAddressInput
    ? bookingCustomerAddressInput.value.trim()
    : null;

  const payload = {
    detailer_id: currentUser.id,
    start_at: startAt.toISOString(),
    duration_minutes: totalMinutes,
    service_name: mainServiceName || "Auftrag",
    total_price: totalPriceCents / 100,
    notes,
    car,
    vehicle_class_id: vehicleClassId,
    vehicle_class_name: vehicleClassName,
    items: items,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    customer_address: customerAddress,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount_cents: discountAmountCents,
  };

  const { error } = await supabaseClient.from("bookings").insert(payload);
  if (error) {
    console.error("DetailHQ: booking insert failed:", error);
    if (bookingError) {
      bookingError.textContent =
        "Auftrag konnte nicht gespeichert werden. Bitte später erneut versuchen.";
    }
    return;
  }

  closeBookingModal();
  console.log("DetailHQ: Booking erfolgreich angelegt", payload);

  await loadBookingsForDashboardAndSchedule();
}

// ================================
// BOOKINGS LADEN (Dashboard & Zeitplan)
// ================================
function setupDashboardPeriodHandlers() {
  if (!dashboardPeriodToggle) return;

  dashboardPeriodToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".period-chip");
    if (!btn) return;
    const period = btn.getAttribute("data-period");
    if (!period) return;

    const chips =
      dashboardPeriodToggle.querySelectorAll(".period-chip");
    chips.forEach((chip) => {
      chip.classList.toggle("active", chip === btn);
    });

    if (lastStatsBookings && lastStatsBookings.length > 0) {
      updateDashboardStats(lastStatsBookings);
    }
  });
}

function getCurrentDashboardPeriod() {
  if (!dashboardPeriodToggle) return "today";
  const active = dashboardPeriodToggle.querySelector(".period-chip.active");
  if (!active) return "today";
  return active.getAttribute("data-period") || "today";
}

function getPeriodRange(period) {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  if (period === "today") {
    return { start: todayStart, end: todayEnd };
  }

  if (period === "week") {
    // Montag als Wochenbeginn (KW)
    const day = todayStart.getDay() || 7; // So=0 -> 7
    const monday = new Date(todayStart);
    monday.setDate(todayStart.getDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 7);
    return { start: monday, end: sunday };
  }

  if (period === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start: monthStart, end: monthEnd };
  }

  if (period === "year") {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
    return { start: yearStart, end: yearEnd };
  }

  return { start: todayStart, end: todayEnd };
}

function updateDashboardStats(bookings) {
  if (!revenueTodayElement || !volumeTodayElement) return;
  if (!bookings || bookings.length === 0) {
    revenueTodayElement.textContent = "€ 0";
    volumeTodayElement.textContent = "€ 0";
    return;
  }

  const period = getCurrentDashboardPeriod();
  const { start, end } = getPeriodRange(period);

  let revenueCents = 0;
  let volumeCents = 0;

  bookings.forEach((b) => {
    if (!b.start_at) return;
    const startAt = new Date(b.start_at);
    if (startAt < start || startAt >= end) return;

    const totalPriceEuro =
      typeof b.total_price === "number" ? b.total_price : 0;
    const totalPriceCents = Math.round(totalPriceEuro * 100);

    volumeCents += totalPriceCents;
    revenueCents += getBookingRevenueCents(b);
  });

  revenueTodayElement.textContent = (revenueCents / 100).toLocaleString(
    "de-DE",
    { style: "currency", currency: "EUR" }
  );
  volumeTodayElement.textContent = (volumeCents / 100).toLocaleString(
    "de-DE",
    { style: "currency", currency: "EUR" }
  );
}

async function loadBookingsForDashboardAndSchedule() {
  if (!currentUser || !supabaseClient) return;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Für KPIs: komplettes aktuelles Jahr laden
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);

  const { data: todayBookings, error: todayError } = await supabaseClient
    .from("bookings")
    .select("*")
    .eq("detailer_id", currentUser.id)
    .gte("start_at", todayStart.toISOString())
    .lt("start_at", todayEnd.toISOString())
    .order("start_at", { ascending: true });

  if (todayError) {
    console.error("DetailHQ: today bookings load failed:", todayError);
  }

  const { data: scheduleBookings, error: scheduleError } =
    await supabaseClient
      .from("bookings")
      .select("*")
      .eq("detailer_id", currentUser.id)
      .order("start_at", { ascending: true });

      (scheduleBookings || []).forEach((b) => {
  if (!b.job_status && b.status) b.job_status = b.status;
});

  if (scheduleError) {
    console.error("DetailHQ: schedule bookings load failed:", scheduleError);
  }
  // Für Annahmeprotokoll (Dropdown / Auswahl)
  allBookings = Array.isArray(scheduleBookings) ? scheduleBookings : [];
  renderIntakeBookingSelect();

  const { data: statsBookings, error: statsError } = await supabaseClient
    .from("bookings")
    .select("*")
    .eq("detailer_id", currentUser.id)
    .gte("start_at", yearStart.toISOString())
    .lt("start_at", yearEnd.toISOString())
    .order("start_at", { ascending: true });

  if (statsError) {
    console.error("DetailHQ: stats bookings load failed:", statsError);
  }

  renderTodayBookings(todayBookings || []);
  renderScheduleList(scheduleBookings || []);

  lastStatsBookings = statsBookings || [];
  updateDashboardStats(lastStatsBookings);
    // Review-Übersicht im Dashboard
  renderReviewReminders(statsBookings || []);
}

function formatBookingTitle(booking) {
  if (!booking) return "Auftrag";

  const hasNumericId =
    typeof booking.id === "number" || /^[0-9]+$/.test(String(booking.id || ""));

  const base = hasNumericId
    ? `Auftrag #${booking.id}`
    : booking.service_name || "Auftrag";

  if (booking.customer_name && booking.customer_name.trim() !== "") {
    return `${base} – ${booking.customer_name.trim()}`;
  }
  return base;
}

async function confirmBookingRequest(bookingId) {
  const session = (await supabaseClient.auth.getSession())?.data?.session;
  const token = session?.access_token || "";
  const res = await fetch("https://api.detailhq.de/booking/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ booking_id: bookingId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function proposeBookingAlternative(bookingId, proposedStartAtIso) {
  const session = (await supabaseClient.auth.getSession())?.data?.session;
  const token = session?.access_token || "";
  const res = await fetch("https://api.detailhq.de/booking/propose", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ booking_id: bookingId, proposed_start_at: proposedStartAtIso }),
  });
  if (!res.ok) throw new Error(await res.text());
}


function renderTodayBookings(bookings) {
  if (!todayBookingsContainer) return;

  if (!bookings || bookings.length === 0) {
    todayBookingsContainer.classList.add("empty-state");
    todayBookingsContainer.innerHTML = "<p>Noch keine Aufträge für heute.</p>";
    return;
  }

  todayBookingsContainer.classList.remove("empty-state");
  todayBookingsContainer.innerHTML = "";

  bookings.forEach((b) => {
    const card = document.createElement("div");
    card.className = "list-item booking-list-item";

    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = formatBookingTitle(b);

    const start = b.start_at ? new Date(b.start_at) : null;
    let timeStr = "";
    if (start) {
      timeStr = start.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    const lineDate = document.createElement("div");
    lineDate.className = "list-item-meta";

    if (timeStr) {
      lineDate.textContent = `Termin: ${timeStr}`;
    } else {
      lineDate.textContent = "Termin: –";
    }

    if (b.car) {
      lineDate.textContent += ` · ${b.car}`;
    }

    const lineAmount = document.createElement("div");
    lineAmount.className = "list-item-meta booking-amount";
    if (typeof b.total_price === "number") {
      lineAmount.textContent =
        "Umsatz: " +
        b.total_price.toLocaleString("de-DE", {
          style: "currency",
          currency: "EUR",
        });
    } else {
      lineAmount.textContent = "Umsatz: –";
    }

    card.appendChild(title);
    card.appendChild(lineDate);
    card.appendChild(lineAmount);

    // Klick -> Detail-Modal
    card.addEventListener("click", () => {
      openBookingDetail(b);
    });

    todayBookingsContainer.appendChild(card);
  });
}

function renderReviewReminders(bookings) {
  if (!reviewRemindersContainer) return;

  // Jobs, die abgeschlossen sind und noch keine Review als erledigt markiert haben
  const pending = (bookings || []).filter(
    (b) => b.job_status === "done" && !isBookingReviewDone(b)
  );

  if (pending.length === 0) {
    reviewRemindersContainer.classList.add("empty-state");
    reviewRemindersContainer.innerHTML =
      "<p>Aktuell keine offenen Bewertungs-Erinnerungen.</p>";
    return;
  }

  reviewRemindersContainer.classList.remove("empty-state");
  reviewRemindersContainer.innerHTML = "";

  // nach Datum sortieren (nächster Termin zuerst)
  pending.sort((a, b) => {
    const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
    const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
    return aTime - bTime;
  });

  pending.forEach((b) => {
    const card = document.createElement("div");
    card.className = "list-item booking-list-item";

    const header = document.createElement("div");
    header.className = "booking-row-header";

    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = formatBookingTitle(b);

    const statusPill = document.createElement("span");
    statusPill.className = "payment-pill payment-pill--open";
    statusPill.textContent = "Review offen";

    header.appendChild(title);
    header.appendChild(statusPill);

    const meta = document.createElement("div");
    meta.className = "list-item-meta";

    if (b.start_at) {
      const d = new Date(b.start_at);
      const dateStr = d.toLocaleDateString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      });
      meta.textContent = `Abgeschlossen: ${dateStr}`;
    } else {
      meta.textContent = "Abgeschlossen";
    }

    const copyHint = document.createElement("div");
    copyHint.className = "list-item-meta";
    copyHint.textContent = "Klick für Text & Copy";

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(copyHint);

    card.addEventListener("click", () => {
      openReviewModal(b);
    });

    reviewRemindersContainer.appendChild(card);
  });
}

function renderScheduleList(bookings) {
  if (!scheduleListContainer) return;

  if (!bookings || bookings.length === 0) {
    scheduleListContainer.classList.add("empty-state");
    scheduleListContainer.innerHTML =
      "<p>Noch keine geplanten Aufträge.</p>";
    return;
  }

  scheduleListContainer.classList.remove("empty-state");
  scheduleListContainer.innerHTML = "";

const orderMap = {
  requested: 0,
  proposed: 1,
  planned: 2,
  in_progress: 3,
  done: 4,
  canceled: 5,
};

const statusLabelMap = {
  requested: "Anfragen",
  proposed: "Alternativ vorgeschlagen",
  planned: "Geplant",
  in_progress: "In Arbeit",
  done: "Abgeschlossen",
  canceled: "Storniert",
};

  // Sortieren nach Status + Datum
  const sorted = [...bookings].sort((a, b) => {
    const aStatus = a.job_status || "planned";
    const bStatus = b.job_status || "planned";
    const aRank = orderMap[aStatus] ?? 0;
    const bRank = orderMap[bStatus] ?? 0;

    if (aRank !== bRank) return aRank - bRank;

    const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
    const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
    return aTime - bTime;
  });

  // Gruppieren
const grouped = {
  requested: [],
  proposed: [],
  planned: [],
  in_progress: [],
  done: [],
  canceled: [],
};

  sorted.forEach((b) => {
    const key = b.job_status || "planned";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  // Render: Reihenfolge strikt nach orderMap
  ["planned", "in_progress", "done", "canceled"].forEach((statusKey) => {
    const list = grouped[statusKey];
    if (!list || list.length === 0) return;

    // HEADLINE
    const h = document.createElement("h4");
    h.className = "schedule-group-headline";
    h.textContent = statusLabelMap[statusKey] || statusKey;
    scheduleListContainer.appendChild(h);

    // LISTE
    list.forEach((b) => {
      const row = document.createElement("div");
      row.className = "list-item booking-list-item";

      // Header: Titel + Zahlungsstatus-Pill
      const header = document.createElement("div");
      header.className = "booking-row-header";

      const title = document.createElement("div");
      title.className = "list-item-title";
      title.textContent = formatBookingTitle(b);
      
      const pill = document.createElement("span");
      pill.className = "payment-pill";

      let pillLabel = "Offen";
      let pillClass = "payment-pill--open";
      const payStatus = b.payment_status || "open";

      if (payStatus === "paid") {
        pillLabel = "Bezahlt";
        pillClass = "payment-pill--paid";
      } else if (payStatus === "partial") {
        pillLabel = "Teilzahlung";
        pillClass = "payment-pill--partial";
      }

      pill.textContent = pillLabel;
      pill.className += " " + pillClass;

      header.appendChild(title);
      header.appendChild(pill);

      // Datum/Uhrzeit
      const start = b.start_at ? new Date(b.start_at) : null;
      let dateStr = "";
      let timeStr = "";

      if (start) {
        dateStr = start.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        });
        timeStr = start.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      const lineDate = document.createElement("div");
      lineDate.className = "list-item-meta";
      if (dateStr || timeStr) {
        lineDate.textContent = `Termin: ${dateStr} ${timeStr}`.trim();
      } else {
        lineDate.textContent = "Termin: –";
      }

      if (b.car) {
        lineDate.textContent += ` · ${b.car}`;
      }

      // Statuszeile (text)
      const statusLine = document.createElement("div");
      statusLine.className = "list-item-meta";
      statusLine.textContent = `Status: ${statusLabelMap[statusKey]}`;

      // Umsatz
      const lineAmount = document.createElement("div");
      lineAmount.className = "list-item-meta booking-amount";
      if (typeof b.total_price === "number") {
        lineAmount.textContent =
          "Umsatz: " +
          b.total_price.toLocaleString("de-DE", {
            style: "currency",
            currency: "EUR",
          });
      } else {
        lineAmount.textContent = "Umsatz: –";
      }

      row.appendChild(header);
      if ((b.job_status || "planned") === "requested") {
  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.marginTop = "10px";

  const btnConfirm = document.createElement("button");
  btnConfirm.className = "btn-primary";
  btnConfirm.textContent = "Bestätigen";
  btnConfirm.addEventListener("click", async (e) => {
    e.stopPropagation();
    await confirmBookingRequest(b.id);
    await loadBookingsForDashboardAndSchedule();
  });

  const btnAlt = document.createElement("button");
  btnAlt.className = "btn-secondary";
  btnAlt.textContent = "Alternative";
  btnAlt.addEventListener("click", async (e) => {
    e.stopPropagation();
    const iso = prompt("Alternativtermin als ISO (z.B. 2026-01-20T09:30:00.000Z)");
    if (!iso) return;
    await proposeBookingAlternative(b.id, iso);
    await loadBookingsForDashboardAndSchedule();
  });

  actions.appendChild(btnConfirm);
  actions.appendChild(btnAlt);
  row.appendChild(actions);
}

      row.appendChild(lineDate);
      row.appendChild(statusLine);
      row.appendChild(lineAmount);

      row.addEventListener("click", () => {
        openBookingDetail(b);
      });

      scheduleListContainer.appendChild(row);
    });
  });
}

function updatePaymentFieldsVisibility() {
  const status = bookingDetailPaymentStatusSelect
    ? bookingDetailPaymentStatusSelect.value
    : "open";

  if (bookingDetailPartialRow) {
    bookingDetailPartialRow.style.display =
      status === "partial" ? "block" : "none";
  }
  if (bookingDetailPaidOverrideRow) {
    bookingDetailPaidOverrideRow.style.display =
      status === "paid" ? "block" : "none";
  }
}

function getBookingPaymentMeta(booking) {
  const result = {
    partialCents: null,
    overrideCents: null,
  };

  if (!booking || !Array.isArray(booking.items)) return result;

  booking.items.forEach((it) => {
    if (!it || typeof it !== "object") return;
    if (it.role === "payment_partial" && typeof it.amount_cents === "number") {
      result.partialCents = it.amount_cents;
    }
    if (
      it.role === "payment_final_override" &&
      typeof it.amount_cents === "number"
    ) {
      result.overrideCents = it.amount_cents;
    }
  });

  return result;
}

function getBookingRevenueCents(booking) {
  if (!booking) return 0;

  const status = booking.payment_status || "open";
  const totalPriceEuro =
    typeof booking.total_price === "number" ? booking.total_price : 0;
  const totalPriceCents = Math.round(totalPriceEuro * 100);

  const { partialCents, overrideCents } = getBookingPaymentMeta(booking);

  // Voll bezahlt
  if (status === "paid") {
    // Wenn abweichende Summe gesetzt, diese verwenden
    if (overrideCents != null) return overrideCents;
    // sonst komplettes Auftragsvolumen
    return totalPriceCents;
  }

  // Teilzahlung
  if (status === "partial") {
    if (partialCents != null) return partialCents;
    return 0;
  }

  // Offen oder storniert -> kein Umsatz
  return 0;
}

function isBookingReviewDone(booking) {
  if (!booking || !Array.isArray(booking.items)) return false;
  return booking.items.some((it) => it && it.role === "review_done");
}

function parseEuroInputToCents(inputEl) {
  if (!inputEl) return null;
  const raw = inputEl.value.trim().replace(",", ".");
  if (!raw) return null;
  const num = parseFloat(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function openBookingDetail(booking) {
  if (!bookingDetailModal) return;
  currentDetailBooking = booking;

    // Sicherstellen, dass alle Selects / Dropdowns aktuell sind
  refreshBookingVehicleClassOptions();
  refreshBookingDetailServiceOptions();
  refreshBookingDetailSinglesOptions();

  // Titel: Auftrag #ID – Kunde
  if (bookingDetailTitle) {
    bookingDetailTitle.textContent = formatBookingTitle(booking);
  }

  // Termin + Fahrzeug
  const start = booking.start_at ? new Date(booking.start_at) : null;
  let metaText = "";

  if (start) {
    const dateStr = start.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
    const timeStr = start.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    metaText = `Termin: ${dateStr} ${timeStr}`;
  }

    // Termin in Inputs spiegeln
  if (bookingDetailDateInput) {
    bookingDetailDateInput.value = start
      ? start.toISOString().slice(0, 10)
      : "";
  }
  if (bookingDetailTimeInput) {
    if (start) {
      const hh = String(start.getHours()).padStart(2, "0");
      const mm = String(start.getMinutes()).padStart(2, "0");
      bookingDetailTimeInput.value = `${hh}:${mm}`;
    } else {
      bookingDetailTimeInput.value = "";
    }
  }

  // Buchungsdetails
  if (bookingDetailCarInput) {
    bookingDetailCarInput.value = booking.car || "";
  }
  if (bookingDetailVehicleClassSelect) {
    bookingDetailVehicleClassSelect.value =
      booking.vehicle_class_id || "";
  }
  if (bookingDetailDiscountTypeSelect) {
    bookingDetailDiscountTypeSelect.value =
      booking.discount_type || "none";
  }
  if (bookingDetailDiscountValueInput) {
    bookingDetailDiscountValueInput.value =
      booking.discount_value != null ? booking.discount_value : "";
  }

  // Services in die Detail-Selects spiegeln
  if (services && Array.isArray(services)) {
    // Wir orientieren uns an den Items, die beim Anlegen / Bearbeiten
    // geschrieben werden: role === "package" / "single"
    const serviceItems = Array.isArray(booking.items)
      ? booking.items.filter(
          (it) => it && (it.role === "package" || it.role === "single")
        )
      : [];

    const mainServiceItem = serviceItems.find((it) => it.role === "package");
    const singleServiceItems = serviceItems.filter(
      (it) => it.role === "single"
    );

    // Paket
    if (bookingDetailMainServiceSelect) {
      // sicherstellen, dass Optionen aktuell sind
      refreshBookingDetailServiceOptions();

      if (mainServiceItem && mainServiceItem.service_id) {
        bookingDetailMainServiceSelect.value = String(
          mainServiceItem.service_id
        );
      } else {
        bookingDetailMainServiceSelect.value = "";
      }
    }

    // Einzelleistungen
    if (bookingDetailSinglesSelect) {
      // sicherstellen, dass Optionen aktuell sind
      refreshBookingDetailServiceOptions();

      const singleIds = new Set(
        singleServiceItems
          .map((it) => it.service_id)
          .filter((id) => id != null)
          .map(String)
      );

      for (const opt of bookingDetailSinglesSelect.options) {
        opt.selected = singleIds.has(opt.value);
      }
    }
  }

  // Einzelleistungen im Detail-Dropdown spiegeln
  if (bookingDetailSinglesList && bookingDetailSinglesMenu) {
    // sicherstellen, dass die Optionen aktuell sind
    refreshBookingDetailSinglesOptions();

    const selectedIds = new Set(
      (Array.isArray(booking.items) ? booking.items : [])
        .filter((it) => it && it.role === "single")
        .map((it) => String(it.service_id))
        .filter(Boolean)
    );

    // Hidden-Select markieren
    for (const opt of bookingDetailSinglesList.options) {
      opt.selected = selectedIds.has(opt.value);
    }

    // Visuelle Checkbox-Pills markieren
    bookingDetailSinglesMenu
      .querySelectorAll(".booking-singles-item")
      .forEach((item) => {
        const id = item.dataset.serviceId;
        if (!id) return;
        const isSelected = selectedIds.has(String(id));
        item.classList.toggle("selected", isSelected);
      });
  }


  // Kunde
  if (bookingDetailCustomerNameInput) {
    bookingDetailCustomerNameInput.value = booking.customer_name || "";
  }
  if (bookingDetailCustomerEmailInput) {
    bookingDetailCustomerEmailInput.value = booking.customer_email || "";
  }
  if (bookingDetailCustomerPhoneInput) {
    bookingDetailCustomerPhoneInput.value = booking.customer_phone || "";
  }
  if (bookingDetailCustomerAddressInput) {
    bookingDetailCustomerAddressInput.value =
      booking.customer_address || "";
  }

  if (booking.car) {
    metaText += metaText ? ` · ${booking.car}` : booking.car;
  }

  if (bookingDetailMeta) bookingDetailMeta.textContent = metaText || "Termin: –";

  // Auftragsvolumen in €
  if (bookingDetailPrice) {
    if (typeof booking.total_price === "number") {
      bookingDetailPrice.textContent =
        "Auftragsvolumen: " +
        booking.total_price.toLocaleString("de-DE", {
          style: "currency",
          currency: "EUR",
        });
    } else {
      bookingDetailPrice.textContent = "Auftragsvolumen: –";
    }
  }

  // Buchungsdetails (Pakete, Leistungen, Fahrzeugklasse, Rabatt, Dauer)
  if (bookingDetailBookingContainer) {
    const parts = [];

    // Leistungen aus items
    if (Array.isArray(booking.items) && booking.items.length > 0) {
      const lines = booking.items
        .filter((it) => it.role === "package" || it.role === "single")
        .map((it) => {
          const price =
            typeof it.price_cents === "number"
              ? (it.price_cents / 100).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })
              : "";
          const roleLabel =
            it.role === "package"
              ? "Paket"
              : it.role === "single"
              ? "Einzelleistung"
              : "Anpassung";
          return `${roleLabel}: ${it.name || "—"}${
            price ? ` (${price})` : ""
          }`;
        });

      if (lines.length > 0) {
        parts.push("<strong>Leistungen:</strong><br>" + lines.join("<br>"));
      }
    }

    // Fahrzeugklasse
    if (booking.vehicle_class_name) {
      parts.push(
        `<strong>Fahrzeugklasse:</strong> ${booking.vehicle_class_name}`
      );
    }

    // Dauer
    if (typeof booking.duration_minutes === "number" && booking.duration_minutes > 0) {
      const hours = booking.duration_minutes / 60;
      parts.push(
        `<strong>Dauer:</strong> ${hours.toFixed(1).replace(".", ",")} Std.`
      );
    }

    // Rabatt
    if (
      booking.discount_type &&
      booking.discount_type !== "none" &&
      typeof booking.discount_amount_cents === "number" &&
      booking.discount_amount_cents > 0
    ) {
      const discountEuro = booking.discount_amount_cents / 100;
      if (booking.discount_type === "amount") {
        parts.push(
          `<strong>Rabatt:</strong> ${discountEuro.toLocaleString("de-DE", {
            style: "currency",
            currency: "EUR",
          })}`
        );
      } else if (booking.discount_type === "percent") {
        parts.push(
          `<strong>Rabatt:</strong> ${
            booking.discount_value || 0
          }% (${discountEuro.toLocaleString("de-DE", {
            style: "currency",
            currency: "EUR",
          })})`
        );
      }
    }

    bookingDetailBookingContainer.innerHTML =
      parts.length > 0 ? parts.join("<br><br>") : "Keine weiteren Details.";
  }

  // Kunde
  if (bookingDetailCustomerContainer) {
    const lines = [];

    if (booking.customer_name) {
      lines.push(`<strong>Name:</strong> ${booking.customer_name}`);
    }
    if (booking.customer_email) {
      lines.push(`<strong>E-Mail:</strong> ${booking.customer_email}`);
    }
    if (booking.customer_phone) {
      lines.push(`<strong>Telefon:</strong> ${booking.customer_phone}`);
    }
    if (booking.customer_address) {
      lines.push(`<strong>Adresse:</strong> ${booking.customer_address}`);
    }

    bookingDetailCustomerContainer.innerHTML =
      lines.length > 0 ? lines.join("<br>") : "Keine Kundendaten hinterlegt.";
  }

  // Notizen
  if (bookingDetailNotes) {
    bookingDetailNotes.value = booking.notes || "";
  }

  // Status-Felder
  if (bookingDetailJobStatusSelect) {
    bookingDetailJobStatusSelect.value = booking.job_status || "planned";
  }

  if (bookingDetailPaymentStatusSelect) {
    bookingDetailPaymentStatusSelect.value =
      booking.payment_status || "open";
  }

  // Payment-Meta in Inputs spiegeln
  const { partialCents, overrideCents } = getBookingPaymentMeta(booking);

  if (bookingDetailPartialAmountInput) {
    bookingDetailPartialAmountInput.value =
      partialCents != null ? (partialCents / 100).toString() : "";
  }

  if (bookingDetailPaidOverrideInput) {
    bookingDetailPaidOverrideInput.value =
      overrideCents != null ? (overrideCents / 100).toString() : "";
  }

  updatePaymentFieldsVisibility();

  bookingDetailModal.classList.remove("hidden");
}

function closeBookingDetailModal() {
  if (!bookingDetailModal) return;
  bookingDetailModal.classList.add("hidden");
  currentDetailBooking = null;
}

// ================================
// ANNAHMEPROTOKOLL (Intake)
// ================================
let currentIntakeStep = 1;
let currentIntakeBooking = null;

const INTAKE_BUCKET = "intake";

const INTAKE_EXTERIOR_SLOTS = [
  { key: "front_left", label: "Vorne links" },
  { key: "front_right", label: "Vorne rechts" },
  { key: "hood", label: "Motorhaube" },
  { key: "windshield", label: "Windschutzscheibe" },
  { key: "roof", label: "Dach" },
  { key: "rear_center", label: "Heck" },
  { key: "left_side", label: "Fahrzeugseite links" },
  { key: "right_side", label: "Fahrzeugseite rechts" },
];

const INTAKE_INTERIOR_SLOTS = [
  { key: "dash_left", label: "Armaturenbrett links" },
  { key: "dash_right", label: "Armaturenbrett rechts" },
  { key: "driver_seat", label: "Fahrersitz" },
  { key: "codriver_seat", label: "Beifahrersitz" },
  { key: "rear_seats", label: "Rückbank" },
  { key: "trunk", label: "Kofferraum" },
];

const exteriorPoints = [
  "Vorne links",
  "Vorne rechts",
  "Motorhaube",
  "Windschutzscheibe",
  "Fahrzeugseite links",
  "Fahrzeugseite rechts",
  "Dach",
  "Heck"
];
const interiorPoints = [
  "Armaturenbrett links", "Armaturenbrett rechts",
  "Fahrersitz", "Beifahrersitz",
  "Rückbank", "Kofferraum"
];

let intakeState = {
  booking_id: null,
  doc_date: null,
  customer_note: "",
  internal_note: "",
  vehicle: { make_model: "", plate: "", vin: "", year: "", mileage: "" },
  checklist: {},
  // WICHTIG: Arrays statt {}
  exterior: new Array(8).fill(null), 
  interior: new Array(6).fill(null),
  signature: { jpeg_base64: "" },
  legal: { handover: false, agb: false, note: false },
  send_email: false,
  customer_email: "",
};

function resetIntakeState() {
  intakeState = {
    booking_id: null,
    doc_date: null,
    customer_note: "",
    internal_note: "",
    vehicle: { make_model: "", plate: "", vin: "", year: "", mileage: "" },
    checklist: {},
    // WICHTIG: Reset auch als Array
    exterior: new Array(8).fill(null), 
    interior: new Array(6).fill(null),
    signature: { jpeg_base64: "" },
    legal: { handover: false, agb: false, note: false },
    send_email: false,
    customer_email: "",
  };
}

function openIntakeModalForBooking(booking) {
  if (intakeDocDate && !intakeDocDate.value) {
  intakeDocDate.value = new Date().toISOString().slice(0, 10);
}
  if (!booking) return;

  resetIntakeState();
  currentIntakeBooking = booking;

  intakeState.booking_id = booking.id;

  if (intakeDocDate) {
    intakeDocDate.value = new Date().toISOString().slice(0, 10);
    intakeState.doc_date = intakeDocDate.value;
  }

  if (intakeCustomerEmail && booking.customer_email) {
    intakeCustomerEmail.value = booking.customer_email;
  }
// E-Mail Feld sichtbar machen
if (intakeCustomerEmail) {
  intakeCustomerEmail.closest(".form-row")?.classList.remove("hidden");
}
  if (intakeBookingSummary) {
    intakeBookingSummary.textContent =
      (booking.customer_name || "Kunde") +
      " – " +
      (booking.car || "Fahrzeug");
  }

  if (intakeModal) intakeModal.classList.remove("hidden");
  setIntakeStep(1);
if (intakeDocDate && !intakeDocDate.value) {
  const today = new Date();
  intakeDocDate.value = today.toISOString().slice(0, 10);
}
}

function openIntakeModalForBooking(booking) {
  if (!booking || !intakeModal) return;

  resetIntakeState();
  currentIntakeBooking = booking;
  intakeState.booking_id = booking.id;

  // Default Datum = heute (lokal)
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);

  if (intakeDocDate) intakeDocDate.value = isoDate;
  intakeState.doc_date = isoDate;

  // E-Mail vom Auftrag ziehen (falls vorhanden)
  const email = String(booking.customer_email || "").trim();
  if (intakeCustomerEmail) intakeCustomerEmail.value = email;
  intakeState.customer_email = email;

  if (intakeBookingSummary) {
    intakeBookingSummary.textContent = formatBookingTitle(booking);
  }

  // Falls Fahrzeugdaten schon im Auftrag stehen, vorfüllen
  if (intakeVehicleMakeModel) intakeVehicleMakeModel.value = booking.car || "";
  if (intakeVehicleMakeModel) intakeState.vehicle.make_model = intakeVehicleMakeModel.value;

  // "car" ist bei dir eher Freitext. Kennzeichen/Baujahr/km sind im Booking nicht zwingend -> leer lassen.

  if (intakeCustomerNote) intakeCustomerNote.value = "";
  if (intakeInternalNote) intakeInternalNote.value = "";

  if (intakeQDamages) intakeQDamages.value = "no";
  if (intakeQSmell) intakeQSmell.value = "no";
  if (intakeQValuables) intakeQValuables.value = "no";
  if (intakeQWarnings) intakeQWarnings.value = "no";
  if (intakeQWheels) intakeQWheels.value = "no";
  if (intakeQFuel) intakeQFuel.value = "unknown";
  if (intakeQKeys) intakeQKeys.value = "2";
  if (intakeQAccessories) intakeQAccessories.value = "no";

  if (intakeQDamagesNote) intakeQDamagesNote.value = "";
  if (intakeQSmellNote) intakeQSmellNote.value = "";
  if (intakeQValuablesNote) intakeQValuablesNote.value = "";
  if (intakeQWarningsNote) intakeQWarningsNote.value = "";
  if (intakeQWheelsNote) intakeQWheelsNote.value = "";
  if (intakeQFuelNote) intakeQFuelNote.value = "";
  if (intakeQKeysNote) intakeQKeysNote.value = "";
  if (intakeQAccessoriesNote) intakeQAccessoriesNote.value = "";

  if (intakeLegalHandover) intakeLegalHandover.checked = false;
  if (intakeLegalAgb) intakeLegalAgb.checked = false;
  if (intakeLegalNote) intakeLegalNote.checked = false;

if (intakeSendEmail) intakeSendEmail.value = "no";
if (intakeEmailRow) intakeEmailRow.style.display = "none";
if (intakeCustomerEmail) intakeCustomerEmail.value = "";

  if (intakeStatus) intakeStatus.textContent = "";

  if (intakeSendEmail && intakeEmailRow) {
  const syncEmailRow = () => {
    const v = String(intakeSendEmail.value || "no").toLowerCase();
    intakeEmailRow.style.display = v === "yes" ? "block" : "none";
  };
  intakeSendEmail.addEventListener("change", syncEmailRow);
  syncEmailRow();
}

  currentIntakeStep = 1;
  setIntakeStep(1);

  setupSignaturePad();

  intakeModal.classList.remove("hidden");
}

function closeIntakeModal() {
  if (!intakeModal) return;
  intakeModal.classList.add("hidden");
  intakeModal.classList.add("hidden");
  currentIntakeBooking = null;
  if (intakeStatus) intakeStatus.textContent = "";
  const errEl = document.getElementById("intake-final-error");
  if (errEl) errEl.textContent = "";
  const okEl = document.getElementById("intake-final-success");
  if (okEl) okEl.textContent = "";
}

function setIntakeStep(step) {
  currentIntakeStep = step;

  // 1. Alle Steps durchgehen und Sichtbarkeit toggeln
  const steps = [intakeStep1, intakeStep2, intakeStep3, intakeStep4, intakeStep5, intakeStep6];
  steps.forEach((el, idx) => {
    if (!el) return;
    const s = idx + 1;
    // Zeige nur den aktuellen Step
    el.classList.toggle("hidden", s !== step);
  });

  // 2. Indikatoren oben aktualisieren
  const inds = [intakeStepIndicator1, intakeStepIndicator2, intakeStepIndicator3, intakeStepIndicator4, intakeStepIndicator5, intakeStepIndicator6];
  inds.forEach((el, idx) => {
    if (!el) return;
    const s = idx + 1;
    el.classList.toggle("active", s === step);
  });

  // 3. Logik für spezifische Steps
  
  // Step 3: Tank-Pills (Logik aus deinem Snippet)
  if (step === 3) {
    const fuelPills = document.querySelectorAll("#intake-fuel-pill .pill");
    if (fuelPills.length > 0) {
        fuelPills.forEach(pill => {
          pill.onclick = () => {
            document
              .querySelectorAll("#intake-fuel-pill .pill")
              .forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            if(intakeState) intakeState.fuel_level = pill.dataset.value;
          };
        });
    }
  }

  // Step 4: Außenfotos & Punkte
  if (step === 4) {
    if (typeof renderPhotoSlots === "function") renderPhotoSlots(intakeExteriorList, INTAKE_EXTERIOR_SLOTS, "exterior");
    if (typeof renderIntakePhotoPoints === "function") renderIntakePhotoPoints("intake-exterior-points", exteriorPoints, "exterior");
  }

  // Step 5: Innenfotos & Punkte
  if (step === 5) {
    if (typeof renderPhotoSlots === "function") renderPhotoSlots(intakeInteriorList, INTAKE_INTERIOR_SLOTS, "interior");
    if (typeof renderIntakePhotoPoints === "function") renderIntakePhotoPoints("intake-interior-points", interiorPoints, "interior");
  }

  // Step 6: Unterschrift (CRITICAL FIX für DOMException)
  if (step === 6) {
      // Kleiner Timeout, damit das Element sicher sichtbar ist (display:block),
      // bevor der Canvas seine Größe berechnet.
      setTimeout(() => {
          if (typeof setupSignaturePad === "function") setupSignaturePad();
      }, 50);
  }
}

function safeFileName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function compressImageToJpegBlob(file) {
  // file -> JPEG blob (max 1600px)
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const maxSide = 1600;
  let w = img.width;
  let h = img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("image_compress_failed");
  return blob;
}

async function uploadJpegToSupabase(path, jpegBlob) {
  const { error } = await supabaseClient.storage
    .from(INTAKE_BUCKET)
    .upload(path, jpegBlob, {
      cacheControl: "3600",
      upsert: true,
      contentType: "image/jpeg",
    });

  if (error) throw error;

  const { data } = supabaseClient.storage.from(INTAKE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

function renderIntakeBookingSelect() {
  const select = document.getElementById("intake-booking-select");
  if (!select || !Array.isArray(allBookings)) return;

  select.innerHTML = `<option value="">Bitte wählen…</option>`;

  const usable = allBookings.filter(b =>
    b.status !== "canceled" && b.status !== "deleted"
  );

  for (const b of usable) {
    const date = b.start_at
      ? new Date(b.start_at).toLocaleDateString("de-DE")
      : "";

    const customer = b.customer_name || "Unbekannter Kunde";
    const vehicle = b.car || "";

    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = `${date} – ${customer}${vehicle ? " – " + vehicle : ""}`;

    select.appendChild(opt);
  }
}

function renderPhotoSlots(container, slots, kind) {
  if (!container) return;
  container.innerHTML = "";

  slots.forEach((slot) => {
    const wrap = document.createElement("div");
    wrap.className = "intake-photo-item";

    const head = document.createElement("div");
    head.className = "intake-photo-head";
    head.innerHTML = `<strong>${slot.label}</strong>`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-small intake-upload-btn";
    btn.textContent = "Foto +";
    btn.style.marginLeft = "10px";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const img = document.createElement("img");
    img.style.maxWidth = "100%";
    img.style.marginTop = "10px";
    img.style.display = "none";
    img.style.borderRadius = "4px";

    const note = document.createElement("input");
    note.type = "text";
    note.className = "field-input";
    note.style.marginTop = "5px";
    note.style.width = "100%";
    note.placeholder = "Notiz (optional)";

    // WIEDERHERSTELLEN (Fix für verschwundene Bilder)
    const currentObj = kind === "exterior" ? intakeState.exterior : intakeState.interior;
    // Slot initialisieren falls leer
    if (!currentObj[slot.key]) currentObj[slot.key] = { path: "", public_url: "", note: "" };
    
    const entry = currentObj[slot.key];
    if (entry.public_url) {
        img.src = entry.public_url;
        img.style.display = "block";
        btn.textContent = "Ändern";
    }
    if (entry.note) note.value = entry.note;

    btn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      try {
        btn.textContent = "Lade...";
        btn.disabled = true;
        
        const jpegBlob = await compressImageToJpegBlob(file);
        const uid = currentUser?.id;
        const bid = intakeState.booking_id;
        const ts = Date.now();
        const path = `${uid}/${bid}/${kind}_${slot.key}_${ts}.jpg`;

        const publicUrl = await uploadJpegToSupabase(path, jpegBlob);

        img.src = publicUrl;
        img.style.display = "block";
        
        // SOFORT SPEICHERN
        currentObj[slot.key].public_url = publicUrl;
        currentObj[slot.key].path = path;
        
        btn.textContent = "Ändern";
      } catch (e) {
        console.error(e);
        btn.textContent = "Fehler";
      } finally {
        btn.disabled = false;
      }
    });

    note.addEventListener("input", () => {
        // Notiz SOFORT speichern
        currentObj[slot.key].note = note.value;
    });

    wrap.appendChild(head);
    head.appendChild(btn);
    wrap.appendChild(fileInput);
    wrap.appendChild(img);
    wrap.appendChild(note);
    container.appendChild(wrap);
  });
}

function getChecklistPayload() {
  return {
    damages: {
      value: String(intakeQDamages?.value || "no"),
      note: String(intakeQDamagesNote?.value || "").trim(),
    },
    smell: {
      value: String(intakeQSmell?.value || "no"), // intake-q-odors
      note: String(intakeQSmellNote?.value || "").trim(),
    },
    valuables: {
      value: String(intakeQValuables?.value || "no"),
      note: String(intakeQValuablesNote?.value || "").trim(),
    },
    warnings: {
      value: String(intakeQWarnings?.value || "no"),
      note: String(intakeQWarningsNote?.value || "").trim(),
    },
    wheels: {
      value: String(intakeQWheels?.value || "no"),
      note: String(intakeQWheelsNote?.value || "").trim(),
    },
    fuel: {
      value: String(intakeQFuel?.value || "unknown"),
      note: String(intakeQFuelNote?.value || "").trim(),
    },
    keys: {
      value: String(intakeQKeys?.value || "2"),
      note: String(intakeQKeysNote?.value || "").trim(),
    },
    accessories: {
      value: String(intakeQAccessories?.value || "no"),
      note: String(intakeQAccessoriesNote?.value || "").trim(),
    },
  };
}

let sigCtx = null;
let sigDrawing = false;
let sigLast = null;

function setupSignaturePad() {
  const canvas = document.getElementById("intake-signature-canvas");
  if (!canvas) return;
  
  // Wenn Canvas unsichtbar ist, abbrechen
  if (canvas.offsetWidth === 0) return;

  const ctx = canvas.getContext("2d");
  sigCtx = ctx;

  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  
  if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  const isDark = document.body.classList.contains('theme-dark');
  ctx.strokeStyle = isDark ? "#ffffff" : "rgba(17,24,39,0.95)";
  
  // Canvas leeren
  if (canvas.width > 0 && canvas.height > 0) {
      ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
  }

  // A) WIEDERHERSTELLEN (Falls schon unterschrieben wurde)
  if (intakeState.signature && intakeState.signature.jpeg_base64) {
      const img = new Image();
      img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = "data:image/jpeg;base64," + intakeState.signature.jpeg_base64;
  }
  
  let drawing = false;
  let lastPos = null;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches && e.touches[0];
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // B) HELPER: SOFORT SPEICHERN (Das hat gefehlt!)
  const saveToState = () => {
      // Temporäres Canvas mit weißem Hintergrund für JPG
      const w = canvas.width;
      const h = canvas.height;
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext("2d");
      tctx.fillStyle = "#ffffff";
      tctx.fillRect(0,0,w,h);
      tctx.drawImage(canvas, 0, 0);
      
      const dataUrl = tmp.toDataURL("image/jpeg", 0.8); 
      const b64 = dataUrl.split(",")[1];
      
      if(!intakeState.signature) intakeState.signature = {};
      intakeState.signature.jpeg_base64 = b64;
  };

  const start = (e) => {
      e.preventDefault();
      drawing = true;
      lastPos = getPos(e);
  };

  const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPos = p;
  };

  const end = (e) => {
      if(drawing) {
          drawing = false;
          saveToState(); // <--- HIER SPEICHERN WIR JETZT SOFORT!
      }
  };

  canvas.onmousedown = start;
  canvas.onmousemove = move;
  window.addEventListener("mouseup", end);
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = end;
}

function hasSignaturePixels() {
  if (!intakeSignatureCanvas) return false;
  // Sicherheitscheck
  if (intakeSignatureCanvas.width === 0 || intakeSignatureCanvas.height === 0) return false;

  const ctx = intakeSignatureCanvas.getContext("2d");
  try {
      const imgData = ctx.getImageData(0, 0, intakeSignatureCanvas.width, intakeSignatureCanvas.height);
      const d = imgData.data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] !== 0) return true;
      }
  } catch (e) {
      console.warn("Canvas Read Error:", e);
      return false;
  }
  return false;
}

async function signatureToJpegBase64() {
  if (!intakeSignatureCanvas) return "";
  const canvas = intakeSignatureCanvas;

  // FIX: Definiere eine Standard-Zielgröße (z.B. max 600px Breite)
  // Das verhindert, dass Retina-Displays das PDF sprengen.
  const maxWidth = 600; 
  const scale = maxWidth / canvas.width;
  
  const out = document.createElement("canvas");
  
  // Wenn der Original-Canvas kleiner als maxWidth ist, behalte Originalgröße
  if (canvas.width > maxWidth) {
    out.width = maxWidth;
    out.height = canvas.height * scale;
  } else {
    out.width = canvas.width;
    out.height = canvas.height;
  }

  const ctx = out.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, out.width, out.height);

  // Zeichne das Bild skaliert auf den neuen Canvas
  ctx.drawImage(canvas, 0, 0, out.width, out.height);

  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.8)); // 0.8 reicht oft völlig
  if (!blob) return "";

  const arr = await blob.arrayBuffer();
  const bytes = new Uint8Array(arr);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Globale Variable für die Suche merken
let allLoadedProtocols = [];

// Variable für Bookings-Cache, damit Namen zuordnen kann
let bookingsCache = {}; 

async function loadOrdersTab() {
  if (!currentUser) return;

  // DOM Elemente aus deinem HTML
  const searchInp = document.getElementById("intake-booking-search");
  const dropdown = document.getElementById("intake-booking-select");
  const startError = document.getElementById("intake-start-error");

  // 1. Bookings laden (Nur EINMAL laden für Cache UND Dropdown)
  // Wir holen '*', damit wir alle Infos für Dropdown und Cache haben
  const { data: bookings, error: bErr } = await supabaseClient
    .from("bookings")
    .select("*") 
    .eq("detailer_id", currentUser.id)
    .order("start_at", { ascending: false })
    .limit(200);

  if (bErr) {
     if (startError) startError.textContent = "Fehler beim Laden der Aufträge.";
  } else {
     if (startError) startError.textContent = "";
     
     // A) Globalen Cache aufbauen (für die Namens-Zuordnung in der Liste unten)
     bookingsCache = {};
     if (bookings) {
         bookings.forEach(b => { bookingsCache[b.id] = b; });
     }

     // B) Globale Liste für die Suche speichern
     allBookings = bookings || [];

     // C) Dropdown Logik mit Suche
     if (dropdown) {
        // Hilfsfunktion: Dropdown Optionen bauen basierend auf Suchtext
        const renderBookingOptions = (filterText = "") => {
             const lower = filterText.toLowerCase();
             
             // Filtern
             const filtered = allBookings.filter(b => {
                 if (!filterText) return true;
                 // Suche in Name, Auto und Datum
                 const searchStr = `${b.customer_name || ''} ${b.car || ''} ${b.start_at || ''}`.toLowerCase();
                 return searchStr.includes(lower);
             });

             // HTML bauen
             const optionsHTML = filtered.map(b => {
                 // Datum formatieren
                 let datePrefix = "";
                 if (b.start_at) {
                     const d = new Date(b.start_at);
                     datePrefix = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) + ": ";
                 }
                 
                 // Titel bauen (Fallback falls formatBookingTitle fehlt)
                 const title = (typeof formatBookingTitle === 'function') ? formatBookingTitle(b) : (b.customer_name || "Unbekannt");
                 
                 return `<option value="${b.id}">${datePrefix}${escapeHtml(title)}</option>`;
             }).join("");

             dropdown.innerHTML = `<option value="">Bitte wählen…</option>` + optionsHTML;
        };

        // Initial einmal rendern (alle anzeigen)
        renderBookingOptions();

        // Event Listener auf das Suchfeld legen
        if (searchInp) {
            // Alten Listener entfernen durch Klonen (Trick, um Doppel-Events zu vermeiden)
            const newSearchInp = searchInp.cloneNode(true);
            searchInp.parentNode.replaceChild(newSearchInp, searchInp);
            
            // Neuen Listener setzen: Bei Eingabe Dropdown filtern
            newSearchInp.oninput = (e) => renderBookingOptions(e.target.value);
            // Fokus behalten ist bei Text-Input automatisch
        }
     }
  }

  // 2. Suchfeld initialisieren (falls noch nicht da)
  if (ordersProtocolsList && !document.getElementById("protocol-search-input")) {
      const searchContainer = document.createElement("div");
      searchContainer.style.marginBottom = "15px";
      searchContainer.innerHTML = `
        <input type="text" id="protocol-search-input" placeholder="Suchen nach Name, Fahrzeug oder Datum..." class="field-input" style="width:100%;">
      `;
      ordersProtocolsList.parentNode.insertBefore(searchContainer, ordersProtocolsList);
      document.getElementById("protocol-search-input").addEventListener("input", (e) => {
          filterProtocols(e.target.value);
      });
  }

  // 3. Protokolle laden
  if (!ordersProtocolsList) return;
  ordersProtocolsList.innerHTML = '<p class="form-hint">Lade Protokolle...</p>';

  const { data: protos, error: pErr } = await supabaseClient
    .from("intake_protocols")
    .select("*")
    .eq("detailer_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (pErr) {
    ordersProtocolsList.innerHTML = "<p>Fehler beim Laden.</p>";
    return;
  }

  if (!protos || protos.length === 0) {
    ordersProtocolsList.innerHTML = "<p>Noch keine Annahmeprotokolle erstellt.</p>";
    allLoadedProtocols = [];
    return;
  }

  allLoadedProtocols = protos;
  renderProtocolList(allLoadedProtocols);
}

function renderProtocolList(protocols) {
  if (!ordersProtocolsList) return;
  ordersProtocolsList.innerHTML = "";

  if (protocols.length === 0) {
      ordersProtocolsList.innerHTML = "<p style='color:#666; font-size:0.9em;'>Keine Protokolle gefunden.</p>";
      return;
  }

  protocols.forEach((p) => {
    const row = document.createElement("div");
    row.className = "list-item";
    
    // -- NAMEN FINDEN --
    // 1. Schau im Booking-Cache nach (über booking_id)
    let customerName = "Unbekannt";
    let vehicleStr = "Fahrzeug";
    let emailStr = "";

    const linkedBooking = bookingsCache[p.booking_id];
    
    if (linkedBooking) {
        // Name aus Booking Tabelle bevorzugen
        customerName = linkedBooking.customer_name || linkedBooking.customer_email || "Kunde ohne Name";
        vehicleStr = linkedBooking.car || "Fahrzeug";
        emailStr = linkedBooking.customer_email || "";
    } else {
        // Fallback auf Daten im Protokoll selbst
        customerName = p.customer_name || p.customer_email || "Kunde (Gelöscht?)";
        // Fallback Fahrzeug aus JSON
        if (p.vehicle && typeof p.vehicle === 'object') {
             const mm = p.vehicle.make_model || "";
             const plate = p.vehicle.plate || "";
             if (mm || plate) vehicleStr = `${mm} ${plate}`.trim();
        }
    }

    // Datum
    const dateObj = new Date(p.created_at);
    const dateStr = dateObj.toLocaleDateString("de-DE", {day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute:"2-digit"});

    // Titelzeile
    const title = document.createElement("div");
    title.className = "list-item-title";
    title.style.fontWeight = "bold";
    title.textContent = `Protokoll: ${customerName}`;

    // Metazeile
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = `${vehicleStr} · ${dateStr}`;

    // PDF Button
    const actions = document.createElement("div");
    actions.style.marginTop = "8px";

    if (p.pdf_path) {
      const btnPdf = document.createElement("a");
      btnPdf.className = "btn btn-secondary btn-small";
      btnPdf.textContent = "PDF öffnen";
      btnPdf.target = "_blank";
      const { data } = supabaseClient.storage.from("intake").getPublicUrl(p.pdf_path);
      btnPdf.href = data.publicUrl;
      actions.appendChild(btnPdf);
    } else {
      // Wenn Pfad fehlt, aber Protokoll da ist -> oft Fehler im Worker-Rücklauf
      const span = document.createElement("span");
      span.style.fontSize = "12px";
      span.style.color = "#999";
      // Falls das Protokoll älter als 5 Min ist und immer noch kein PDF hat:
      const ageMinutes = (new Date() - dateObj) / 1000 / 60;
      if (ageMinutes > 5) {
          span.textContent = "(PDF nicht verfügbar)";
      } else {
          span.textContent = "PDF wird erstellt...";
      }
      actions.appendChild(span);
    }

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(actions);

    ordersProtocolsList.appendChild(row);
  });
}
// Filterfunktion
// Verbesserte Filterfunktion (Schritt 3)
function filterProtocols(searchTerm) {
    if (!searchTerm) {
        renderProtocolList(allLoadedProtocols);
        return;
    }
    const lower = searchTerm.toLowerCase().trim();
    
    const filtered = allLoadedProtocols.filter(p => {
        // 1. Name ermitteln (Fallback auf Cache, falls im Protokoll leer)
        let nameToSearch = p.customer_name || "";
        
        // Falls im Protokoll kein Name steht, schauen wir im globalen Booking-Cache nach
        if (!nameToSearch && p.booking_id && typeof bookingsCache !== 'undefined') {
            const linkedBooking = bookingsCache[p.booking_id];
            if (linkedBooking) nameToSearch = linkedBooking.customer_name || "";
        }

        // 2. Fahrzeug-String behandeln
        // Da 'vehicle' jetzt ein JSON-String in der DB ist (durch Step 1 & 2),
        // können wir ihn einfach direkt durchsuchen.
        let vehicleStr = "";
        if (p.vehicle) {
            if (typeof p.vehicle === 'string') {
                vehicleStr = p.vehicle;
            } else if (typeof p.vehicle === 'object') {
                // Falls es doch mal als Objekt kommt
                vehicleStr = JSON.stringify(p.vehicle);
            }
        }

        const email = (p.customer_email || "").toLowerCase();
        
        // Datum formatieren für Suche (z.B. "17.01.2026")
        const dateObj = new Date(p.created_at);
        const dateStr = dateObj.toLocaleDateString("de-DE", {
            day: "2-digit", month: "2-digit", year: "numeric"
        });

        // Alles zu einem langen Such-String zusammenfügen
        const combinedData = [
            nameToSearch,
            email,
            vehicleStr, // Findet z.B. "Audi" im JSON-String '{"brand":"Audi"...}'
            dateStr,
            p.booking_id || ""
        ].join(" ").toLowerCase();

        return combinedData.includes(lower);
    });
    
    renderProtocolList(filtered);
}

function intakeFail(step, msg) {
  const errEl = document.getElementById("intake-final-error");
  if (errEl) errEl.textContent = msg;
  setIntakeStep(step);
  throw new Error(msg);
}

function validateIntakeBeforeSubmit() {
  // Step 1
  if (!String(intakeDocDate?.value || "").trim()) intakeFail(1, "Datum fehlt.");
  
  // Step 2
  if (!String(intakeVehicleMakeModel?.value || "").trim()) intakeFail(2, "Fahrzeug (Marke & Modell) fehlt.");
  if (!String(intakeVehiclePlate?.value || "").trim()) intakeFail(2, "Kennzeichen fehlt.");

  // Step 3
  const vDamages = String(intakeQDamages?.value || "");
  const vOdors = String(intakeQSmell?.value || "");
  const vVal = String(intakeQValuables?.value || "");

  if (!vDamages) intakeFail(3, "Bitte bei 'Sichtbare Schäden' Ja/Nein auswählen.");
  if (!vOdors) intakeFail(3, "Bitte bei 'Gerüche' Ja/Nein auswählen.");
  if (!vVal) intakeFail(3, "Bitte bei 'Wertgegenstände' Ja/Nein auswählen.");
  
  if (!String(intakeState.fuel_level || "").trim()) intakeFail(3, "Bitte Tankstand auswählen.");

  // Step 6 Legal & Sig
  // Alle 3 Checkboxen müssen an sein
  if (!intakeLegalHandover?.checked) intakeFail(6, "Bitte 'Übergabe im dokumentierten Zustand' bestätigen.");
  if (!intakeLegalNote?.checked) intakeFail(6, "Bitte bestätigen, dass Verschmutzungen Schäden verdecken können.");
  if (!intakeLegalAgb?.checked) intakeFail(6, "Bitte AGB akzeptieren.");

  if (!intakeState.signature.jpeg_base64) intakeFail(6, "Unterschrift fehlt.");

  // Email
  const sendEmailValue = String(intakeSendEmail?.value || "no").toLowerCase();
  if (sendEmailValue === "yes") {
    const mail = String(intakeCustomerEmail?.value || "").trim();
    if (!mail) intakeFail(6, "E-Mail Adresse fehlt.");
  }
}

async function saveIntakeProtocol() {
  const errEl = document.getElementById("intake-final-error");
  if (errEl) errEl.textContent = "";

  // 1. Unterschrift JETZT aus dem Canvas holen
  if (typeof signatureToJpegBase64 === "function") {
      intakeState.signature.jpeg_base64 = await signatureToJpegBase64();
  }

  // 2. Validierung
  try {
      validateIntakeBeforeSubmit();
  } catch (e) {
      if (errEl) {
          errEl.textContent = e.message;
          errEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return; 
  }

  // Inputs lesen
  intakeState.doc_date = String(intakeDocDate?.value || "").trim();
  intakeState.doc_time = String(document.getElementById("intake-doc-time")?.value || "").trim();
  intakeState.customer_note = String(intakeCustomerNote?.value || "").trim();
  intakeState.internal_note = String(intakeInternalNote?.value || "").trim();
  
  intakeState.customer_name = currentIntakeBooking ? currentIntakeBooking.customer_name : "";

  intakeState.vehicle = intakeState.vehicle || {};
  intakeState.vehicle.make_model = String(intakeVehicleMakeModel?.value || "").trim();
  intakeState.vehicle.plate = String(intakeVehiclePlate?.value || "").trim();
  intakeState.vehicle.vin = String(intakeVehicleVin?.value || "").trim();
  intakeState.vehicle.year = String(intakeVehicleYear?.value || "").trim();
  intakeState.vehicle.mileage = String(intakeVehicleMileage?.value || "").trim();

  if (intakeState.fuel_level && /^\d+$/.test(intakeState.fuel_level)) {
      intakeState.fuel_level += "%";
  }

  intakeState.checklist = getChecklistPayload();
  intakeState.legal = intakeState.legal || {};
  intakeState.legal.handover = !!intakeLegalHandover?.checked;
  intakeState.legal.agb = !!intakeLegalAgb?.checked;
  intakeState.legal.note = !!intakeLegalNote?.checked;

  const sendEmailValue = String(intakeSendEmail?.value || "no").toLowerCase();
  intakeState.send_email = sendEmailValue === "yes";
  intakeState.customer_email = String(intakeCustomerEmail?.value || "").trim();

  // --- ANIMATION START ---
  const btn = document.getElementById("intake-finish");
  let animInterval = null;
  if (btn) {
      btn.disabled = true;
      let dots = 0;
      btn.textContent = "Speichere";
      animInterval = setInterval(() => {
          dots = (dots + 1) % 4;
          btn.textContent = "Speichere" + ".".repeat(dots);
          if (intakeStatus) intakeStatus.textContent = "Verarbeite Daten" + ".".repeat(dots);
      }, 500);
  }
  // -----------------------

  try {
      // 3. PDF bauen
      const pdfBytes = await buildIntakePdf(intakeState);
      
      const pdfBase64 = await new Promise((resolve) => {
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const reader = new FileReader();
          reader.onloadend = () => {
              const dataUrl = reader.result;
              const base64 = dataUrl.split(',')[1];
              resolve(base64);
          };
          reader.readAsDataURL(blob);
      });

      // 4. Client-Side Upload
      if (intakeStatus) intakeStatus.textContent = "Lade PDF hoch...";
      
      const uid = currentUser?.id;
      const bid = intakeState.booking_id;
      const ts = Date.now();
      const pdfPath = `${uid}/${bid}/protocol_${ts}.pdf`;
      const pdfFile = new Blob([pdfBytes], { type: "application/pdf" });

      const { error: uploadErr } = await supabaseClient.storage
        .from(INTAKE_BUCKET)
        .upload(pdfPath, pdfFile, { upsert: true, contentType: "application/pdf" });

      if (uploadErr) {
          console.warn("Client Upload Failed, Worker Fallback.", uploadErr);
      }

      // 5. Worker aufrufen
      if (intakeStatus) intakeStatus.textContent = "Speichere Protokoll...";

      const payload = {
        detailer_id: currentUser.id,
        booking_id: intakeState.booking_id,
        customer_name: intakeState.customer_name,
        doc_date: intakeState.doc_date,
        customer_note: intakeState.customer_note,
        internal_note: intakeState.internal_note,
        vehicle: intakeState.vehicle,
        checklist: intakeState.checklist,
        exterior: intakeState.exterior,
        interior: intakeState.interior,
        legal: intakeState.legal,
        signature_jpeg_base64: intakeState.signature.jpeg_base64,
        send_email: intakeState.send_email,
        customer_email: intakeState.customer_email,
        fuel_level: intakeState.fuel_level || null,
        pdf_base64: pdfBase64,
        pdf_path: (!uploadErr) ? pdfPath : null 
      };

      const session = await supabaseClient.auth.getSession();
      const token = session?.data?.session?.access_token;

      const res = await fetch(`${WORKER_API_BASE}/intake/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Fehler beim Speichern (Worker).");
      }
      
      // Update Pfad falls Worker es nicht getan hat
      if (!uploadErr && data.id) {
           await supabaseClient
            .from("intake_protocols")
            .update({ pdf_path: pdfPath, customer_name: intakeState.customer_name })
            .eq("id", data.id);
      }

      if (intakeStatus) intakeStatus.textContent = "Fertig!";
      closeIntakeModal();
      await loadOrdersTab();

  } catch (err) {
      console.error("Intake save failed:", err);
      const msg = err.message || "Fehler";
      if (intakeStatus) intakeStatus.textContent = msg;
      if (errEl) errEl.textContent = msg;
  } finally {
      if (animInterval) clearInterval(animInterval);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Abschließen";
      }
  }
}

function wireIntakeEvents() {
  if (intakeCloseButton) intakeCloseButton.addEventListener("click", closeIntakeModal);

  if (intakeModal) {
    intakeModal.addEventListener("click", (e) => {
      if (e.target === intakeModal || e.target.classList.contains("profile-modal-backdrop")) {
        closeIntakeModal();
      }
    });
  }

if (intakeSendEmail && intakeEmailRow) {
  const syncEmailRow = () => {
    const v = String(intakeSendEmail.value || "no").toLowerCase();
    intakeEmailRow.style.display = (v === "yes") ? "block" : "none";
  };
  intakeSendEmail.addEventListener("change", syncEmailRow);
  syncEmailRow();
}

  if (intakeSignatureClear) {
    intakeSignatureClear.addEventListener("click", () => {
      if (!intakeSignatureCanvas) return;
      const ctx = intakeSignatureCanvas.getContext("2d");
      ctx.clearRect(0, 0, intakeSignatureCanvas.width, intakeSignatureCanvas.height);
    });
  }

  const intakeSignatureApply = document.getElementById("intake-signature-apply"); // ID aus deinem HTML prüfen!
  if (intakeSignatureApply) {
      intakeSignatureApply.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation(); // Verhindert Submit
          
          if (typeof hasSignaturePixels === "function" && hasSignaturePixels()) {
             // Visuelles Feedback
             intakeSignatureApply.textContent = "Unterschrift erfasst ✓";
             intakeSignatureApply.classList.remove("btn-secondary");
             intakeSignatureApply.classList.add("btn-primary");
             setTimeout(() => {
                 intakeSignatureApply.textContent = "Übernehmen";
                 intakeSignatureApply.classList.remove("btn-primary");
                 intakeSignatureApply.classList.add("btn-secondary");
             }, 2000);
          } else {
             alert("Bitte erst unterschreiben.");
          }
      });
  }

  if (intakeNext1) intakeNext1.addEventListener("click", () => setIntakeStep(2));
  if (intakeBack2) intakeBack2.addEventListener("click", () => setIntakeStep(1));
  if (intakeNext2) intakeNext2.addEventListener("click", () => setIntakeStep(3));
  if (intakeBack3) intakeBack3.addEventListener("click", () => setIntakeStep(2));
  if (intakeNext3) intakeNext3.addEventListener("click", () => setIntakeStep(4));
  if (intakeBack4) intakeBack4.addEventListener("click", () => setIntakeStep(3));
  if (intakeNext4) intakeNext4.addEventListener("click", () => setIntakeStep(5));
  if (intakeBack5) intakeBack5.addEventListener("click", () => setIntakeStep(4));
  if (intakeNext5) intakeNext5.addEventListener("click", () => setIntakeStep(6));
  if (intakeBack6) intakeBack6.addEventListener("click", () => setIntakeStep(5));

  if (intakeForm) {
    intakeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (intakeStatus) intakeStatus.textContent = "";
      try {
        const btn = document.getElementById("intake-finish");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Speichern...";
        }
        await saveIntakeProtocol();
}
catch (err) {
  console.error("Intake save failed:", err);

  const msg =
    (err && err.message) ? String(err.message) : "Unbekannter Fehler beim Abschließen";

  if (intakeStatus) intakeStatus.textContent = `Fehler: ${msg}`;

  const errEl = document.getElementById("intake-final-error");
  if (errEl) errEl.textContent = msg;
}
finally {
  const btn = document.getElementById("intake-finish");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Abschließen";
  }
}
    });
  }

  if (bookingDetailIntakeButton) {
    bookingDetailIntakeButton.addEventListener("click", () => {
      if (!currentDetailBooking) return;
      closeBookingDetail();
      openIntakeModalForBooking(currentDetailBooking);
    });
  }

  if (ordersNewIntakeButton) {
    ordersNewIntakeButton.addEventListener("click", async () => {
      // Convenience: Wenn genau 1 offener Auftrag existiert, direkt starten.
      if (!currentUser) return;
      const { data: bookings } = await supabaseClient
        .from("bookings")
        .select("*")
        .eq("detailer_id", currentUser.id)
        .order("start_at", { ascending: false })
        .limit(1);
      const b = bookings && bookings[0];
      if (b) openIntakeModalForBooking(b);
    });
  }
}
if (intakeOpenButton) {
  intakeOpenButton.addEventListener("click", () => {
    const bookingId = intakeBookingSelect?.value;
    if (!bookingId) return;

    const booking = allBookings.find(b => b.id === bookingId);
    if (!booking) return;

    openIntakeModalForBooking(booking);
  });
}

wireIntakeEvents();

// Hilfsfunktion (falls noch nicht vorhanden)
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

function renderIntakePhotoPoints(containerId, points, scope) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = ""; // Reset UI

  points.forEach((label, index) => {
    // 1. UI Elemente erstellen
    const wrapper = document.createElement("div");
    wrapper.className = "glass"; 
    wrapper.style.padding = "10px";
    wrapper.style.marginBottom = "10px";

    const title = document.createElement("strong");
    title.textContent = label;
    wrapper.appendChild(title);

    // File Input
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "field-input";
    fileInput.style.marginTop = "5px";

    // Status Anzeige (Ob Bild schon da ist)
    const statusTxt = document.createElement("span");
    statusTxt.style.fontSize = "12px";
    statusTxt.style.marginLeft = "10px";
    
    // Notiz Input
    const noteInput = document.createElement("textarea");
    noteInput.className = "field-input";
    noteInput.rows = 2;
    noteInput.placeholder = "Notiz (optional)";
    noteInput.style.marginTop = "5px";

    // 2. WIEDERHERSTELLEN aus State (Falls User zurück navigiert hat)
    // scope ist 'exterior' oder 'interior'
    const savedItem = intakeState[scope][index];
    
    if (savedItem && savedItem.base64) {
        statusTxt.textContent = "Gespeichert";
        statusTxt.style.color = "green";
    }
    if (savedItem && savedItem.note) {
        noteInput.value = savedItem.note;
    }

    // 3. EVENT LISTENER (Sofort speichern)
    
    // Bild speichern
fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
        statusTxt.textContent = "Lädt hoch...";
        statusTxt.style.color = "orange";
        try {
            // 1. Komprimieren
            const compressedBlob = await compressImage(file);
            
            // 2. Sofort-Upload in den Supabase Storage (Pfad bauen)
            const uid = currentUser?.id;
            const bid = intakeState.booking_id || "draft";
            const ts = Date.now();
            const fileName = `${scope}_${index}_${ts}.jpg`;
            const path = `${uid}/${bid}/${fileName}`;

            // Nutze deine vorhandene upload-Funktion oder diesen Shortcut:
            const { error: uploadError } = await supabaseClient.storage
                .from("intake")
                .upload(path, compressedBlob);

            if (uploadError) throw uploadError;

            // 3. Öffentliche URL holen
            const { data: urlData } = supabaseClient.storage.from("intake").getPublicUrl(path);
            const publicUrl = urlData.publicUrl;

            // 4. NUR die URL und den Pfad im State speichern (NICHT das ganze Bild!)
            if (!intakeState[scope][index]) intakeState[scope][index] = { label: label };
            
            intakeState[scope][index].base64 = publicUrl;
            intakeState[scope][index].url = publicUrl;
            intakeState[scope][index].path = path;
            
            statusTxt.textContent = "Gespeichert";
            statusTxt.style.color = "green";
        } catch (err) {
            console.error("Upload failed:", err);
            statusTxt.textContent = "Fehler!";
            statusTxt.style.color = "red";
        }
    }
});
    // Notiz speichern
    noteInput.addEventListener("input", (e) => {
        if (!intakeState[scope][index]) intakeState[scope][index] = { label: label };
        intakeState[scope][index].note = e.target.value;
    });

    wrapper.appendChild(fileInput);
    wrapper.appendChild(statusTxt);
    wrapper.appendChild(noteInput);
    container.appendChild(wrapper);
  });
}

function buildReviewMessage(booking) {
  const link =
    (currentProfile && currentProfile.review_link) ||
    (settingsReviewLinkInput
      ? settingsReviewLinkInput.value.trim()
      : "");

  const linkPart = link ? ` ${link}` : "";
  return `Ich würde mich sehr über eine positive Bewertung freuen. Link dazu:${linkPart}`;
}

function openReviewModal(booking) {
  if (!reviewModal || !reviewModalText) return;
  currentReviewBooking = booking || null;

  reviewModalText.textContent = buildReviewMessage(booking);
  reviewModal.classList.remove("hidden");
}

function closeReviewModal() {
  if (!reviewModal) return;
  reviewModal.classList.add("hidden");
  currentReviewBooking = null;
}

function setupReviewModalHandlers() {
  if (!reviewModal) return;

  if (reviewModalClose) {
    reviewModalClose.addEventListener("click", () => {
      closeReviewModal();
    });
  }

  reviewModal.addEventListener("click", (e) => {
    if (
      e.target === reviewModal ||
      e.target.classList.contains("profile-modal-backdrop")
    ) {
      closeReviewModal();
    }
  });

  if (reviewModalCopyButton && reviewModalText) {
    reviewModalCopyButton.addEventListener("click", async () => {
      const txt = reviewModalText.textContent || "";
      try {
        if (navigator.clipboard && txt) {
          await navigator.clipboard.writeText(txt);
          alert("Text in die Zwischenablage kopiert.");
        }
      } catch (err) {
        console.error("Clipboard Fehler:", err);
      }
    });
  }

  if (reviewModalDoneButton) {
    reviewModalDoneButton.addEventListener("click", async () => {
      if (!currentUser || !supabaseClient || !currentReviewBooking) {
        closeReviewModal();
        return;
      }

      let items = Array.isArray(currentReviewBooking.items)
        ? [...currentReviewBooking.items]
        : [];

      items = items.filter((it) => it && it.role !== "review_done");
      items.push({
        role: "review_done",
        completed_at: new Date().toISOString(),
      });

      const { error } = await supabaseClient
        .from("bookings")
        .update({ items })
        .eq("id", currentReviewBooking.id)
        .eq("detailer_id", currentUser.id);

      if (error) {
        console.error("DetailHQ: review_done update failed:", error);
      }

      delete reviewReminderState[currentReviewBooking.id];
      saveReviewReminderState();

      closeReviewModal();
      await loadBookingsForDashboardAndSchedule();
    });
  }
}

async function buildIntakePdf(intake) {
  const { PDFDocument, StandardFonts, rgb } = await import(
    "https://cdn.skypack.dev/pdf-lib@1.17.1"
  );

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // --- DEFINITIONEN DER LABELS (Damit sie immer da stehen) ---
  const EXT_LABELS = [
    "Vorne Links", "Vorne Rechts", "Motorhaube", 
    "Windschutzscheibe", "Fahrzeugseite Links", 
    "Fahrzeugseite Rechts", "Dach", "Heck"
  ];
  const INT_LABELS = [
    "Amaturenbrett links", "Armaturenbrett rechts", 
    "Fahrersitz", "Beifahrersitz", 
    "Rückbank", "Kofferraum"
  ];

  // --- SEITE 1: ÜBERSICHT ---
  let page = pdf.addPage([595, 842]); 
  const { width, height } = page.getSize();
  const colorPrimary = rgb(0.1, 0.15, 0.25);
  const colorBg = rgb(0.96, 0.96, 0.97);
  const colorText = rgb(0.2, 0.2, 0.2);
  const colorLightText = rgb(0.5, 0.5, 0.5);

  let y = height;

  // Header
  page.drawRectangle({ x: 0, y: height - 100, width: width, height: 100, color: colorPrimary });
  page.drawText("ANNAHMEPROTOKOLL", { x: 50, y: height - 55, size: 24, font: fontBold, color: rgb(1, 1, 1) });

  const dateStr = intake.doc_date 
    ? new Date(intake.doc_date).toLocaleDateString("de-DE") 
    : new Date().toLocaleDateString("de-DE");

  // NEU: Zeit anhängen falls vorhanden
  const timeStr = intake.doc_time ? `, ${intake.doc_time} Uhr` : "";

  // x angepasst 
  page.drawText(`Datum: ${dateStr}${timeStr}`, { 
      x: width - 200, 
      y: height - 55, 
      size: 12, 
      font, 
      color: rgb(0.8, 0.8, 0.8) 
  });

  y = height - 140;

  // Helpers
  const drawLabelValue = (label, value, xPos, yPos) => {
      page.drawText(label, { x: xPos, y: yPos, size: 9, font: fontBold, color: colorLightText });
      page.drawText(value || "-", { x: xPos, y: yPos - 14, size: 11, font, color: colorText });
  };
  const drawSectionTitle = (title, yPos) => {
      page.drawText(title.toUpperCase(), { x: 50, y: yPos, size: 10, font: fontBold, color: colorPrimary, letterSpacing: 1 });
      page.drawLine({ start: { x: 50, y: yPos - 5 }, end: { x: width - 50, y: yPos - 5 }, thickness: 1, color: rgb(0.9, 0.9, 0.9) });
  };

  // 1. KUNDE & FAHRZEUG
  drawSectionTitle("Fahrzeug & Kunde", y);
  y -= 30;
  page.drawRectangle({ x: 50, y: y - 90, width: width - 100, height: 100, color: colorBg, opacity: 0.5 });
  
  const v = intake.vehicle || {};
  const customerName = intake.customer_name || intake.customer_email || "Gast";
  drawLabelValue("Kunde", customerName, 70, y - 25);
  drawLabelValue("Fahrzeug", v.make_model, 250, y - 25);
  drawLabelValue("Kennzeichen", v.plate, 430, y - 25);
  drawLabelValue("FIN / VIN", v.vin, 70, y - 70);
  drawLabelValue("Kilometerstand", v.mileage ? `${v.mileage} km` : "-", 250, y - 70);
  let fuelStr = intake.fuel_level || "-";
  if (fuelStr !== "-" && !fuelStr.includes("%") && /^\d+$/.test(fuelStr)) fuelStr += "%";
  drawLabelValue("Tankfüllstand", fuelStr, 430, y - 70);
  y -= 130;

  // 2. CHECKLISTE (Angepasst: Status rechts, Notiz unten drunter)
  drawSectionTitle("Zustands-Checkliste", y);
  y -= 25;
  const cl = intake.checklist || {};
  const checkItems = [
      { l: "Sichtbare Schäden", v: cl.damages },
      { l: "Gerüche (Rauch/Tier)", v: cl.smell },
      { l: "Wertgegenstände", v: cl.valuables },
  ];
  
  // Header Zeile
  page.drawText("Punkt", { x: 60, y, size: 9, font: fontBold, color: colorLightText });
  page.drawText("Status", { x: 450, y, size: 9, font: fontBold, color: colorLightText }); // Status weit rechts
  
  y -= 25; 

  checkItems.forEach((item, index) => {
      if (index % 2 === 0) page.drawRectangle({ x: 50, y: y - 4, width: width - 100, height: 20, color: colorBg });
      let val = item.v?.value || "-";
      let displayVal = val;
      let valColor = colorText;
      if(val === "yes") { displayVal = "JA"; valColor = rgb(0.8, 0, 0); }
      if(val === "no") { displayVal = "Nein"; valColor = rgb(0, 0.5, 0); }
      
      page.drawText(item.l, { x: 60, y: y + 2, size: 10, font, color: colorText });
      page.drawText(displayVal, { x: 450, y: y + 2, size: 10, font: fontBold, color: valColor });
      y -= 20;
  });

  // Zusatznotiz der Checkliste (falls vorhanden)
  if (cl.notes) {
      y -= 10;
      page.drawText("Notiz zur Checkliste:", { x: 60, y, size: 9, font: fontBold, color: colorLightText });
      y -= 12;
      page.drawText(cl.notes, { x: 60, y, size: 10, font, color: colorText, maxWidth: 480 });
      y -= 15;
  }
  
  y -= 20;

  // Allgemeine Kunden-Notizen (Step 1)
  if (intake.customer_note) {
      page.drawText("Weitere Anmerkungen:", { x: 50, y, size: 10, font: fontBold });
      y -= 15;
      const noteText = intake.customer_note;
      page.drawText(noteText, { x: 50, y, size: 10, font, maxWidth: 500, lineHeight: 14, color: colorText });
      y -= 30;
  }
  y -= 20;

  // 3. RECHTLICHES & UNTERSCHRIFT
  if (y < 250) { page = pdf.addPage([595, 842]); y = 750; }
  drawSectionTitle("Rechtliche Hinweise & Übergabe", y);
  y -= 30;
  const legalText = [
      intake.legal?.handover ? "[x] Übergabe im dokumentierten Zustand bestätigt." : "[ ] Übergabe bestätigt.",
      intake.legal?.note ? "[x] Verschmutzungen können Schäden verdecken." : "[ ] Verschmutzungshinweis akzeptiert.",
      intake.legal?.agb ? "[x] AGB und Datenschutz akzeptiert." : "[ ] AGB akzeptiert."
  ];
  legalText.forEach(line => {
      page.drawText(line, { x: 50, y, size: 9, font, color: colorLightText });
      y -= 14;
  });
  y -= 40;

// --- UNTERSCHRIFT IM GRID-STYLE ---
const sigBase64 = intake.signature?.jpeg_base64 || intake.signature_jpeg_base64;

// Wir definieren eine Box wie im Foto-Grid
const boxW = 230; 
const boxH = 150; 
const boxX = 50;  
const boxY = y - boxH - 10; 

// 1. Den Kasten zeichnen (Identisch zu addPhotoPage)
page.drawRectangle({
    x: boxX, 
    y: boxY, 
    width: boxW, 
    height: boxH,
    color: rgb(0.98, 0.98, 0.98), 
    borderColor: rgb(0.8, 0.8, 0.8), 
    borderWidth: 0.25, 
});

// 2. Label oben in der Box
page.drawText("UNTERSCHRIFT KUNDE", {
    x: boxX + 5, 
    y: boxY + boxH - 15, 
    size: 9, 
    font: fontBold, 
    color: rgb(0.3, 0.3, 0.3),
});

// 3. Bild in die Box einpassen
if (sigBase64) {
    try {
        const sigData = sigBase64.split(',')[1] || sigBase64;
        const sigBytes = Uint8Array.from(atob(sigData), c => c.charCodeAt(0));
        const sigImage = await pdf.embedJpg(sigBytes);

        // FIX: Wir nutzen die Box-Maße als Limit für scaleToFit
        const dims = sigImage.scaleToFit(boxW - 20, boxH - 40); 

        // Mittig in der Box platzieren
        const centerX = boxX + (boxW / 2) - (dims.width / 2);
        const centerY = boxY + (boxH / 2) - (dims.height / 2) - 5; // -5 für optischen Ausgleich zum Label

        page.drawImage(sigImage, {
            x: centerX,
            y: centerY,
            width: dims.width,
            height: dims.height
        });
    } catch (e) {
        console.error("Sig Error:", e);
        page.drawText("Fehler beim Laden", { x: boxX + 10, y: boxY + 40, size: 9, font, color: rgb(1, 0, 0) });
    }
} else {
    // Falls keine Unterschrift da ist
    page.drawText("Nicht digital erfasst", { x: boxX + 10, y: boxY + 40, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
}

// Y-Position für nachfolgenden Inhalt aktualisieren
y = boxY - 30;
  
  // --- SEITE 2: AUSSEN (GRID 8 Felder) ---
  await addPhotoPage(pdf, font, fontBold, "Außenbereich (Exterior)", intake.exterior, EXT_LABELS);

  // --- SEITE 3: INNEN (GRID 6 Felder) ---
  await addPhotoPage(pdf, font, fontBold, "Innenraum (Interior)", intake.interior, INT_LABELS);

  // Footer
  const pages = pdf.getPages();
  pages.forEach(p => {
      const { width } = p.getSize();
      p.drawText("Erstellt mit DetailHQ", { x: width / 2 - 40, y: 20, size: 8, font: font, color: rgb(0.7, 0.7, 0.7) });
  });

  return await pdf.save();
}

async function addPhotoPage(pdf, font, fontBold, title, photoArray, labelDefinitions) {
    if (!Array.isArray(photoArray)) photoArray = [];
    
    const { rgb } = await import("https://cdn.skypack.dev/pdf-lib@1.17.1");

    // --- 1. PARALLELER DOWNLOAD (Der Speed-Fix) ---
    const loadedImages = await Promise.all(photoArray.map(async (item) => {
        if (!item || (!item.base64 && !item.url)) return null;
        try {
            const imageSource = item.url || item.base64;
            let imgBytes;

            if (imageSource.startsWith('http')) {
                const resp = await fetch(imageSource);
                if (!resp.ok) throw new Error("Fetch failed");
                const buffer = await resp.arrayBuffer();
                imgBytes = new Uint8Array(buffer);
            } else {
                const dataStr = imageSource.split(',')[1] || imageSource;
                const binaryStr = atob(dataStr);
                imgBytes = new Uint8Array(binaryStr.length);
                for (let k = 0; k < binaryStr.length; k++) imgBytes[k] = binaryStr.charCodeAt(k);
            }
            return { bytes: imgBytes, source: imageSource, note: item.note };
        } catch (e) {
            return { error: true };
        }
    }));

    let page = pdf.addPage([595, 842]);
    const { width, height } = page.getSize();
    
    // Header
    let y = height - 50;
    page.drawText(title.toUpperCase(), { x: 50, y, size: 14, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
    y -= 15;

    // --- GRID KONFIGURATION ---
    const colCount = 2;
    const boxW = 230; 
    const boxH = 175; // Etwas höher für mehr Text-Platz
    const gapX = 35; 
    const gapY = 15;  // Kleinerer Abstand zwischen Boxen
    
    // Hilfsfunktion: Text in Zeilen umbrechen
    const breakText = (text, maxWidth, fontSize, fontObj) => {
        if (!text) return [];
        const words = text.split(' ');
        let lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = fontObj.widthOfTextAtSize(currentLine + " " + word, fontSize);
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    };

    for (let i = 0; i < labelDefinitions.length; i++) {
        const row = Math.floor(i / colCount);
        const col = i % colCount;

        // Basis-Koordinaten (Box unten links)
        const boxX = 50 + (col * (boxW + gapX));
        const boxY = y - (row * (boxH + gapY)) - boxH; 

        // 1. Kasten Zeichnen
        page.drawRectangle({
            x: boxX, y: boxY, width: boxW, height: boxH,
            color: rgb(0.98, 0.98, 0.98), 
            borderColor: rgb(0.8, 0.8, 0.8), 
            borderWidth: 0.25, 
        });

        // 2. Label (Ganz oben im Kasten)
        const labelText = labelDefinitions[i];
        page.drawText(labelText, {
            x: boxX + 5, y: boxY + boxH - 15, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3),
        });

        // --- 3. Bild verarbeiten (Nutzt die Daten aus dem parallelen Download) ---
        const loadedImg = loadedImages[i];
        const item = photoArray[i];

        if (loadedImg && !loadedImg.error && loadedImg.bytes) {
            try {
                let imgEmbed;
                const isPng = loadedImg.source.toLowerCase().includes("image/png") || (loadedImg.bytes[0] === 0x89 && loadedImg.bytes[1] === 0x50);
                
                if (isPng) {
                    imgEmbed = await pdf.embedPng(loadedImg.bytes);
                } else {
                    imgEmbed = await pdf.embedJpg(loadedImg.bytes);
                }

                const dims = imgEmbed.scaleToFit(boxW - 10, 105); 

                const centerX = boxX + (boxW / 2) - (dims.width / 2);
                const imgTopY = boxY + boxH - 22; 
                const finalY = imgTopY - dims.height;

                page.drawImage(imgEmbed, {
                    x: centerX, 
                    y: finalY, 
                    width: dims.width, 
                    height: dims.height
                });

            } catch (err) {
                console.error("Bildfehler bei " + labelText + ":", err);
                page.drawText("Bild konnte nicht geladen werden", { x: boxX + 10, y: boxY + 100, size: 8, font, color: rgb(0.8,0,0) });
            }
        } else if (loadedImg && loadedImg.error) {
             page.drawText("Downloadfehler", { x: boxX + 10, y: boxY + 100, size: 9, font, color: rgb(0.8, 0, 0) });
        } else {
            page.drawText("Kein Foto", {
                x: boxX + (boxW / 2) - 20, 
                y: boxY + 100, 
                size: 9, 
                font, 
                color: rgb(0.8, 0.8, 0.8)
            });
        }

        // 4. Notiz (Ganz unten, mit Zeilenumbruch)
        if (item && item.note) {
            const fontSize = 8;
            const lines = breakText(item.note, boxW - 10, fontSize, font);
            
            let textCursorY = boxY + 40; 
            const maxLines = 4;
            
            lines.slice(0, maxLines).forEach((line) => {
                page.drawText(line, {
                    x: boxX + 5,
                    y: textCursorY,
                    size: fontSize,
                    font: font,
                    color: rgb(0.3, 0.3, 0.3),
                });
                textCursorY -= 10; 
            });
        }
    }
}

function setupBookingDetailHandlers() {
  if (!bookingDetailModal) return;

  if (bookingDetailCloseButton) {
    bookingDetailCloseButton.addEventListener("click", () => {
      closeBookingDetailModal();
    });
  }

  if (bookingDetailPaymentStatusSelect) {
    bookingDetailPaymentStatusSelect.addEventListener("change", () => {
      updatePaymentFieldsVisibility();
    });
  }

  bookingDetailModal.addEventListener("click", (e) => {
    if (
      e.target === bookingDetailModal ||
      e.target.classList.contains("profile-modal-backdrop")
    ) {
      closeBookingDetailModal();
    }
  });

  // Änderungen speichern
  if (bookingDetailSaveButton) {
    bookingDetailSaveButton.addEventListener("click", async () => {
      if (!currentUser || !supabaseClient || !currentDetailBooking) return;

      const patch = {
        notes: bookingDetailNotes ? bookingDetailNotes.value.trim() : null,
      };

      // Auftragsstatus
      let jobStatus = currentDetailBooking.job_status || "planned";
      if (bookingDetailJobStatusSelect) {
        jobStatus = bookingDetailJobStatusSelect.value || "planned";
      }
      patch.job_status = jobStatus;

      // Zahlungsstatus
      let paymentStatus = currentDetailBooking.payment_status || "open";
      if (bookingDetailPaymentStatusSelect) {
        paymentStatus = bookingDetailPaymentStatusSelect.value || "open";
      }
      patch.payment_status = paymentStatus;

      // Basis für Items
      let items = Array.isArray(currentDetailBooking.items)
        ? [...currentDetailBooking.items]
        : [];

      // Alte Service-/Klassen-/Payment-Items rauswerfen
      items = items.filter(
        (it) =>
          it &&
          it.role !== "package" &&
          it.role !== "single" &&
          it.role !== "vehicle_price_adjustment" &&
          it.role !== "payment_partial" &&
          it.role !== "payment_final_override"
      );

      // ==============================
      // Services + Preis & Dauer neu berechnen
      // ==============================
      const getServiceById = (id) =>
        (services || []).find((s) => String(s.id) === String(id));

      let totalBasePriceCents = 0;
      let totalMinutes = 0;
      let mainServiceName = null;

      // Paket (Detail-Select)
      let mainServiceId = null;
      if (bookingDetailMainServiceSelect) {
        const v = bookingDetailMainServiceSelect.value;
        mainServiceId = v ? v : null;
      }

      if (mainServiceId) {
        const main = getServiceById(mainServiceId);
        if (main) {
          mainServiceName = main.name;
          const basePrice = main.base_price_cents || 0;
          const baseDur = main.duration_minutes || 0;

          items.push({
            role: "package",
            service_id: main.id,
            name: main.name,
            base_price_cents: basePrice,
            price_cents: basePrice,
            base_duration_minutes: baseDur,
            duration_minutes: baseDur,
          });

          totalBasePriceCents += basePrice;
          totalMinutes += baseDur;
        }
      }

      // Einzelleistungen (Detail-Multi-Select aus dem Hidden-Select)
      const singleIds = [];
      if (bookingDetailSinglesList) {
        for (const opt of bookingDetailSinglesList.options) {
          if (opt.selected && opt.value) {
            singleIds.push(opt.value);
          }
        }
      }

      singleIds.forEach((id) => {
        const svc = getServiceById(id);
        if (!svc) return;

        const basePrice = svc.base_price_cents || 0;
        const baseDur = svc.duration_minutes || 0;

        items.push({
          role: "single",
          service_id: svc.id,
          name: svc.name,
          base_price_cents: basePrice,
          price_cents: basePrice,
          base_duration_minutes: baseDur,
          duration_minutes: baseDur,
        });

        totalBasePriceCents += basePrice;
        totalMinutes += baseDur;
      });

      // ==============================
      // Fahrzeugklasse + Preis-Delta
      // ==============================
      let vehicleClassId = null;
      let vehicleClassName = null;
      let classPriceDeltaCents = 0;

      if (bookingDetailVehicleClassSelect) {
        vehicleClassId = bookingDetailVehicleClassSelect.value || null;
      }

      if (vehicleClassId && Array.isArray(vehicleClasses)) {
        const vc = vehicleClasses.find((v) => String(v.id) === String(vehicleClassId));
        if (vc) {
          vehicleClassName = vc.name || null;
          classPriceDeltaCents = vc.price_delta_cents || 0;
        }
      }

      patch.vehicle_class_id = vehicleClassId;
      patch.vehicle_class_name = vehicleClassName;

      if (classPriceDeltaCents !== 0) {
        items.push({
          role: "vehicle_price_adjustment",
          amount_cents: classPriceDeltaCents,
        });
      }

      // ==============================
      // Rabatt
      // ==============================
      let discType = "none";
      let discVal = 0;

      if (bookingDetailDiscountTypeSelect) {
        discType = bookingDetailDiscountTypeSelect.value || "none";
      }
      if (bookingDetailDiscountValueInput) {
        const raw = parseFloat(bookingDetailDiscountValueInput.value || "0");
        discVal = Number.isFinite(raw) ? raw : 0;
      }

      if (discType !== "amount" && discType !== "percent") {
        discType = "none";
        discVal = 0;
      }

      let discountAmountCents = 0;
      if (discType === "amount" && discVal > 0) {
        discountAmountCents = Math.round(discVal * 100);
      } else if (discType === "percent" && discVal > 0) {
        if (discVal > 100) discVal = 100;
        if (discVal < 0) discVal = 0;
        discountAmountCents = Math.round(
          totalBasePriceCents * (discVal / 100)
        );
      } else {
        discType = "none";
        discVal = 0;
      }

      patch.discount_type = discType;
      patch.discount_value = discVal;
      patch.discount_amount_cents = discountAmountCents;

      // ==============================
      // Gesamtpreis & Dauer
      // ==============================
      const totalPriceCentsRaw =
        totalBasePriceCents + classPriceDeltaCents - discountAmountCents;
      const totalPriceCents = Math.max(0, totalPriceCentsRaw);
      patch.total_price = totalPriceCents / 100;
      patch.duration_minutes = totalMinutes;

      // service_name für Übersicht / Kalender
      patch.service_name = mainServiceName || "Auftrag";

      // ==============================
      // Payment-Meta
      // ==============================
      const partialCents = parseEuroInputToCents(
        bookingDetailPartialAmountInput
      );
      const overrideCents = parseEuroInputToCents(
        bookingDetailPaidOverrideInput
      );

      if (paymentStatus === "partial" && partialCents != null) {
        items.push({
          role: "payment_partial",
          amount_cents: partialCents,
        });
      }

      if (paymentStatus === "paid") {
        if (overrideCents != null) {
          items.push({
            role: "payment_final_override",
            amount_cents: overrideCents,
          });
        }
      }

      // ==============================
      // Termin
      // ==============================
      if (bookingDetailDateInput && bookingDetailDateInput.value) {
        const dateStr = bookingDetailDateInput.value;
        const timeStr =
          (bookingDetailTimeInput && bookingDetailTimeInput.value) ||
          "09:00";
        const newStart = new Date(`${dateStr}T${timeStr}:00`);
        if (!Number.isNaN(newStart.getTime())) {
          patch.start_at = newStart.toISOString();
        }
      }

      // Fahrzeug
      if (bookingDetailCarInput) {
        const carVal = bookingDetailCarInput.value.trim();
        patch.car = carVal || null;
      }

      // Kunde
      if (bookingDetailCustomerNameInput) {
        const v = bookingDetailCustomerNameInput.value.trim();
        patch.customer_name = v || null;
      }
      if (bookingDetailCustomerEmailInput) {
        const v = bookingDetailCustomerEmailInput.value.trim();
        patch.customer_email = v || null;
      }
      if (bookingDetailCustomerPhoneInput) {
        const v = bookingDetailCustomerPhoneInput.value.trim();
        patch.customer_phone = v || null;
      }
      if (bookingDetailCustomerAddressInput) {
        const v = bookingDetailCustomerAddressInput.value.trim();
        patch.customer_address = v || null;
      }

      // Items anhängen
      patch.items = items;

      const { error } = await supabaseClient
        .from("bookings")
        .update(patch)
        .eq("id", currentDetailBooking.id)
        .eq("detailer_id", currentUser.id);

      if (error) {
        console.error("DetailHQ: booking update failed:", error);
        return;
      }

      closeBookingDetailModal();
      await loadBookingsForDashboardAndSchedule();
    });
  }

  // Auftrag löschen
  if (bookingDetailDeleteButton) {
    bookingDetailDeleteButton.addEventListener("click", async () => {
      if (!currentUser || !supabaseClient || !currentDetailBooking) return;
      const ok = confirm("Diesen Auftrag wirklich löschen?");
      if (!ok) return;

      const { error } = await supabaseClient
        .from("bookings")
        .delete()
        .eq("id", currentDetailBooking.id)
        .eq("detailer_id", currentUser.id);

      if (error) {
        console.error("DetailHQ: booking delete failed:", error);
        return;
      }

      closeBookingDetailModal();
      currentDetailBooking = null;
      await loadBookingsForDashboardAndSchedule();
    });
  }
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200; // Reicht völlig für Protokolle
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_WIDTH) {
            width *= MAX_WIDTH / height;
            height = MAX_WIDTH;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Wandelt das Bild in ein kleineres JPEG um (Qualität 0.7)
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.7);
      };
    };
  });
}

// ================================
// PULL TO REFRESH (Mobile)
// ================================
async function refreshAppData({ silent } = {}) {
  if (window.__detailhqRefreshing) return;
  if (!currentUser) return;

  window.__detailhqRefreshing = true;

  const bar = document.getElementById("ptr-bar");

  const showBar = () => {
    if (!bar) return;
    bar.style.display = "flex";
    bar.style.opacity = "1";
    bar.style.transform = "translate(-50%, 0px)";
  };

  const hideBar = () => {
    if (!bar) return;
    bar.style.opacity = "0";
    bar.style.transform = "translate(-50%, -10px)";
    setTimeout(() => {
      if (bar) bar.style.display = "none";
    }, 220);
  };

  try {
    if (!silent) showBar();

    // Reihenfolge ist wichtig: erst Stammdaten, dann Kalender/Bookings
    await ensureProfile();
    await persistAffiliateRefToProfileIfMissing?.();
    await loadProfileIntoForm?.();
    setupCalendarUrlForUser?.();

    await loadVehicleClasses();
    await loadServices();
    await loadBookingsForDashboardAndSchedule();

  } catch (e) {
    console.error("DetailHQ: pull-to-refresh reload failed:", e);
  } finally {
    hideBar();
    window.__detailhqRefreshing = false;
  }
}

function ensurePtrBar() {
  let bar = document.getElementById("ptr-bar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "ptr-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.style.position = "fixed";
  bar.style.left = "50%";
  bar.style.top = "10px";
  bar.style.transform = "translate(-50%, -10px)";
  bar.style.display = "none";
  bar.style.alignItems = "center";
  bar.style.gap = "10px";
  bar.style.padding = "8px 12px";
  bar.style.borderRadius = "999px";
  bar.style.background = "rgba(255,255,255,0.7)";
  bar.style.border = "1px solid rgba(0,0,0,0.08)";
  bar.style.backdropFilter = "blur(10px)";
  bar.style.webkitBackdropFilter = "blur(10px)";
  bar.style.boxShadow = "0 8px 30px rgba(0,0,0,0.12)";
  bar.style.zIndex = "9999";
  bar.style.transition = "opacity 220ms ease, transform 220ms ease";

  const spinner = document.createElement("div");
  spinner.style.width = "14px";
  spinner.style.height = "14px";
  spinner.style.borderRadius = "999px";
  spinner.style.border = "2px solid rgba(0,0,0,0.22)";
  spinner.style.borderTopColor = "rgba(0,0,0,0.55)";
  spinner.style.animation = "ptrSpin 900ms linear infinite";

  const txt = document.createElement("div");
  txt.id = "ptr-text";
  txt.textContent = "Aktualisiere…";
  txt.style.fontSize = "12px";
  txt.style.fontWeight = "500";
  txt.style.color = "rgba(15, 23, 42, 0.8)";

  if (!document.getElementById("ptr-style")) {
    const st = document.createElement("style");
    st.id = "ptr-style";
    st.textContent = "@keyframes ptrSpin{to{transform:rotate(360deg)}}";
    document.head.appendChild(st);
  }

  bar.appendChild(spinner);
  bar.appendChild(txt);
  document.body.appendChild(bar);
  return bar;
}

function setupPullToRefresh() {
  const main = document.querySelector(".app-main");
  if (!main) return;

  ensurePtrBar();

  const docScroller = document.scrollingElement || document.documentElement;

  const isMainScrollable = () => {
    return (
      main.scrollHeight - main.clientHeight > 2 &&
      getComputedStyle(main).overflowY !== "visible"
    );
  };

  const getScrollTop = () => {
    if (isMainScrollable()) return main.scrollTop || 0;
    return docScroller.scrollTop || window.scrollY || 0;
  };

  main.style.overscrollBehaviorY = "contain";

  let startY = 0;
  let startX = 0;
  let pulling = false;
  let locked = false;
  let lastDy = 0;

  const threshold = 70; // px
  const slop = 12; // px

  const resetBar = () => {
    const bar = document.getElementById("ptr-bar");
    if (!bar) return;
    bar.dataset.ready = "0";
    bar.style.opacity = "0";
    bar.style.transform = "translate(-50%, -10px)";
    setTimeout(() => {
      if (bar) bar.style.display = "none";
    }, 200);
  };

  main.addEventListener(
    "touchstart",
    (e) => {
      if (window.__detailhqRefreshing) return;

      // PTR nur wenn ganz oben (egal ob main oder body scrollt)
      if (getScrollTop() > 0) return;

      const t = e.touches && e.touches[0];
      if (!t) return;

      pulling = true;
      locked = false;
      startY = t.clientY;
      startX = t.clientX;
      lastDy = 0;
    },
    { passive: true }
  );

  main.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      if (window.__detailhqRefreshing) return;

      // sobald nicht mehr oben -> abbrechen und normal scrollen lassen
      if (getScrollTop() > 0) {
        pulling = false;
        locked = false;
        resetBar();
        return;
      }

      const t = e.touches && e.touches[0];
      if (!t) return;

      const dy = t.clientY - startY;
      const dx = t.clientX - startX;

      // nur "ziehen nach unten"
      if (dy <= 0) return;

      // horizontale swipes ignorieren
      if (Math.abs(dx) > Math.abs(dy)) return;

      lastDy = dy;

      // erst ab slop übernehmen wir die gesture
      if (!locked && dy >= slop) locked = true;

      if (!locked) return;

      e.preventDefault();

      const bar = document.getElementById("ptr-bar");
      if (bar) {
        bar.style.display = "flex";
        const y = Math.min(40, dy * 0.25);
        bar.style.opacity = String(Math.min(1, dy / 60));
        bar.style.transform = `translate(-50%, ${y}px)`;
        bar.dataset.ready = dy >= threshold ? "1" : "0";
      }
    },
    { passive: false }
  );

  main.addEventListener(
    "touchend",
    async () => {
      if (!pulling) return;

      const bar = document.getElementById("ptr-bar");
      const ready = !!(bar && bar.dataset.ready === "1");

      pulling = false;

      if (bar) bar.dataset.ready = "0";

      if (locked && ready && lastDy >= threshold) {
        locked = false;
        await refreshAppData();
      } else {
        locked = false;
        resetBar();
      }
    },
    { passive: true }
  );
}

// ================================
// CAL URL
// ================================
function setupCalendarUrlForUser() {
  if (!currentUser) return;
  const apiBase = "https://api.detailhq.de";
  currentCalendarUrl = `${apiBase}/cal/${currentUser.id}.ics`;
}
