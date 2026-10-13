/**
 * In-page entry points on makerworld.com.
 *
 * Two kinds of button, both opening the extension's own picker (popup.html in
 * embed mode) as an in-page iframe panel instead of the toolbar popup:
 *   - a small round icon over every model card (search, home, user pages);
 *   - an "Import to Bambuddy" button under the native "Open in Bambu Studio"
 *     control on model pages.
 *
 * Loaded after shared.js and content.js in the same isolated world, so
 * STORAGE_KEYS, getSettings(), modelIdFromUrl(), profileIdFromHash() and
 * detectSelectedProfile() are in scope. MakerWorld's selectors are best-effort
 * and every DOM access is guarded.
 */

(() => {
  const SETTING_KEY  = (typeof STORAGE_KEYS !== 'undefined' && STORAGE_KEYS.PAGE_BUTTONS) || 'pageButtons';
  const CARD_MARK    = 'data-bambuddy-import';        // "1" on cards, "native" on the Studio button
  const HOST_MARK    = 'data-bambuddy-import-host';
  const BTN_MARK     = 'data-bambuddy-import-btn';
  const POS_MARK     = 'data-bambuddy-import-pos';
  const PANEL_ID     = 'bambuddy-import-panel';
  const PANEL_WIDTH  = 360;
  const PANEL_HEIGHT = 240;
  const PANEL_GAP    = 8;
  const SCAN_DELAY   = 100;
  const MAX_PENDING  = 50;

  const CARD_SELECTOR  = '.js-design-card, [class*="design-card"]';
  const MODEL_LINK     = 'a[href*="/models/"]';
  const STUDIO_TEXT    = /^\s*open in bambu studio\s*$/i;
  const STUDIO_CONTAIN = /open in bambu studio/i;
  const ICON_URL       = chrome.runtime.getURL('icons/icon32.png');

  const CARD_CSS = `
    button {
      all: initial;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(27, 27, 31, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      cursor: pointer;
      transition: border-color .12s, background .12s;
    }
    button:hover {
      background: rgba(27, 27, 31, 0.95);
      border-color: #1db954;
    }
    img { width: 18px; height: 18px; display: block; pointer-events: none; }
  `;

  const PANEL_CSS = `
    iframe {
      border: 0;
      display: block;
      width: ${PANEL_WIDTH}px;
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      background: #1b1b1f;
    }
  `;

  let active        = false;
  let observer      = null;
  let scanTimer     = null;
  let fullScan      = true;
  let pendingRoots  = new Set();
  let lastHref      = location.href;
  let panel         = null;           // { host, iframe, anchor, height, cleanup }
  const prefetched  = new Set();

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function pageModelUrl(card) {
    let a = null;
    if (card.matches?.(MODEL_LINK)) a = card;
    else a = card.querySelector?.(MODEL_LINK) ?? card.closest?.(MODEL_LINK);
    if (!a) return null;
    const url = a.href;
    const id = modelIdFromUrl(url);
    if (id === null) return null;
    // A container listing several models (the fallback selector can hit one)
    // is not a card.
    for (const other of card.querySelectorAll?.(MODEL_LINK) ?? []) {
      const otherId = modelIdFromUrl(other.href);
      if (otherId !== null && otherId !== id) return null;
    }
    return url;
  }

  function prefetch(url) {
    const id = modelIdFromUrl(url);
    if (id === null || prefetched.has(id)) return;
    prefetched.add(id);
    chrome.runtime.sendMessage({ action: 'resolve', url }).catch(() => {});
  }

  // ─── Card buttons ──────────────────────────────────────────────────────────

  function injectCard(card) {
    if (!(card instanceof Element) || card.hasAttribute(CARD_MARK)) return;
    // Nested matches (e.g. .design-card-title inside .js-design-card) get no
    // button of their own.
    if (card.parentElement?.closest(CARD_SELECTOR)) return;
    const url = pageModelUrl(card);
    if (!url) return;
    card.setAttribute(CARD_MARK, '1');

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
      card.setAttribute(POS_MARK, '1');
    }

    const host = document.createElement('div');
    host.setAttribute(HOST_MARK, '1');
    host.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5;line-height:0;';
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CARD_CSS;

    const button = document.createElement('button');
    button.type  = 'button';
    button.title = 'Import to Bambuddy';
    const img = document.createElement('img');
    img.src = ICON_URL;
    img.width = 18;
    img.height = 18;
    img.alt = '';
    button.appendChild(img);

    // Cards are anchors with React handlers: swallow the whole gesture so the
    // page neither navigates nor registers a card click.
    const swallow = e => e.stopPropagation();
    button.addEventListener('pointerdown', swallow);
    button.addEventListener('mousedown', swallow);
    button.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      togglePanel(button, { url, profileId: null });
    });
    button.addEventListener('pointerenter', () => prefetch(url));

    root.append(style, button);
    card.appendChild(host);
  }

  function scanCards(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches(CARD_SELECTOR)) injectCard(root);
    for (const card of root.querySelectorAll(CARD_SELECTOR)) injectCard(card);
  }

  function removeCards() {
    for (const host of document.querySelectorAll(`[${HOST_MARK}]`)) host.remove();
    for (const card of document.querySelectorAll(`[${CARD_MARK}="1"]`)) {
      card.removeAttribute(CARD_MARK);
      if (card.hasAttribute(POS_MARK)) {
        card.style.position = '';
        card.removeAttribute(POS_MARK);
      }
    }
  }

  // ─── Model page button ─────────────────────────────────────────────────────

  function findStudioButton() {
    const matches = [];
    for (const el of document.querySelectorAll('button, a')) {
      if (el.hasAttribute(BTN_MARK)) continue;
      const text = el.textContent ?? '';
      if (!STUDIO_CONTAIN.test(text)) continue;
      if (STUDIO_TEXT.test(text) || (el.innerText ?? '').trim().length < 40) matches.push(el);
    }
    // Prefer the innermost match: a wrapping <a> around the real button also
    // carries the text.
    return matches.find(el => !matches.some(m => m !== el && el.contains(m))) ?? null;
  }

  function ensureModelButton() {
    if (modelIdFromUrl(location.href) === null) {
      removeModelButton();
      return;
    }
    if (document.querySelector(`[${BTN_MARK}]`)) return;

    const native = findStudioButton();
    if (!native) return;
    native.setAttribute(CARD_MARK, 'native');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = native.className;
    button.setAttribute(BTN_MARK, '1');
    const img = document.createElement('img');
    img.src = ICON_URL;
    img.width = 18;
    img.height = 18;
    img.alt = '';
    img.style.cssText = 'margin-right:8px;vertical-align:middle;';
    button.append(img, document.createTextNode('Import to Bambuddy'));

    const nativeWidth = native.getBoundingClientRect?.().width ?? 0;
    button.style.width = nativeWidth > 0 ? `${Math.round(nativeWidth)}px` : '100%';

    const wrapper = document.createElement('div');
    wrapper.setAttribute(HOST_MARK, 'model');
    wrapper.style.marginTop = '8px';
    wrapper.appendChild(button);

    button.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const detected = typeof detectSelectedProfile === 'function' ? detectSelectedProfile().profileId : null;
      togglePanel(button, {
        url:       location.href,
        profileId: detected ?? profileIdFromHash(location.href)
      });
    });

    const parent = native.parentElement;
    if (!parent || parent === document.body) native.insertAdjacentElement('afterend', wrapper);
    else parent.insertAdjacentElement('afterend', wrapper);
  }

  function removeModelButton() {
    for (const el of document.querySelectorAll(`[${BTN_MARK}]`)) {
      const wrapper = el.parentElement;
      if (wrapper?.getAttribute(HOST_MARK) === 'model') wrapper.remove();
      else el.remove();
    }
    for (const el of document.querySelectorAll(`[${CARD_MARK}="native"]`)) el.removeAttribute(CARD_MARK);
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────

  function togglePanel(anchor, params) {
    if (panel && panel.anchor === anchor) {
      closePanel();
      return;
    }
    openPanel(anchor, params);
  }

  function openPanel(anchor, { url, profileId }) {
    closePanel();

    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = `position:fixed;top:0;left:0;z-index:2147483647;width:${PANEL_WIDTH}px;`;
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', '');
    iframe.style.height = `${PANEL_HEIGHT}px`;
    let src = `${chrome.runtime.getURL('popup.html')}?embed=1&url=${encodeURIComponent(url)}`;
    if (profileId) src += `&profile=${encodeURIComponent(profileId)}`;
    iframe.src = src;
    iframe.addEventListener('load', () => {
      try { iframe.contentWindow?.focus(); } catch { /* cross-origin focus refused */ }
    });

    root.append(style, iframe);
    // documentElement, not body: Next.js re-renders can replace body children.
    document.documentElement.appendChild(host);

    const onMessage = event => {
      if (!panel || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'bambuddy-import') return;
      if (data.type === 'height' && Number.isFinite(data.height)) {
        panel.height = Math.min(Math.max(Math.round(data.height), 120), window.innerHeight - 16);
        iframe.style.height = `${panel.height}px`;
        positionPanel();
      } else if (data.type === 'close') {
        closePanel();
      }
    };
    const onPointerDown = event => {
      const path = event.composedPath();
      if (path.includes(host) || path.includes(anchor)) return;
      closePanel();
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') closePanel();
    };
    const onPopState = () => closePanel();
    const onReposition = () => positionPanel();

    window.addEventListener('message', onMessage);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('scroll', onReposition, { capture: true, passive: true });
    window.addEventListener('resize', onReposition);

    panel = {
      host,
      iframe,
      anchor,
      height: PANEL_HEIGHT,
      cleanup() {
        window.removeEventListener('message', onMessage);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('scroll', onReposition, { capture: true });
        window.removeEventListener('resize', onReposition);
      }
    };
    positionPanel();
  }

  function positionPanel() {
    if (!panel) return;
    const { host, anchor, height } = panel;
    if (!anchor.isConnected) {
      closePanel();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const maxLeft = window.innerWidth  - PANEL_WIDTH - PANEL_GAP;
    const maxTop  = window.innerHeight - height - PANEL_GAP;

    let top = rect.bottom + PANEL_GAP;
    if (top + height + PANEL_GAP > window.innerHeight) top = rect.top - height - PANEL_GAP;
    let left = rect.right - PANEL_WIDTH;

    left = Math.min(Math.max(left, PANEL_GAP), Math.max(PANEL_GAP, maxLeft));
    top  = Math.min(Math.max(top,  PANEL_GAP), Math.max(PANEL_GAP, maxTop));

    host.style.left = `${Math.round(left)}px`;
    host.style.top  = `${Math.round(top)}px`;
  }

  function closePanel() {
    if (!panel) return;
    const current = panel;
    panel = null;
    current.cleanup();
    current.host.remove();
  }

  // ─── Scanning ──────────────────────────────────────────────────────────────

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      tick();
    }, SCAN_DELAY);
  }

  function tick() {
    if (!active) return;

    if (location.href !== lastHref) {
      const sameModel = modelIdFromUrl(location.href) !== null
        && modelIdFromUrl(location.href) === modelIdFromUrl(lastHref);
      lastHref = location.href;
      closePanel();
      if (!sameModel) removeModelButton();
      fullScan = true;
    }

    if (fullScan) {
      scanCards(document);
    } else {
      for (const root of pendingRoots) if (root.isConnected) scanCards(root);
    }
    fullScan = false;
    pendingRoots = new Set();

    ensureModelButton();
  }

  function onMutations(mutations) {
    if (!fullScan) {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.hasAttribute?.(HOST_MARK) || node.id === PANEL_ID) continue;
          pendingRoots.add(node);
          if (pendingRoots.size > MAX_PENDING) {
            fullScan = true;
            pendingRoots = new Set();
            break;
          }
        }
        if (fullScan) break;
      }
    }
    scheduleScan();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  function start() {
    if (active) return;
    active   = true;
    fullScan = true;
    lastHref = location.href;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    tick();
  }

  function stop() {
    if (!active) return;
    active = false;
    observer?.disconnect();
    observer = null;
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    pendingRoots = new Set();
    closePanel();
    removeCards();
    removeModelButton();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(SETTING_KEY in changes)) return;
    if (changes[SETTING_KEY].newValue !== false) start();
    else stop();
  });

  getSettings()
    .then(settings => { if (settings[SETTING_KEY] !== false) start(); })
    .catch(() => start());
})();
