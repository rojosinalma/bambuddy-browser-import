/**
 * Shared constants and helpers, loaded by background, popup and options.
 * Plain script (no modules) so it works in a Chrome service worker, a Firefox
 * event page and extension pages alike.
 */

const STORAGE_KEYS = {
  BAMBUDDY_URL:       'bambuddyUrl',
  API_KEY:            'apiKey',
  SHOW_OPEN_BTN:      'showOpenBtn',
  NOTIFY_ON_COMPLETE: 'notifyOnComplete',
  CONCURRENCY:        'importConcurrency',
  RESOLVE_TTL:        'resolveCacheTtl',
  LAST_FOLDER_ID:     'lastFolderId'
};

const DEFAULTS = {
  [STORAGE_KEYS.SHOW_OPEN_BTN]:      true,
  [STORAGE_KEYS.NOTIFY_ON_COMPLETE]: true,
  [STORAGE_KEYS.CONCURRENCY]:        3,
  [STORAGE_KEYS.RESOLVE_TTL]:        300,
  [STORAGE_KEYS.LAST_FOLDER_ID]:     null
};

const LIMITS = {
  CONCURRENCY: { min: 1, max: 6 },
  RESOLVE_TTL: { min: 30, max: 3600 }
};

/** Session-storage key prefixes (chrome.storage.session — cleared on browser exit). */
const SESSION = {
  RESOLVE: 'resolve:',   // + modelId → { ts, data }
  JOB:     'job:',       // + modelId → ImportJob
  FOLDERS: 'folders'     // { ts, tree }
};

/** Matches a MakerWorld model page URL and captures the numeric design id. */
const MODEL_URL_RE = /makerworld\.com\/[a-z-]+\/models\/(\d+)/i;

function modelIdFromUrl(url) {
  const m = MODEL_URL_RE.exec(url ?? '');
  return m ? parseInt(m[1], 10) : null;
}

function profileIdFromHash(url) {
  const m = /#profileId[-=](\d+)/i.exec(url ?? '');
  return m ? parseInt(m[1], 10) : null;
}

function clamp(n, { min, max }, fallback) {
  const v = parseInt(n, 10);
  if (isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return { ...DEFAULTS, ...stored };
}

/**
 * Request a downsized variant from MakerWorld's CDN. Covers are served at full
 * resolution (~1.3 MB each); the CDN honours `image_process=resize,w_N` and
 * returns a few KB instead. Leaves URLs alone if they already carry a query or
 * are not on the bblmw CDN.
 */
function thumbUrl(coverUrl, width) {
  if (!coverUrl) return '';
  try {
    const u = new URL(coverUrl);
    if (!/\.bblmw\.com$/i.test(u.hostname) || u.search) return coverUrl;
    u.search = `image_process=resize,w_${width}`;
    return u.toString();
  } catch {
    return coverUrl;
  }
}

/** Flatten the folder tree into [{ id, name, depth, disabled }] in display order. */
function flattenFolders(tree, depth = 0, out = []) {
  for (const f of tree ?? []) {
    out.push({
      id:       f.id,
      name:     f.name,
      depth,
      disabled: f.is_external === true && f.external_readonly === true
    });
    flattenFolders(f.children, depth + 1, out);
  }
  return out;
}
