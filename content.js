/* ══════════════════════════════════════════════════════════════════
   RTL Helper — content.js  (v2.0.0)
   
   FULL REWRITE — fixes all issues from v1.x:
   
   Problem with v1.x:
   • Applied `direction: rtl` via CSS to elements matching broad
     selectors like [class*="content"], [class*="message"].
   • These selectors hit layout containers in Claude's React tree,
     flipping the sidebar, header, and breaking the ProseMirror
     editor (which uses flexbox internally).
   • MutationObserver on documentElement childList fired on every
     keystroke, causing repeated DOM thrash and input erasure.

   v2.0.0 approach:
   • NO `direction: rtl` in CSS anywhere. Direction is set per-element
     via the native HTML `dir="auto"` attribute, applied only to
     text-content tags (p, li, h1–h6, blockquote, td, etc.).
   • `dir="auto"` lets the browser pick direction from the first
     strong character in each element — the canonical, layout-safe
     way to support bidirectional text.
   • Layout-sensitive elements (flexbox containers, the sidebar,
     ProseMirror, contenteditable, inputs, code blocks) are never
     touched.
   • MutationObserver is debounced (300ms) AND skips mutations that
     happen inside editable surfaces — typing in Claude no longer
     triggers any work in the extension.
══════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__khalidRTLLoaded) return;
  window.__khalidRTLLoaded = true;

  /* Elements we must never look inside */
  const SKIP_INSIDE =
    '.ProseMirror, [contenteditable], textarea, input, ' +
    'code, pre, kbd, samp, script, style, svg, ' +
    '[data-rtl-helper-skip]';

  /* Text-content tags we tag with dir="auto" */
  const TEXT_TAGS =
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, ' +
    'td, th, dd, dt, figcaption, summary';

  const MARK_ATTR  = 'data-khalid-dir';
  const DEBOUNCE_MS = 300;

  let settings   = null;
  let observer   = null;
  let scanTimer  = null;

  /* ─────────────────────────────────────
     Settings & activation
  ───────────────────────────────────── */
  async function loadSettings() {
    try {
      settings = await chrome.storage.sync.get([
        'enabled',
        'claudeEnabled',
        'customEnabled',
        'customSites',
        'forceTextAlignRight',
        'improveArabicFont',
        'targetInputsOnly'
      ]);
    } catch (_) {
      settings = {};
    }
  }

  function isActive() {
    if (!settings || !settings.enabled) return false;
    const host = location.hostname;
    if (host.includes('claude.ai')) {
      return settings.claudeEnabled !== false;
    }
    if (settings.customEnabled) {
      const sites = Array.isArray(settings.customSites) ? settings.customSites : [];
      return sites.some(p => p && host.includes(p));
    }
    return false;
  }

  /* ─────────────────────────────────────
     Tag / untag text elements with dir="auto"
     This is the heart of the new approach.
  ───────────────────────────────────── */
  function tagTextElements() {
    if (!document.body) return;
    const els = document.body.querySelectorAll(TEXT_TAGS);
    for (const el of els) {
      if (el.hasAttribute(MARK_ATTR)) continue;
      if (el.hasAttribute('dir'))     continue;  // respect existing dir
      if (el.closest(SKIP_INSIDE))    continue;
      el.setAttribute('dir', 'auto');
      el.setAttribute(MARK_ATTR, '1');
    }
  }

  function untagTextElements() {
    if (!document.body) return;
    document.body.querySelectorAll(`[${MARK_ATTR}]`).forEach(el => {
      el.removeAttribute('dir');
      el.removeAttribute(MARK_ATTR);
    });
  }

  /* ─────────────────────────────────────
     Body marker classes (for CSS hooks)
     None of these apply `direction: rtl`.
     They only enable optional styles (font, text-align).
  ───────────────────────────────────── */
  const BODY_CLASSES = [
    'khalid-active',
    'khalid-force-right',
    'khalid-arabic-font',
    'khalid-inputs-only'
  ];

  function applyBodyClasses() {
    if (!document.body) return;
    const active = isActive();
    const list   = document.body.classList;

    const desired = {
      'khalid-active':       active,
      'khalid-force-right':  active && !!settings.forceTextAlignRight,
      'khalid-arabic-font':  active && !!settings.improveArabicFont,
      'khalid-inputs-only':  active && !!settings.targetInputsOnly
    };

    // Idempotent: only mutate if state differs.
    for (const cls of BODY_CLASSES) {
      const want = desired[cls];
      const has  = list.contains(cls);
      if (want && !has)      list.add(cls);
      else if (!want && has) list.remove(cls);
    }
  }

  function fullUpdate() {
    if (isActive()) tagTextElements();
    else            untagTextElements();
    applyBodyClasses();
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (isActive()) tagTextElements();
    }, DEBOUNCE_MS);
  }

  /* ─────────────────────────────────────
     Observer
     - childList only (no characterData, no attributes)
     - subtree on body so we catch new messages in Claude
     - skips any mutation whose target is inside an editor
       → typing in the input never schedules work
     - debounced 300ms
  ───────────────────────────────────── */
  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
        const tgt = m.target;
        if (tgt && tgt.nodeType === 1 && tgt.closest && tgt.closest(SKIP_INSIDE)) {
          continue; // ignore mutations inside editable surfaces
        }
        scheduleScan();
        return;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree:   true
    });
  }

  /* ─────────────────────────────────────
     Boot
  ───────────────────────────────────── */
  async function init() {
    if (!document.body) {
      requestAnimationFrame(init);
      return;
    }
    await loadSettings();
    fullUpdate();
    startObserver();
  }

  init();

  chrome.storage.onChanged.addListener(async () => {
    await loadSettings();
    fullUpdate();
  });

  window.addEventListener('beforeunload', () => {
    if (observer)  observer.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
  });
})();
