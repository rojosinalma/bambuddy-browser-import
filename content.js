/**
 * Content script — runs on makerworld.com model pages.
 *
 * The popup can't reliably determine which profile is currently selected
 * from the tab URL alone because:
 *   1. On initial page load MakerWorld doesn't add #profileId-XXXXX to the URL
 *      (the hash only appears after the user explicitly clicks a different profile).
 *   2. chrome.tabs.query() returns the URL as of the last navigation — it may
 *      lag behind a React-router hash update by a render cycle.
 *
 * This script runs IN the page context, so it always has the live URL hash
 * plus direct DOM access to find the visually-selected profile card.
 */

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'getSelectedProfile') return;

  // ── Strategy 1: URL hash ──────────────────────────────────────────────────
  // Most reliable when the user has clicked a profile (updates URL).
  const hashMatch = window.location.hash.match(/#profileId[-=](\d+)/i);
  if (hashMatch) {
    sendResponse({ profileId: parseInt(hashMatch[1], 10), source: 'hash' });
    return;
  }

  // ── Strategy 2: DOM — find the selected profile card ─────────────────────
  // MakerWorld's React profile selector marks the active card with an
  // aria-selected attribute or a data-* attribute we can read.
  //
  // We probe multiple selector patterns defensively because MakerWorld's
  // class names are generated and may change between deployments.
  const profileIdFromDom = readSelectedProfileFromDom();
  if (profileIdFromDom !== null) {
    sendResponse({ profileId: profileIdFromDom, source: 'dom' });
    return;
  }

  // ── Strategy 3: Next.js page data ─────────────────────────────────────────
  // MakerWorld embeds initial page props in a <script id="__NEXT_DATA__"> tag.
  // This contains the selected variant/profile ID set by the server-side render.
  const profileIdFromNext = readProfileFromNextData();
  if (profileIdFromNext !== null) {
    sendResponse({ profileId: profileIdFromNext, source: 'next_data' });
    return;
  }

  sendResponse({ profileId: null, source: 'none' });
});

/** Scan the DOM for an active/selected profile card and extract its profile ID. */
function readSelectedProfileFromDom() {
  // Try aria-selected first (most semantic)
  const ariaSelected = document.querySelector('[aria-selected="true"]');
  if (ariaSelected) {
    const id = extractProfileIdFromElement(ariaSelected);
    if (id !== null) return id;
  }

  // MakerWorld renders each profile as an anchor or button; the active one
  // often carries a URL fragment we can parse.
  const anchors = document.querySelectorAll('a[href*="#profileId"], button[data-profile-id]');
  for (const el of anchors) {
    // Check for an "active" / "selected" state via inline styles or class names
    // that include common active-state keywords.
    const isActive = el.getAttribute('aria-current') === 'true'
      || el.getAttribute('aria-selected') === 'true'
      || /\bactive\b|\bselected\b|\bcurrent\b/.test(el.className);

    if (!isActive) continue;

    const id = extractProfileIdFromElement(el);
    if (id !== null) return id;
  }

  return null;
}

/** Extract a numeric profileId from an element's attributes or href. */
function extractProfileIdFromElement(el) {
  // data-profile-id attribute
  const dp = el.getAttribute('data-profile-id');
  if (dp) {
    const n = parseInt(dp, 10);
    if (!isNaN(n)) return n;
  }

  // href fragment:  href="#profileId-12345"
  const href = el.getAttribute('href') ?? '';
  const hrefMatch = href.match(/#profileId[-=](\d+)/i);
  if (hrefMatch) return parseInt(hrefMatch[1], 10);

  // Walk up to find a parent element with a profile-id hint
  const ancestor = el.closest('[data-profile-id]');
  if (ancestor) {
    const n = parseInt(ancestor.getAttribute('data-profile-id'), 10);
    if (!isNaN(n)) return n;
  }

  return null;
}

/** Read the profile ID embedded in Next.js's server-rendered page data. */
function readProfileFromNextData() {
  try {
    const nextEl = document.getElementById('__NEXT_DATA__');
    if (!nextEl) return null;

    const next = JSON.parse(nextEl.textContent ?? '');
    // MakerWorld's model page puts the current design under
    // props.pageProps.design or props.pageProps.designDetail
    const pp = next?.props?.pageProps;
    if (!pp) return null;

    // Look for a "profileId" or "selectedProfileId" field in page props
    for (const key of Object.keys(pp)) {
      const candidate = pp[key];
      if (typeof candidate === 'number' && /profile/i.test(key)) return candidate;
      if (candidate && typeof candidate === 'object') {
        // One level deeper (common for nested designDetail.profileId)
        const inner = candidate['profileId'] ?? candidate['selectedProfileId'];
        if (typeof inner === 'number') return inner;
      }
    }
  } catch { /* malformed JSON or unexpected shape */ }
  return null;
}
