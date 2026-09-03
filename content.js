/* ══════════════════════════════════════════════════════════════════
   RTL Helper — content.js  (v2.1.0)

   Applies RTL only to Arabic prose blocks inside the page's primary
   content. Technical fragments are isolated as LTR, and editable
   surfaces are handled separately so page layout is never flipped.
══════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__khalidRTLLoaded) return;
  window.__khalidRTLLoaded = true;

  const DEFAULT_SETTINGS = {
    enabled: true,
    claudeEnabled: true,
    chatgptEnabled: true,
    customEnabled: false,
    customSites: [],
    forceTextAlignRight: true,
    improveArabicFont: true,
    targetInputsOnly: false
  };

  const OUTPUT_SELECTOR =
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, ' +
    'td, th, dd, dt, figcaption, summary';

  const LEAF_MESSAGE_SELECTOR = [
    '[data-testid="user-message"]',
    '[data-message-author-role] [class~="whitespace-pre-wrap"]',
    '[data-testid^="conversation-turn-"] [class~="whitespace-pre-wrap"]'
  ].join(', ');

  const EDITABLE_SELECTOR = [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    'input:not([type])',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '.ProseMirror'
  ].join(', ');

  const PLATFORM_EDITOR_SELECTOR = [
    '#prompt-textarea',
    '.ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable=""]',
    'main textarea',
    'main [contenteditable="true"][role="textbox"]',
    'main [contenteditable=""][role="textbox"]'
  ].join(', ');

  const MESSAGE_ROOT_SELECTOR = [
    '[data-message-author-role]',
    'article[data-testid^="conversation-turn-"]',
    '[data-testid="assistant-message"]',
    '[data-testid="user-message"]',
    '[data-is-streaming]',
    '.font-claude-response-body',
    '.font-claude-response'
  ].join(', ');

  const UI_SKIP_SELECTOR = [
    'nav', 'aside', 'header', 'footer', 'form', 'button',
    '[role="button"]', '[role="menu"]', '[role="menubar"]',
    '[role="navigation"]', '[role="toolbar"]', '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-rtl-helper-skip]'
  ].join(', ');

  const PROSE_SKIP_SELECTOR = [
    EDITABLE_SELECTOR,
    'pre', 'code', 'kbd', 'samp', 'var', 'script', 'style',
    'svg', 'math', '[aria-hidden="true"]', '[data-rtl-helper-skip]'
  ].join(', ');

  const CODE_SELECTOR = 'pre, code, kbd, samp, var';
  const CODE_EDITOR_SELECTOR =
    '.monaco-editor, .CodeMirror, [role="code"], pre[data-language]';

  const OUTPUT_MARK = 'data-khalid-dir';
  const OUTPUT_ORIGINAL_DIR = 'data-khalid-original-dir';
  const CODE_MARK = 'data-khalid-code';
  const CODE_ORIGINAL_DIR = 'data-khalid-code-original-dir';
  const INPUT_MARK = 'data-khalid-input';
  const INPUT_ORIGINAL_DIR = 'data-khalid-input-original-dir';
  const NO_DIR = '__rtl_helper_no_dir__';
  const DEBOUNCE_MS = 250;
  const BODY_CLASSES = [
    'khalid-active',
    'khalid-force-right',
    'khalid-arabic-font',
    'khalid-inputs-only'
  ];

  let settings = { ...DEFAULT_SETTINGS };
  let observer = null;
  let scanTimer = null;
  const pendingScanRoots = new Set();
  let scopeReconcilePending = false;

  function isDomain(host, domain) {
    return host === domain || host.endsWith('.' + domain);
  }

  function normalizeDomain(value) {
    if (typeof value !== 'string') return '';
    let domain = value.trim().toLowerCase();
    if (!domain) return '';

    domain = domain.replace(/^\*\./, '');
    try {
      const url = new URL(
        /^[a-z][a-z\d+.-]*:\/\//i.test(domain) ? domain : 'https://' + domain
      );
      domain = url.hostname.toLowerCase();
    } catch (_) {
      domain = domain.split('/')[0].split(':')[0];
    }

    return domain.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
  }

  function currentSite() {
    const host = location.hostname.toLowerCase();
    if (isDomain(host, 'claude.ai')) return 'claude';
    if (isDomain(host, 'chatgpt.com') || isDomain(host, 'chat.openai.com')) {
      return 'chatgpt';
    }
    return 'custom';
  }

  function customSiteMatches() {
    const host = location.hostname.toLowerCase();
    const sites = Array.isArray(settings.customSites) ? settings.customSites : [];
    return sites.some(value => {
      const domain = normalizeDomain(value);
      return domain && isDomain(host, domain);
    });
  }

  function isActive() {
    if (!settings.enabled) return false;
    const site = currentSite();
    if (site === 'claude') return settings.claudeEnabled !== false;
    if (site === 'chatgpt') return settings.chatgptEnabled !== false;
    return !!settings.customEnabled && customSiteMatches();
  }

  async function loadSettings() {
    try {
      settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    } catch (_) {
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  function rememberAndSetDir(el, value, markAttr, originalAttr) {
    if (!el.hasAttribute(markAttr)) {
      el.setAttribute(
        originalAttr,
        el.hasAttribute('dir') ? el.getAttribute('dir') : NO_DIR
      );
      el.setAttribute(markAttr, '1');
    }
    if (el.getAttribute('dir') !== value) el.setAttribute('dir', value);
  }

  function restoreDir(el, markAttr, originalAttr) {
    const original = el.getAttribute(originalAttr);
    if (original === null || original === NO_DIR) el.removeAttribute('dir');
    else el.setAttribute('dir', original);
    el.removeAttribute(markAttr);
    el.removeAttribute(originalAttr);
  }

  function isInsideSkippedUi(el) {
    return !!el.closest(UI_SKIP_SELECTOR);
  }

  function collectProseText(el) {
    const chunks = [];
    let length = 0;
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest(PROSE_SKIP_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue && node.nodeValue.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      chunks.push(node.nodeValue);
      length += node.nodeValue.length;
      if (length >= 5000) break;
    }
    return chunks.join(' ').trim();
  }

  function countMatches(text, regex) {
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  function isArabicProse(text) {
    if (!text) return false;
    const arabicCount = countMatches(text, /\p{Script=Arabic}/gu);
    if (arabicCount === 0) return false;

    const latinCount = countMatches(text, /\p{Script=Latin}/gu);
    const firstStrong = text.match(/[\p{Script=Arabic}\p{Script=Latin}]/u);
    const startsArabic = !!firstStrong && /\p{Script=Arabic}/u.test(firstStrong[0]);

    // Arabic prose often starts with a filename or words such as "Step 1".
    // Excluding code above and using a ratio keeps those paragraphs RTL while
    // leaving genuinely English paragraphs unchanged.
    return startsArabic || arabicCount >= Math.max(2, latinCount * 0.6);
  }

  function hasDirectText(el) {
    return Array.from(el.childNodes).some(node =>
      node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()
    );
  }

  function getContentRoots() {
    if (currentSite() === 'custom') return document.body ? [document.body] : [];
    const mains = Array.from(document.querySelectorAll('main'));
    const semanticRoots = Array.from(document.querySelectorAll(MESSAGE_ROOT_SELECTOR));
    const roots = [...mains];
    semanticRoots.forEach(root => {
      if (!roots.some(existing => existing.contains(root))) roots.push(root);
    });

    // During an SPA mount, wait for main/semantic roots instead of scanning the
    // whole body (which would include the sidebar and page chrome).
    return roots.filter((root, index) =>
      !roots.some((other, otherIndex) =>
        otherIndex !== index && other !== root && other.contains(root)
      )
    );
  }

  function collectOutputCandidates(root) {
    const candidates = new Set();
    if (root.matches && root.matches(OUTPUT_SELECTOR)) candidates.add(root);
    root.querySelectorAll(OUTPUT_SELECTOR).forEach(el => candidates.add(el));

    const leafNodes = [];
    if (root.matches && root.matches(LEAF_MESSAGE_SELECTOR)) leafNodes.push(root);
    root.querySelectorAll(LEAF_MESSAGE_SELECTOR).forEach(el => leafNodes.push(el));
    leafNodes.forEach(el => {
      if (hasDirectText(el) && !el.querySelector(OUTPUT_SELECTOR)) candidates.add(el);
    });

    return candidates;
  }

  function markCodeInside(rtlBlock) {
    if (rtlBlock.matches(CODE_SELECTOR)) {
      rememberAndSetDir(rtlBlock, 'ltr', CODE_MARK, CODE_ORIGINAL_DIR);
    }
    rtlBlock.querySelectorAll(CODE_SELECTOR).forEach(el => {
      rememberAndSetDir(el, 'ltr', CODE_MARK, CODE_ORIGINAL_DIR);
    });
  }

  function elementsWithMark(roots, markAttr) {
    const elements = new Set();
    roots.forEach(root => {
      if (root.matches && root.matches(`[${markAttr}]`)) elements.add(root);
      root.querySelectorAll(`[${markAttr}]`).forEach(el => elements.add(el));
    });
    return elements;
  }

  function reconcileCodeMarks(roots) {
    elementsWithMark(roots, CODE_MARK).forEach(el => {
      if (!el.closest(`[${OUTPUT_MARK}]`)) {
        restoreDir(el, CODE_MARK, CODE_ORIGINAL_DIR);
      }
    });
  }

  function scanOutput(roots = getContentRoots(), fullScan = true) {
    if (!document.body) return;
    const seen = new Set();

    roots.forEach(root => {
      collectOutputCandidates(root).forEach(el => {
        seen.add(el);
        const shouldApply =
          !isInsideSkippedUi(el) &&
          !el.closest(EDITABLE_SELECTOR) &&
          isArabicProse(collectProseText(el));

        if (shouldApply) {
          rememberAndSetDir(el, 'rtl', OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
          markCodeInside(el);
        } else if (el.hasAttribute(OUTPUT_MARK)) {
          restoreDir(el, OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
        }
      });
    });

    const cleanupRoots = fullScan ? [document.body] : roots;
    elementsWithMark(cleanupRoots, OUTPUT_MARK).forEach(el => {
      if (!seen.has(el) || isInsideSkippedUi(el) || el.closest(EDITABLE_SELECTOR)) {
        restoreDir(el, OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
      }
    });
    reconcileCodeMarks(cleanupRoots);
  }

  function shouldSkipEditable(el) {
    return (
      !!el.closest(CODE_EDITOR_SELECTOR) ||
      !!el.closest(
        'nav, aside, [role="navigation"], [role="menu"], ' +
        '[role="dialog"], [aria-modal="true"], [data-rtl-helper-skip]'
      )
    );
  }

  function releaseOutputOwnership(el) {
    elementsWithMark([el], CODE_MARK).forEach(code => {
      restoreDir(code, CODE_MARK, CODE_ORIGINAL_DIR);
    });
    if (el.hasAttribute(OUTPUT_MARK)) {
      restoreDir(el, OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
    }
  }

  function scanInputs(
    roots = currentSite() === 'custom' ? getContentRoots() : [document.body],
    fullScan = true
  ) {
    if (!document.body) return;
    const seen = new Set();
    const inputSelector = currentSite() === 'custom'
      ? EDITABLE_SELECTOR
      : PLATFORM_EDITOR_SELECTOR;
    roots.forEach(root => {
      const editables = [];
      if (root.matches && root.matches(inputSelector)) editables.push(root);
      root.querySelectorAll(inputSelector).forEach(el => editables.push(el));
      editables.forEach(el => {
        if (shouldSkipEditable(el)) return;
        seen.add(el);
        releaseOutputOwnership(el);
        rememberAndSetDir(el, 'auto', INPUT_MARK, INPUT_ORIGINAL_DIR);
      });
    });

    const cleanupRoots = fullScan ? [document.body] : roots;
    elementsWithMark(cleanupRoots, INPUT_MARK).forEach(el => {
      if (!seen.has(el)) restoreDir(el, INPUT_MARK, INPUT_ORIGINAL_DIR);
    });
  }

  function clearMarks(markAttr, originalAttr) {
    if (!document.body) return;
    document.body.querySelectorAll(`[${markAttr}]`).forEach(el => {
      restoreDir(el, markAttr, originalAttr);
    });
  }

  function clearOutput() {
    clearMarks(CODE_MARK, CODE_ORIGINAL_DIR);
    clearMarks(OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
  }

  function clearInputs() {
    clearMarks(INPUT_MARK, INPUT_ORIGINAL_DIR);
  }

  function restoreHelperMarksInNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    elementsWithMark([node], CODE_MARK).forEach(el => {
      restoreDir(el, CODE_MARK, CODE_ORIGINAL_DIR);
    });
    // If an old version ever left both ownership markers on one element,
    // OUTPUT holds the earliest/original direction and must be restored last.
    elementsWithMark([node], INPUT_MARK).forEach(el => {
      restoreDir(el, INPUT_MARK, INPUT_ORIGINAL_DIR);
    });
    elementsWithMark([node], OUTPUT_MARK).forEach(el => {
      restoreDir(el, OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
    });
  }

  function applyBodyClasses() {
    if (!document.body) return;
    const active = isActive();
    const desired = {
      'khalid-active': active,
      'khalid-force-right': active && !!settings.forceTextAlignRight,
      'khalid-arabic-font': active && !!settings.improveArabicFont,
      'khalid-inputs-only': active && !!settings.targetInputsOnly
    };

    BODY_CLASSES.forEach(className => {
      document.body.classList.toggle(className, !!desired[className]);
    });
  }

  function fullUpdate() {
    applyBodyClasses();
    if (!isActive()) {
      clearOutput();
      clearInputs();
      return;
    }

    scanInputs();
    if (settings.targetInputsOnly) clearOutput();
    else scanOutput();
  }

  function isWithinContent(root) {
    if (
      currentSite() !== 'custom' &&
      root.matches(PLATFORM_EDITOR_SELECTOR)
    ) {
      return true;
    }
    return getContentRoots().some(contentRoot =>
      contentRoot === root || contentRoot.contains(root)
    );
  }

  function closestScanRoot(node) {
    const el = node && node.nodeType === Node.ELEMENT_NODE
      ? node
      : node && node.parentElement;
    if (!el) return null;
    const block = el.closest(`${OUTPUT_SELECTOR}, ${LEAF_MESSAGE_SELECTOR}`);
    return block || el;
  }

  function queueScanRoot(node) {
    const root = closestScanRoot(node);
    if (!root || !root.isConnected) return;
    if (!isWithinContent(root)) {
      if (currentSite() !== 'custom') {
        root.querySelectorAll(MESSAGE_ROOT_SELECTOR).forEach(messageRoot => {
          if (isWithinContent(messageRoot)) pendingScanRoots.add(messageRoot);
        });
        root.querySelectorAll(PLATFORM_EDITOR_SELECTOR).forEach(editor => {
          if (!shouldSkipEditable(editor)) pendingScanRoots.add(editor);
        });
      }
      return;
    }
    pendingScanRoots.add(root);
  }

  function compactPendingRoots() {
    const roots = Array.from(pendingScanRoots).filter(root =>
      root.isConnected && isWithinContent(root)
    );
    pendingScanRoots.clear();
    return roots.filter((root, index) =>
      !roots.some((other, otherIndex) =>
        otherIndex !== index && other !== root && other.contains(root)
      )
    );
  }

  function reconcileScopeMarks() {
    if (!document.body) return;
    const contentRoots = getContentRoots();
    const outputIsInScope = el => contentRoots.some(root =>
      root === el || root.contains(el)
    );

    document.body.querySelectorAll(`[${OUTPUT_MARK}]`).forEach(el => {
      const isCandidate =
        el.matches(OUTPUT_SELECTOR) || el.matches(LEAF_MESSAGE_SELECTOR);
      if (
        settings.targetInputsOnly ||
        !isCandidate ||
        !outputIsInScope(el) ||
        isInsideSkippedUi(el) ||
        el.closest(EDITABLE_SELECTOR)
      ) {
        restoreDir(el, OUTPUT_MARK, OUTPUT_ORIGINAL_DIR);
      }
    });
    reconcileCodeMarks([document.body]);

    const inputSelector = currentSite() === 'custom'
      ? EDITABLE_SELECTOR
      : PLATFORM_EDITOR_SELECTOR;
    document.body.querySelectorAll(`[${INPUT_MARK}]`).forEach(el => {
      if (!el.matches(inputSelector) || shouldSkipEditable(el)) {
        restoreDir(el, INPUT_MARK, INPUT_ORIGINAL_DIR);
      }
    });
  }

  function nodeHasHelperMark(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const selector = `[${OUTPUT_MARK}], [${CODE_MARK}], [${INPUT_MARK}]`;
    return node.matches(selector) || !!node.querySelector(selector);
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!isActive()) {
        clearOutput();
        clearInputs();
        pendingScanRoots.clear();
        scopeReconcilePending = false;
        return;
      }
      const roots = compactPendingRoots();
      if (roots.length > 0) {
        scanInputs(roots, false);
        if (!settings.targetInputsOnly) scanOutput(roots, false);
      }
      if (scopeReconcilePending) {
        scopeReconcilePending = false;
        reconcileScopeMarks();
      }
    }, DEBOUNCE_MS);
  }

  function mutationIsInsideEditor(mutation) {
    const target = mutation.target.nodeType === Node.ELEMENT_NODE
      ? mutation.target
      : mutation.target.parentElement;
    return !!target && !!target.closest(EDITABLE_SELECTOR);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          if (mutation.target === document.body && mutation.attributeName === 'class') {
            return;
          }
          scopeReconcilePending = true;
          queueScanRoot(mutation.target);
          return;
        }
        if (mutationIsInsideEditor(mutation)) return;
        if (mutation.type === 'characterData') {
          queueScanRoot(mutation.target);
          return;
        }
        if (mutation.type !== 'childList') return;
        if (mutation.removedNodes.length > 0) {
          scopeReconcilePending = true;
          queueScanRoot(mutation.target);
          mutation.removedNodes.forEach(node => {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (!node.isConnected || !isWithinContent(node))
            ) {
              restoreHelperMarksInNode(node);
            }
          });
        }
        mutation.addedNodes.forEach(node => {
          if (nodeHasHelperMark(node)) {
            scopeReconcilePending = true;
            if (!isActive() || settings.targetInputsOnly || !isWithinContent(node)) {
              restoreHelperMarksInNode(node);
            }
          }
          queueScanRoot(node);
        });
      });
      if (pendingScanRoots.size > 0 || scopeReconcilePending) scheduleScan();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'contenteditable', 'id', 'role'],
      childList: true,
      characterData: true,
      subtree: true
    });
  }

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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName && areaName !== 'sync') return;
    loadSettings().then(fullUpdate);
  });

  window.addEventListener('beforeunload', () => {
    if (observer) observer.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    pendingScanRoots.clear();
  });
})();
