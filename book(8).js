// Public Booking (detailhq.de/<detailer_uuid>)
// Lädt Services + Fahrzeugklassen über Worker API und schreibt "requested" Booking.

const API_BASE = "https://api.detailhq.de"; // dein Worker Host

function $(id) { return document.getElementById(id); }

const bookingForm = $("booking-form");
const bookingError = $("booking-error");
const publicError = $("public-error");
const thankYouSection = $("booking-thankyou");
const thankYouContent = $("booking-thankyou-content");
const discountCodeInput = $("booking-discount-code");
const discountApplyBtn = $("booking-discount-apply");
const discountStatus = $("booking-discount-status");

let appliedDiscount = {
  applied_kind: null,
  applied_code: null,
  discount_cents: 0,
  discount_type: null,
  discount_value: null,
};

function minutesToHoursText(mins) {
  const m = Number(mins || 0) || 0;
  const h = m / 60;
  // 0.5er Schritte
  const rounded = Math.round(h * 2) / 2;
  return `${rounded.toLocaleString("de-DE", { minimumFractionDigits: rounded % 1 ? 1 : 0, maximumFractionDigits: 1 })} Std.`;
}

function formatIcsDateUtc(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function downloadIcs(summary) {
  const start = new Date(summary.startAtIso);
  const end = new Date(start.getTime() + (Number(summary.durationMinutes || 0) || 0) * 60000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DetailHQ//Public Booking//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@detailhq.de`,
    `DTSTAMP:${formatIcsDateUtc(new Date())}`,
    `DTSTART:${formatIcsDateUtc(start)}`,
    `DTEND:${formatIcsDateUtc(end)}`,
    "SUMMARY:Termin Aufbereitung",
    `DESCRIPTION:Fahrzeug: ${summary.car}\\nFahrzeugklasse: ${summary.vehicleClassName || "—"}\\nLeistungen: ${summary.packageName ? "Paket: " + summary.packageName + " " : ""}${summary.singlesNames && summary.singlesNames.length ? "Einzelleistungen: " + summary.singlesNames.join(", ") : ""}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const ics = lines.join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "termin-aufbereitung.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showThankYouPage(summary) {
  // Steps ausblenden
  step1.classList.add("hidden");
  step2.classList.add("hidden");
  step3.classList.add("hidden");
  step4.classList.add("hidden");

  // Step-Indikator ausblenden (falls vorhanden)
  document.querySelector(".booking-steps-indicator")?.classList.add("hidden");

  if (thankYouContent) {
    const servicesLine = [
      summary.packageName ? `Paket: ${summary.packageName}` : "",
      summary.singlesNames && summary.singlesNames.length ? `Einzelleistungen: ${summary.singlesNames.join(", ")}` : "",
    ].filter(Boolean).join("<br>");

    thankYouContent.innerHTML = `

      <div class="success-line"><strong>Fahrzeug:</strong> ${summary.car}</div>
      <div class="success-line"><strong>Fahrzeugklasse:</strong> ${summary.vehicleClassName || "—"}</div>
      <div class="success-line"><strong>Termin:</strong> ${summary.dateStr} · ${summary.timeStr}</div>
      <div class="success-line"><strong>Dauer:</strong> ${minutesToHoursText(summary.durationMinutes)}</div>
      <div class="success-line"><strong>Preis:</strong> ${euro(summary.totalPriceCents)}</div>

      <div class="success-line" style="margin-top:12px;">
        <strong>Leistungen:</strong><br>
        ${servicesLine || "—"}
      </div>

      <div style="margin-top:16px;">
        <button type="button" id="add-to-calendar" class="btn btn-primary" style="width:100%;">Zum Kalender hinzufügen</button>
      </div>
    `;

    const btn = document.getElementById("add-to-calendar");
    if (btn) {
      btn.addEventListener("click", () => downloadIcs(summary));
    }
  }

  if (thankYouSection) thankYouSection.classList.remove("hidden");

  // Ganz nach oben, damit die Section nicht “unten” wirkt
  document.querySelector(".auth-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const bookingCarInput = $("booking-car");
const bookingVehicleClassSelect = $("booking-vehicle-class");
const bookingMainServiceSelect = $("booking-main-service");

const bookingSinglesToggle = $("booking-singles-toggle");
const bookingSinglesMenu = $("booking-singles-menu");
const bookingSinglesList = $("booking-singles-list");
const bookingPackageToggle = $("booking-package-toggle");
const bookingPackageMenu = $("booking-package-menu");
const bookingPackageLabel = $("booking-package-label");

const bookingDateInput = $("booking-date");
const bookingTimeInput = $("booking-time");

function pad2(n) { return String(n).padStart(2, "0"); }

function minutesFromHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmmFromMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function fetchAvailability(detailerId, day) {
  const r = await fetch(`${API_BASE}/public/availability?user=${encodeURIComponent(detailerId)}&day=${encodeURIComponent(day)}`);
  if (!r.ok) throw new Error("availability_failed");
  return await r.json(); // { day, blocked: [{start_at,end_at,...}] }
}

async function rebuildTimeOptionsForDay(detailerId, day, durationMinutes) {
  const timeSelect = document.getElementById("booking-time");
  const hint = document.getElementById("booking-time-hint");
  if (!timeSelect) return;

  timeSelect.innerHTML = `<option value="">Bitte wählen</option>`;
  if (hint) hint.textContent = "Lädt verfügbare Zeiten...";

    // Blockierte Zeiten laden (bereits gebuchte Slots etc.)
  let blocked = [];
  try {
    const av = await fetchAvailability(detailerId, day);
    blocked = (av && Array.isArray(av.blocked) ? av.blocked : []).map((b) => ({
      start: new Date(b.start_at),
      end: new Date(b.end_at),
    }));
  } catch (e) {
    console.warn("DetailHQ: availability konnte nicht geladen werden, fallback ohne blocking");
    blocked = [];
  }

const dayKey = dayKeyFromISODate(day);

// Öffnungszeiten aus Provider laden (Fallback 07:00–19:00)
const opening = providerSettings?.opening_hours?.[dayKey] || null;

// Wenn geschlossen (Checkbox nicht gesetzt) => keine Zeiten
const isOpen = opening ? (opening.open === true || (!!opening.start && !!opening.end)) : true;

if (!isOpen) {
  if (hint) hint.textContent = "An diesem Tag geschlossen.";
  return;
}

let DAY_START = 7 * 60;
let DAY_END = 19 * 60;

if (opening?.start && opening?.end) {
  DAY_START = minutesFromHHMM(opening.start);
  DAY_END = minutesFromHHMM(opening.end);
}

const STEP = 15;

  // Dauer wird NICHT zur Einschränkung der Startzeiten genutzt
  const dur = 15;
  const options = [];

  for (let t = DAY_START; t <= DAY_END; t += STEP) {
    const start = new Date(`${day}T${hhmmFromMinutes(t)}:00`);
    const end = new Date(start.getTime() + dur * 60000);

    const isBlocked = blocked.some(b => overlaps(start, end, b.start, b.end));
    if (!isBlocked) options.push(hhmmFromMinutes(t));
  }

  for (const hhmm of options) {
    const opt = document.createElement("option");
    opt.value = hhmm;
    opt.textContent = hhmm;
    timeSelect.appendChild(opt);
  }

  if (hint) hint.textContent = options.length ? "" : "Keine freien Zeiten an diesem Tag.";
}

const bookingCustomerNameInput = $("booking-customer-name");
const bookingCustomerEmailInput = $("booking-customer-email");
const bookingCustomerPhoneInput = $("booking-customer-phone");
const bookingCustomerAddressInput = $("booking-customer-address");
const bookingNotesInput = $("booking-notes");

const next1 = $("booking-next-1");
const next2 = $("booking-next-2");
const next3 = $("booking-next-3");
const back2 = $("booking-back-2");
const back3 = $("booking-back-3");

const step1 = $("booking-step-1");
const step2 = $("booking-step-2");
const step3 = $("booking-step-3");
const step4 = $("booking-step-4");

const ind1 = $("booking-step-indicator-1");
const ind2 = $("booking-step-indicator-2");
const ind3 = $("booking-step-indicator-3");
const ind4 = $("booking-step-indicator-4");

let detailerId = null;
let vehicleClasses = [];
let services = [];
let selectedSingles = new Set();
let providerSettings = null; // { opening_hours: {...} }

function getCurrentDurationMinutes() {
  let dur = 0;

  const packageId = bookingMainServiceSelect.value || null;
  const packageSvc = packageId ? services.find(s => String(s.id) === String(packageId)) : null;
  if (packageSvc) dur += Number(packageSvc.duration_minutes || 0) || 0;

  for (const sid of selectedSingles) {
    const svc = services.find(s => String(s.id) === String(sid));
    if (svc) dur += Number(svc.duration_minutes || 0) || 0;
  }

  return Math.max(15, dur || 0);
}

function setIndicator(step) {
  [ind1, ind2, ind3, ind4].forEach((el, i) => el.classList.toggle("active", i === (step - 1)));
}

function showStep(step) {
  step1.classList.toggle("hidden", step !== 1);
  step2.classList.toggle("hidden", step !== 2);
  step3.classList.toggle("hidden", step !== 3);
  step4.classList.toggle("hidden", step !== 4);
  setIndicator(step);
  bookingError.textContent = "";
}

function getPathDetailerId() {
  // Unterstützt:
  // - /<uuid>
  // - /book/<uuid>
  // - /book.html?u=<uuid>
  // - /book.html?detailer=<uuid>

  const rawPath = (location.pathname || "/").replace(/^\/+|\/+$/g, "");
  const parts = rawPath ? rawPath.split("/") : [];

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = (parts[i] || "").trim();
    if (uuidRe.test(seg)) return seg;
  }

  // Fallback: wenn jemand direkt /<uuid> ohne weitere Segmente hat, aber nicht als UUID erkannt (sollte nicht passieren)
  if (rawPath && rawPath !== "book.html" && rawPath !== "book") return rawPath;

  const params = new URLSearchParams(window.location.search);
  const u = params.get("u");
  const d = params.get("detailer");
  const user = params.get("user");
  return u || d || user || null;
}

function getCurrentSubtotalCents() {
  let total = 0;

  const pkgId = String(bookingMainServiceSelect?.value || "").trim() || null;
  if (pkgId) {
    const pkg = (services || []).find((x) => String(x.id) === String(pkgId));
    if (pkg) total += Number(pkg.base_price_cents || 0) || 0;
  }

  const singles = Array.from(selectedSingles || []);
  for (const id of singles) {
    const s = (services || []).find((x) => String(x.id) === String(id));
    if (s) total += Number(s.base_price_cents || 0) || 0;
  }

  return Math.max(0, Number(total) || 0);
}

async function applyDiscountCode(detailerId, subtotalCents) {
  const code = (discountCodeInput?.value || "").trim().toUpperCase();

  appliedDiscount = {
    applied_kind: null,
    applied_code: null,
    discount_cents: 0,
    discount_type: null,
    discount_value: null,
  };

  if (!code) {
    if (discountStatus) discountStatus.textContent = "";
    return;
  }

  if (discountStatus) discountStatus.textContent = "Prüfe Code...";

  try {
    const res = await apiPost(`/public/discount/validate`, {
      detailer_id: detailerId,
      code,
      subtotal_cents: subtotalCents,
    });

    appliedDiscount = {
      applied_kind: res.applied_kind || null,
      applied_code: res.applied_code || null,
      discount_cents: Number(res.discount_cents || 0) || 0,
      discount_type: res.discount_type || null,
      discount_value: res.discount_value != null ? res.discount_value : null,
    };

    const net = Math.max(0, Number(subtotalCents || 0) - Number(appliedDiscount.discount_cents || 0));
    if (discountStatus) {
      discountStatus.textContent = `Rabatt: ${euro(appliedDiscount.discount_cents)} · Neu: ${euro(net)}`;
    }
  } catch (e) {
    appliedDiscount = {
      applied_kind: null,
      applied_code: null,
      discount_cents: 0,
      discount_type: null,
      discount_value: null,
    };
    if (discountStatus) discountStatus.textContent = "Code ungültig.";
  }
}

function euro(cents) {
  const v = (Number(cents || 0) / 100);
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function safeText(s) {
  return (s || "").toString().trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
  return await res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`API POST ${path} failed: ${res.status} ${t}`);
  }
  return await res.json().catch(() => ({}));
}

function renderVehicleClasses() {
  bookingVehicleClassSelect.innerHTML = `<option value="">Bitte wählen</option>`;
  vehicleClasses.forEach((vc) => {
    const opt = document.createElement("option");
    opt.value = vc.id; // vehicle_classes.id
    opt.textContent = vc.name;
    bookingVehicleClassSelect.appendChild(opt);
  });
}

function renderPackages() {
  // hidden select leeren
  bookingMainServiceSelect.innerHTML = "";

  // Dropdown menu leeren
  bookingPackageMenu.innerHTML = "";

  // Filter: nur Pakete (nicht single services)
const packages = services.filter((s) =>
  s && (s.kind === "package" || s.is_single_service === false || s.is_single_service === 0 || s.is_single_service === "false")
);

  // Placeholder option im hidden select
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Paket wählen";
  bookingMainServiceSelect.appendChild(ph);

  if (!packages.length) {
    bookingPackageMenu.innerHTML = `<p class="form-hint">Keine Pakete verfügbar.</p>`;
    bookingPackageLabel.textContent = "Paket wählen";
    return;
  }

  packages.forEach((svc) => {
    // hidden select option
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
    
const headerRow = document.createElement("div");
headerRow.className = "service-header-row";

const txt = document.createElement("div");
txt.className = "booking-singles-item-label";
txt.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;

headerRow.appendChild(txt);

    // optional details (accordion)
    const desc = (svc.description || "").trim();
    let descWrap = null;

    if (desc) {
      descWrap = document.createElement("div");
      descWrap.className = "service-desc-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-desc-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `Details <span class="service-desc-chevron">▾</span>`;

      const panel = document.createElement("div");
      panel.className = "service-desc-panel";
      panel.hidden = true;

      const body = document.createElement("div");
      body.className = "service-desc-text";
      body.innerHTML = escapeHtml(desc);

      panel.appendChild(body);
      descWrap.appendChild(btn);
      descWrap.appendChild(panel);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = btn.getAttribute("aria-expanded") === "true";
        closeAllServiceDescriptions();
        btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
        panel.hidden = isOpen ? true : false;
      });
    }

    row.appendChild(radio);

    const col = document.createElement("div");
    col.className = "service-col";
    col.style.flex = "1";
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.gap = "6px";

if (descWrap) {
  headerRow.appendChild(descWrap.querySelector(".service-desc-toggle"));
}

col.appendChild(headerRow);

// Panel (Text) kommt darunter
if (descWrap) {
  col.appendChild(descWrap.querySelector(".service-desc-panel"));
}

    row.appendChild(col);

    row.addEventListener("click", () => {
      const val = row.dataset.value;
      bookingMainServiceSelect.value = val;

      bookingPackageMenu.querySelectorAll(".settings-dropdown-item").forEach((it) => {
        it.classList.toggle("selected", it === row);
      });

      bookingPackageLabel.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;

      // dropdown schließen
      const dd = bookingPackageToggle.closest(".settings-dropdown");
      dd?.classList.remove("open");
      bookingPackageToggle.setAttribute("aria-expanded", "false");

      bookingMainServiceSelect.dispatchEvent(new Event("change"));
    });

    bookingPackageMenu.appendChild(row);
  });

  bookingPackageLabel.textContent = "Paket wählen";
}

function closeAllServiceDescriptions() {

  // Singles panels schließen
  document.querySelectorAll(".service-desc-toggle[aria-expanded='true']").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
    const p = btn.closest(".settings-dropdown-item")?.querySelector(".service-desc-panel");
    if (p) p.hidden = true;
  });
}

function renderSinglesMenu() {
  bookingSinglesMenu.innerHTML = "";
const singles = services.filter((s) =>
  s && (s.kind === "single" || s.is_single_service === true || s.is_single_service === 1 || s.is_single_service === "true") && (s.is_active !== false)
);

  if (singles.length === 0) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = "Keine Einzelleistungen verfügbar.";
    bookingSinglesMenu.appendChild(p);
    return;
  }

  singles.forEach((svc) => {
    const row = document.createElement("label");
    row.className = "settings-dropdown-item";
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.alignItems = "flex-start";

const cb = document.createElement("div");
cb.className = "booking-singles-item-checkbox";

const isSelected = selectedSingles.has(svc.id);
row.classList.toggle("selected", isSelected);

function toggleSingle() {
  const now = !selectedSingles.has(svc.id);
  if (now) selectedSingles.add(svc.id);
  else selectedSingles.delete(svc.id);

  row.classList.toggle("selected", now);
  renderSelectedSinglesList();
}

const headerRow = document.createElement("div");
headerRow.className = "service-header-row";

const txt = document.createElement("div");
txt.className = "booking-singles-item-label";
txt.textContent = `${svc.name} · ${euro(svc.base_price_cents)}`;

headerRow.appendChild(txt);

    // optional details (accordion)
    const desc = (svc.description || "").trim();
    let descWrap = null;

    if (desc) {
      descWrap = document.createElement("div");
      descWrap.className = "service-desc-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-desc-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `Details <span class="service-desc-chevron">▾</span>`;

      const panel = document.createElement("div");
      panel.className = "service-desc-panel";
      panel.hidden = true;

      const body = document.createElement("div");
      body.className = "service-desc-text";
      body.innerHTML = escapeHtml(desc);

      panel.appendChild(body);
      descWrap.appendChild(btn);
      descWrap.appendChild(panel);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = btn.getAttribute("aria-expanded") === "true";
        closeAllServiceDescriptions();
        btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
        panel.hidden = isOpen ? true : false;
      });
    }

    row.addEventListener("click", (e) => {
  // Wenn auf "Details" geklickt wurde, NICHT selektieren
  if (e.target.closest(".service-desc-toggle")) return;
  toggleSingle();
});

    row.appendChild(cb);

    const col = document.createElement("div");
    col.className = "service-col";
    col.style.flex = "1";
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.gap = "6px";

if (descWrap) {
  headerRow.appendChild(descWrap.querySelector(".service-desc-toggle"));
}

col.appendChild(headerRow);

// Panel (Text) kommt darunter
if (descWrap) {
  col.appendChild(descWrap.querySelector(".service-desc-panel"));
}

    row.appendChild(col);
    bookingSinglesMenu.appendChild(row);
  });

  renderSelectedSinglesList();
}

function renderSelectedSinglesList() {
  const singles = services.filter(s => selectedSingles.has(s.id));
  if (singles.length === 0) {
    bookingSinglesList.textContent = "Keine Einzelleistungen gewählt.";
    return;
  }
  bookingSinglesList.textContent = singles.map(s => s.name).join(", ");
}

const bookingSinglesDropdown = document.querySelector(".booking-singles-dropdown");

function toggleSinglesDropdown() {
  if (!bookingSinglesDropdown) return;
  bookingSinglesDropdown.classList.toggle("open");
}

document.addEventListener("click", (e) => {
  if (!bookingSinglesDropdown) return;
  const within = e.target.closest(".booking-singles-dropdown");
  if (!within) bookingSinglesDropdown.classList.remove("open");
});

bookingSinglesToggle.addEventListener("click", (e) => {
  e.preventDefault();
  toggleSinglesDropdown();
});

const bookingPackageDropdown = document.querySelector(".booking-package-dropdown");

function togglePackageDropdown() {
  if (!bookingPackageDropdown) return;
  bookingPackageDropdown.classList.toggle("open");
}

document.addEventListener("click", (e) => {
  if (!bookingPackageDropdown) return;
  const within = e.target.closest(".booking-package-dropdown");
  if (!within) bookingPackageDropdown.classList.remove("open");
});

bookingPackageToggle.addEventListener("click", (e) => {
  e.preventDefault();
  togglePackageDropdown();
});

function validateStep2() {
  const packageId = bookingMainServiceSelect.value || "";
  const singlesCount = selectedSingles.size;

  const bad = (!packageId && singlesCount === 0);

  // Nur bei Fehler rot markieren
  bookingPackageToggle.classList.toggle("is-invalid", bad);
  bookingSinglesToggle.classList.toggle("is-invalid", bad);

  if (bad) {
    bookingError.textContent = "Bitte mindestens ein Paket oder eine Einzelleistung auswählen.";
    return false;
  }

  bookingError.textContent = "";
  return true;
}
bookingPackageMenu.addEventListener("click", () => {
  clearInvalid(bookingPackageToggle);
  clearInvalid(bookingSinglesToggle);
});

bookingSinglesMenu.addEventListener("click", () => {
  clearInvalid(bookingPackageToggle);
  clearInvalid(bookingSinglesToggle);
});

function wireRequiredRedBorders(root = document) {
  const fields = Array.from(root.querySelectorAll("input[required], select[required], textarea[required]"));

  const apply = (el) => {
    const isEmpty = (el.value ?? "").toString().trim() === "";
    el.classList.toggle("is-invalid", isEmpty);
  };

  // WICHTIG: kein initial apply() -> erst wenn wir es triggern (Weiter/Buchen)
  fields.forEach((el) => {
    el.addEventListener("input", () => {
      if (el.classList.contains("is-invalid")) apply(el); // nur wenn bereits rot war
    });
    el.addEventListener("change", () => {
      if (el.classList.contains("is-invalid")) apply(el);
    });
    el.addEventListener("blur", () => {
      if (el.classList.contains("is-invalid")) apply(el);
    });
  });

  return { apply };
}

const requiredUI = wireRequiredRedBorders(document);

function markInvalidIfEmpty(el) {
  if (!el) return false;
  const empty = (el.value ?? "").toString().trim() === "";
  el.classList.toggle("is-invalid", empty);
  return empty;
}

function clearInvalid(el) {
  if (!el) return;
  el.classList.remove("is-invalid");
}

function dayKeyFromISODate(dayIso) {
  // dayIso: "YYYY-MM-DD"
  const dow = new Date(`${dayIso}T12:00:00`).getDay(); // 0=Sun ... 6=Sat
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[dow];
}

async function fetchProviderSettings(detailerId) {
  // Wenn du den Endpoint schon hast (du hattest ihn kommentiert):
  // /public/provider?user=<id>
  try {
    const res = await apiGet(`/public/provider?user=${encodeURIComponent(detailerId)}`);
    return res || null;
  } catch (e) {
    console.warn("DetailHQ: provider settings konnten nicht geladen werden (fallback 07-19).");
    return null;
  }
}

async function init() {
  detailerId = getPathDetailerId();
  if (!detailerId) {
    publicError.style.display = "block";
    publicError.textContent = "Ungültiger Link.";
    showStep(1);
    return;
  }

  publicError.style.display = "none";
  publicError.textContent = "";

  try {
    // Provider Info optional (Name etc.) – wenn du das später willst, Route ist schon vorbereitet.
    providerSettings = await fetchProviderSettings(detailerId);

    const vcRes = await apiGet(`/public/vehicle-classes?detailer=${encodeURIComponent(detailerId)}`);
    vehicleClasses = Array.isArray(vcRes) ? vcRes : (vcRes.vehicle_classes || []);

    const sRes = await apiGet(`/public/services?detailer=${encodeURIComponent(detailerId)}`);
    services = Array.isArray(sRes) ? sRes : (sRes.services || []);

    renderVehicleClasses();
    renderPackages();
    renderSinglesMenu();
clearInvalid(bookingCarInput);
clearInvalid(bookingVehicleClassSelect);
clearInvalid(bookingDateInput);
clearInvalid(bookingTimeInput);

    showStep(1);
  } catch (err) {
    publicError.style.display = "block";
    publicError.textContent = "Konnte Daten nicht laden. Bitte später erneut versuchen.";
    console.error(err);
  }
}

bookingDateInput.addEventListener("change", async () => {
  if (!detailerId) return;
  if (!bookingDateInput.value) return;

  try {
    await rebuildTimeOptionsForDay(detailerId, bookingDateInput.value, getCurrentDurationMinutes());
  } catch (e) {
    console.error(e);
  }
});

next1.addEventListener("click", () => {
  bookingError.textContent = "";
  if (discountApplyBtn) {
    discountApplyBtn.addEventListener("click", async () => {
      try {
        const detailerId = getDetailerIdFromUrl();
        const subtotalCents = getCurrentSubtotalCents();
        await applyDiscountCode(detailerId, subtotalCents);
      } catch (e) {
        if (discountStatus) discountStatus.textContent = "Code konnte nicht geprüft werden.";
      }
    });
  }

  const carBad = !safeText(bookingCarInput.value);
  const vcBad = !bookingVehicleClassSelect.value;

  bookingCarInput.classList.toggle("is-invalid", carBad);
  bookingVehicleClassSelect.classList.toggle("is-invalid", vcBad);

  if (carBad || vcBad) return;

  showStep(2);
});
bookingCarInput.addEventListener("input", () => {
  if (bookingCarInput.classList.contains("is-invalid")) clearInvalid(bookingCarInput);
});

bookingVehicleClassSelect.addEventListener("change", () => {
  if (bookingVehicleClassSelect.classList.contains("is-invalid")) clearInvalid(bookingVehicleClassSelect);
});

back2.addEventListener("click", () => showStep(1));
back3.addEventListener("click", () => showStep(2));
next2.addEventListener("click", async () => {
  if (!validateStep2()) return;
  showStep(3);

  if (!detailerId) return;
  if (!bookingDateInput.value) return;

  try {
    await rebuildTimeOptionsForDay(detailerId, bookingDateInput.value, getCurrentDurationMinutes());
  } catch (e) {
    console.error(e);
  }
});

next3.addEventListener("click", () => {
  bookingError.textContent = "";

  const dBad = !bookingDateInput.value;
  const tBad = !bookingTimeInput.value;

  bookingDateInput.classList.toggle("is-invalid", dBad);
  bookingTimeInput.classList.toggle("is-invalid", tBad);

  if (dBad || tBad) return;

  showStep(4);
});
bookingDateInput.addEventListener("change", () => {
  if (bookingDateInput.classList.contains("is-invalid")) clearInvalid(bookingDateInput);
});

bookingTimeInput.addEventListener("change", () => {
  if (bookingTimeInput.classList.contains("is-invalid")) clearInvalid(bookingTimeInput);
});

// Step 4 – rote Markierung entfernen beim Tippen
bookingCustomerNameInput.addEventListener("input", () => clearInvalid(bookingCustomerNameInput));
bookingCustomerEmailInput.addEventListener("input", () => clearInvalid(bookingCustomerEmailInput));
bookingCustomerPhoneInput.addEventListener("input", () => clearInvalid(bookingCustomerPhoneInput));
if (discountApplyBtn) {
  discountApplyBtn.addEventListener("click", async () => {
    const subtotalCents = getCurrentSubtotalCents();
    await applyDiscountCode(detailerId, subtotalCents);
  });
}

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  bookingError.textContent = "";
  publicError.style.display = "none";

  const car = safeText(bookingCarInput.value);
  const vehicleClassId = bookingVehicleClassSelect.value;
  const vehicleClassName = (vehicleClasses.find(v => String(v.id) === String(vehicleClassId)) || {}).name || "";

  const packageId = bookingMainServiceSelect.value || null;
  const packageSvc = packageId ? services.find(s => String(s.id) === String(packageId)) : null;

  const singles = Array.from(selectedSingles);
  const singlesSvcs = services.filter(s => singles.includes(s.id));

  if (!car || !vehicleClassId) {
    bookingError.textContent = "Bitte Fahrzeug und Fahrzeugklasse ausfüllen.";
    showStep(1);
    return;
  }
  if (!packageId && singles.length === 0) {
    bookingError.textContent = "Bitte mindestens ein Paket oder eine Einzelleistung auswählen.";
    showStep(2);
    return;
  }
  if (!bookingDateInput.value || !bookingTimeInput.value) {
    bookingError.textContent = "Bitte Datum und Uhrzeit wählen.";
    showStep(3);
    return;
  }

  const customerName = safeText(bookingCustomerNameInput.value);
  const customerEmail = safeText(bookingCustomerEmailInput.value);
  const customerPhone = safeText(bookingCustomerPhoneInput.value);
  const customerAddress = safeText(bookingCustomerAddressInput.value);
  const notes = safeText(bookingNotesInput.value);
  
if (!customerName || !customerEmail || !customerPhone) {
  bookingError.textContent = "Bitte Name, Telefon und E-Mail ausfüllen.";

  bookingCustomerNameInput.classList.toggle("is-invalid", !customerName);
  bookingCustomerEmailInput.classList.toggle("is-invalid", !customerEmail);
  bookingCustomerPhoneInput.classList.toggle("is-invalid", !customerPhone);

  return;
}


  const startAt = new Date(`${bookingDateInput.value}T${bookingTimeInput.value}:00`);
  if (isNaN(startAt.getTime())) {
    bookingError.textContent = "Ungültiger Termin.";
    return;
  }

  // duration + price (nur aus Services, keine Vehicle-Class-Delta hier; kann man später addieren)
  let durationMinutes = 0;
  let totalPriceCents = 0;

  const items = [];

  if (packageSvc) {
    durationMinutes += Number(packageSvc.duration_minutes || 0);
    totalPriceCents += Number(packageSvc.base_price_cents || 0);
items.push({ role: "package", kind: "package", id: packageSvc.id, name: packageSvc.name, price_cents: packageSvc.base_price_cents || 0 });
  }

  singlesSvcs.forEach((s) => {
    durationMinutes += Number(s.duration_minutes || 0);
    totalPriceCents += Number(s.base_price_cents || 0);
items.push({ role: "single", kind: "single", id: s.id, name: s.name, price_cents: s.base_price_cents || 0 });
  });
  
  // Code immer direkt vor Submit validieren (damit state aktuell ist)
  const subtotalCents = getCurrentSubtotalCents();
  await applyDiscountCode(detailerId, subtotalCents);

  const payload = {
    detailer_id: detailerId,

    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    customer_address: customerAddress || null,

    car: car,
    notes: notes || null,

    vehicle_class_id: vehicleClassId,
    vehicle_class_name: vehicleClassName || null,

    start_at: startAt.toISOString(),
    duration_minutes: durationMinutes,

    status: "confirmed",
    job_status: "planned",
    payment_status: "open",

    // legacy / kompatibilität
    service_name: packageSvc ? packageSvc.name : (singlesSvcs[0]?.name || "Auftrag"),
    service_price: (totalPriceCents / 100),
    total_price: (totalPriceCents / 100),

    // NEU: Rabattstate (wird serverseitig validiert und angewendet)
    applied_code: appliedDiscount?.applied_code || null,
    applied_kind: appliedDiscount?.applied_kind || null,

    // Items im selben Format wie deine App (service_id statt id)
    items: items.map((it) => ({
      role: it.role,
      service_id: it.id,
      name: it.name,
      price_cents: it.price_cents,
    })),
  };

  try {
    await apiPost(`/public/booking/request`, payload);

    const dateStr = new Date(payload.start_at).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

showThankYouPage({
  car,
  vehicleClassName,
  dateStr,
  timeStr: bookingTimeInput.value,
  startAtIso: payload.start_at,
  durationMinutes,
  totalPriceCents,
  packageName: packageSvc ? packageSvc.name : "",
  singlesNames: singlesSvcs.map(s => s.name),
});

    const submitBtn = bookingForm.querySelector("#public-submit");
    if (submitBtn) submitBtn.disabled = true;
  } catch (err) {
    console.error(err);
    publicError.style.display = "block";
    publicError.textContent = "Anfrage konnte nicht gesendet werden. Bitte später erneut versuchen.";
  }
});

init();












