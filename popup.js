// ── Defaults ──────────────────────────────────────
const DEFAULTS = {
  enabled: true,
  claudeEnabled: true,
  customEnabled: false,
  customSites: [],
  forceTextAlignRight: true,
  improveArabicFont: true,
  targetInputsOnly: false,
  lang: "ar"
};

const BOOL_FIELDS = [
  "enabled", "claudeEnabled", "customEnabled",
  "forceTextAlignRight", "improveArabicFont", "targetInputsOnly"
];

// ── Translations ───────────────────────────────────
const I18N = {
  ar: {
    subtitle:                  "مساعد الكتابة العربية",
    "lbl-enabled":             "تفعيل الإضافة",
    "lbl-enabled-sub":         "تطبيق RTL على الصفحات",
    "lbl-sites":               "المواقع",
    "lbl-options":             "الخيارات",
    "lbl-claudeEnabled":       "تفعيل على Claude",
    "lbl-customEnabled":       "تفعيل مواقع مخصصة",
    "lbl-forceTextAlignRight": "محاذاة النص لليمين",
    "lbl-improveArabicFont":   "تحسين الخط العربي",
    "lbl-targetInputsOnly":    "فقط حقول الإدخال",
    "lbl-credit-by":           "تم التطوير بواسطة",
    "lbl-credit-name":         "خالد",
    sitesPlaceholder:          "example.com",
    statusOn:                  "نشط",
    statusOff:                 "متوقف",
    empty:                     "لا توجد مواقع مضافة"
  },
  en: {
    subtitle:                  "Arabic RTL Assistant",
    "lbl-enabled":             "Enable Extension",
    "lbl-enabled-sub":         "Apply RTL to pages",
    "lbl-sites":               "Sites",
    "lbl-options":             "Options",
    "lbl-claudeEnabled":       "Enable on Claude",
    "lbl-customEnabled":       "Enable custom sites",
    "lbl-forceTextAlignRight": "Force right alignment",
    "lbl-improveArabicFont":   "Improve Arabic font",
    "lbl-targetInputsOnly":    "Apply only to inputs",
    "lbl-credit-by":           "Developed by",
    "lbl-credit-name":         "Khalid",
    sitesPlaceholder:          "example.com",
    statusOn:                  "Active",
    statusOff:                 "Disabled",
    empty:                     "No sites added yet"
  }
};

// ── State ──────────────────────────────────────────
let currentLang = "ar";
let customSites  = [];

// ── Storage helpers ────────────────────────────────
function isExt() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync;
}

async function sGet(defaults) {
  if (isExt()) return await chrome.storage.sync.get(defaults);
  const out = {};
  Object.keys(defaults).forEach(k => {
    try {
      const raw = localStorage.getItem("rtl_" + k);
      out[k] = raw !== null ? JSON.parse(raw) : defaults[k];
    } catch (e) { out[k] = defaults[k]; }
  });
  return out;
}

async function sSet(obj) {
  if (isExt()) { await chrome.storage.sync.set(obj); return; }
  Object.keys(obj).forEach(k => {
    localStorage.setItem("rtl_" + k, JSON.stringify(obj[k]));
  });
}

// ── DOM helper ────────────────────────────────────
function el(id) { return document.getElementById(id); }

// ── Render custom sites list ───────────────────────
function renderSites() {
  const list = el("sitesList");
  list.innerHTML = "";

  if (customSites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sites-empty";
    empty.textContent = I18N[currentLang].empty;
    list.appendChild(empty);
    return;
  }

  customSites.forEach((site, i) => {
    const row  = document.createElement("div");
    row.className = "site-tag";

    const span = document.createElement("span");
    span.textContent = site;

    const btn  = document.createElement("button");
    btn.className = "site-tag-remove";
    btn.textContent = "✕";
    btn.setAttribute("aria-label", "remove");
    btn.addEventListener("click", () => { removeSite(i); });

    row.appendChild(span);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function addSite() {
  const input = el("siteInput");
  const val = input.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!val || customSites.includes(val)) { input.value = ""; return; }
  customSites.push(val);
  renderSites();
  input.value = "";
  save();
}

function removeSite(i) {
  customSites.splice(i, 1);
  renderSites();
  save();
}

// ── Custom panel open/close ────────────────────────
function updateCustomPanel() {
  el("customPanel").classList.toggle("open", el("customEnabled").checked);
}

// ── Status bar UI ──────────────────────────────────
function updateStatusUI() {
  const on = el("enabled").checked;
  const t  = I18N[currentLang];
  el("statusDot").className = "dot" + (on ? " on" : "");
  el("statusText").textContent = on ? t.statusOn : t.statusOff;
  el("masterSection").classList.toggle("active", on);
  el("container").classList.toggle("disabled", !on);
}

// ── Apply translations ─────────────────────────────
const TEXT_KEYS = [
  "subtitle", "lbl-enabled", "lbl-enabled-sub", "lbl-sites", "lbl-options",
  "lbl-claudeEnabled", "lbl-customEnabled", "lbl-forceTextAlignRight",
  "lbl-improveArabicFont", "lbl-targetInputsOnly", "lbl-credit-by", "lbl-credit-name"
];

function applyI18n(lang) {
  const t = I18N[lang];
  TEXT_KEYS.forEach(key => {
    const node = el(key);
    if (node) node.textContent = t[key];
  });
  el("siteInput").placeholder = t.sitesPlaceholder;
  renderSites();
  updateStatusUI();
}

// ── Set language ───────────────────────────────────
function setLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir  = lang === "ar" ? "rtl" : "ltr";
  el("btn-ar").classList.toggle("active", lang === "ar");
  el("btn-en").classList.toggle("active", lang === "en");
  applyI18n(lang);
  save();
}

// ── Save ───────────────────────────────────────────
async function save() {
  const obj = { lang: currentLang, customSites: [...customSites] };
  BOOL_FIELDS.forEach(f => {
    const node = el(f);
    if (node) obj[f] = node.checked;
  });
  await sSet(obj);
}

// ── Load ───────────────────────────────────────────
async function load() {
  const s = await sGet(DEFAULTS);

  BOOL_FIELDS.forEach(f => {
    const node = el(f);
    if (node) node.checked = Boolean(s[f]);
  });

  customSites = Array.isArray(s.customSites) ? [...s.customSites] : [];
  renderSites();

  if (s.customEnabled) el("customPanel").classList.add("open");

  currentLang = s.lang || "ar";
  document.documentElement.lang = currentLang;
  document.documentElement.dir  = currentLang === "ar" ? "rtl" : "ltr";
  el("btn-ar").classList.toggle("active", currentLang === "ar");
  el("btn-en").classList.toggle("active", currentLang === "en");
  applyI18n(currentLang);
}

// ── Bind all events (zero inline handlers) ────────
function bindEvents() {
  // Language
  el("btn-ar").addEventListener("click", () => setLang("ar"));
  el("btn-en").addEventListener("click", () => setLang("en"));

  // Master row click
  el("masterSection").addEventListener("click", (e) => {
    if (e.target.closest(".toggle")) return;
    el("enabled").checked = !el("enabled").checked;
    updateStatusUI();
    save();
  });
  el("enabled").addEventListener("change", () => { updateStatusUI(); save(); });

  // Checkboxes + card clicks
  ["claudeEnabled", "customEnabled", "forceTextAlignRight", "improveArabicFont", "targetInputsOnly"]
    .forEach(fieldId => {
      const card     = el("card-" + fieldId);
      const checkbox = el(fieldId);
      if (!card || !checkbox) return;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".toggle")) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      });

      checkbox.addEventListener("change", () => {
        if (fieldId === "customEnabled") updateCustomPanel();
        save();
      });
    });

  // Add site
  el("addSiteBtn").addEventListener("click", addSite);
  el("siteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addSite(); });
}

// ── Init ───────────────────────────────────────────
bindEvents();
load();