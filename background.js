const DEFAULT_SETTINGS = {
  enabled: true,
  claudeEnabled: true,
  customEnabled: false,
  customSites: [],
  forceTextAlignRight: true,
  improveArabicFont: true,
  targetInputsOnly: false,
  lang: "ar"
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get();
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  await chrome.storage.sync.set(merged);
});