/**
 * Content script for makerworld.com model pages.
 *
 * Answers one question from the popup: which print profile is currently
 * selected on the page? The tab URL alone is not enough — MakerWorld only
 * writes `#profileId-…` into the URL after the user clicks a different profile,
 * and the popup's view of the URL can lag a React re-render. Running inside the
 * page we see the live hash and the DOM.
 */

const PROFILE_HASH = /#profileId[-=](\d+)/i;

const toId = value => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const detectors = [
  ['hash', () => {
    const m = PROFILE_HASH.exec(location.hash);
    return m ? toId(m[1]) : null;
  }],

  ['dom', () => {
    // Candidates: anything explicitly marked selected/current, plus profile
    // links/buttons that carry an active-looking class name.
    const marked = document.querySelectorAll('[aria-selected="true"], [aria-current="true"]');
    for (const el of marked) {
      const id = idFromElement(el);
      if (id !== null) return id;
    }
    const candidates = document.querySelectorAll('a[href*="profileId"], [data-profile-id]');
    for (const el of candidates) {
      if (!/(^|\s)(active|selected|current)(\s|$|-)/i.test(el.className)) continue;
      const id = idFromElement(el);
      if (id !== null) return id;
    }
    return null;
  }],

  ['next_data', () => {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script) return null;
    let props;
    try {
      props = JSON.parse(script.textContent || '{}')?.props?.pageProps;
    } catch {
      return null;
    }
    return props ? findProfileId(props, 0) : null;
  }]
];

function idFromElement(el) {
  const own = el.getAttribute('data-profile-id');
  if (own) return toId(own);

  const m = PROFILE_HASH.exec(el.getAttribute('href') || '');
  if (m) return toId(m[1]);

  const holder = el.closest('[data-profile-id]');
  return holder ? toId(holder.getAttribute('data-profile-id')) : null;
}

/** Depth-limited search of page props for a numeric *profileId-like key. */
function findProfileId(node, depth) {
  if (!node || typeof node !== 'object' || depth > 2) return null;
  for (const [key, value] of Object.entries(node)) {
    if (/profileid$/i.test(key) && typeof value === 'number') return toId(value);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findProfileId(value, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'getSelectedProfile') return;
  for (const [source, detect] of detectors) {
    const profileId = detect();
    if (profileId !== null) {
      sendResponse({ profileId, source });
      return;
    }
  }
  sendResponse({ profileId: null, source: 'none' });
});
