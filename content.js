(async function () {
  if (window.__khalidRTLLoaded) return;
  window.__khalidRTLLoaded = true;

  async function getSettings() {
    return await chrome.storage.sync.get([
      "enabled",
      "claudeEnabled",
      "customEnabled",
      "customSites",
      "forceTextAlignRight",
      "improveArabicFont",
      "targetInputsOnly"
    ]);
  }

  function applyRTL(settings) {
    if (!document.body) return;
    document.body.classList.add("khalid-rtl");
    document.body.classList.toggle("khalid-force-right", settings.forceTextAlignRight);
    document.body.classList.toggle("khalid-arabic-font", settings.improveArabicFont);
    document.body.classList.toggle("khalid-inputs-only", settings.targetInputsOnly);
  }

  function removeRTL() {
    if (!document.body) return;
    document.body.classList.remove(
      "khalid-rtl", "khalid-force-right", "khalid-arabic-font", "khalid-inputs-only"
    );
  }

  async function run() {
    const settings = await getSettings();
    const host = location.hostname;

    if (!settings.enabled) { removeRTL(); return; }

    // Claude — independent toggle
    if (host.includes("claude.ai")) {
      if (settings.claudeEnabled) applyRTL(settings);
      else removeRTL();
      return;
    }

    // Custom sites — array support, independent of Claude
    if (settings.customEnabled) {
      const sites = Array.isArray(settings.customSites) ? settings.customSites : [];
      const matched = sites.some(pattern => pattern && host.includes(pattern));
      if (matched) { applyRTL(settings); return; }
      removeRTL();
      return;
    }

    removeRTL();
  }

  run();

  new MutationObserver(() => run()).observe(document.documentElement, { childList: true });
  chrome.storage.onChanged.addListener(() => run());
})();