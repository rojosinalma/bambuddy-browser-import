/**
 * Shared constants and helpers, loaded by background, popup and options.
 * Plain script (no modules) so it works in a Chrome service worker, a Firefox
 * event page and extension pages alike.
 */

const STORAGE_KEYS = {
  BAMBUDDY_URL:       'bambuddyUrl',
  API_KEY:            'apiKey',
  SHOW_OPEN_BTN:      'showOpenBtn',
  PAGE_BUTTONS:       'pageButtons',
  NOTIFY_ON_COMPLETE: 'notifyOnComplete',
  CONCURRENCY:        'importConcurrency',
  RESOLVE_TTL:        'resolveCacheTtl',
  RESOLVE_MAX:        'resolveCacheMax',
  LAST_FOLDER_ID:     'lastFolderId',
  TOP_OFF:            'collectionTopOff',
  TOP_OFF_CHECKS:     'collectionTopOffChecks'
};

const DEFAULTS = {
  [STORAGE_KEYS.SHOW_OPEN_BTN]:      true,
  [STORAGE_KEYS.PAGE_BUTTONS]:       true,
  [STORAGE_KEYS.NOTIFY_ON_COMPLETE]: true,
  [STORAGE_KEYS.CONCURRENCY]:        3,
  [STORAGE_KEYS.RESOLVE_TTL]:        300,
  [STORAGE_KEYS.RESOLVE_MAX]:        200,
  [STORAGE_KEYS.LAST_FOLDER_ID]:     null,
  [STORAGE_KEYS.TOP_OFF]:            true,
  [STORAGE_KEYS.TOP_OFF_CHECKS]:     2
};

const LIMITS = {
  CONCURRENCY:     { min: 1, max: 6 },
  RESOLVE_TTL:     { min: 30, max: 3600 },
  RESOLVE_MAX:     { min: 10, max: 1000 },
  TOP_OFF_CHECKS:  { min: 1, max: 4 }
};

/** Collection Top-off timing (not user settings — keeps MakerWorld gentle). */
const TOPOFF_TIMING = {
  BATCH_GAP_MS:  600,
  BACKOFF_MS:    20_000,
  JOB_POLL_MS:   400
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

/**
 * Query parameters the content script passes when it opens popup.html in an
 * iframe on a MakerWorld page: `?embed=1&url=<model URL>[&profile=<id>]`.
 * Touches `location` only when called, so the worker can still load this file.
 */
function embedParams() {
  const q = new URLSearchParams(location.search);
  const profile = parseInt(q.get('profile') ?? '', 10);
  return {
    embed:   q.get('embed') === '1',
    url:     q.get('url') || null,
    profile: profile > 0 ? profile : null
  };
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

function pickNum(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pickStr(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** Library file ids Bambuddy already has for this model (resolve membership). */
function alreadyImportedIds(resolveData) {
  const ids = resolveData?.already_imported_library_ids;
  return Array.isArray(ids) ? ids.filter(id => Number.isFinite(Number(id))).map(Number) : [];
}

/**
 * One plate for collection Top-off / one-click import: URL hint → isDefault
 * (highest rating) → first instance. Returns null when resolve has nothing usable.
 */
function pickDefaultPlate(resolveData, hintedProfileId = null) {
  const design = resolveData?.design ?? {};
  const instances = Array.isArray(design.instances) ? design.instances : [];
  const title = pickStr(design, 'title') || 'Default plate';

  if (instances.length === 0) {
    const modelId = pickNum(resolveData, 'model_id');
    if (modelId === null) return null;
    return { profileId: modelId, instanceId: modelId, name: title };
  }

  const plates = [];
  for (const inst of instances) {
    const instanceId = pickNum(inst, 'id');
    const profileId  = pickNum(inst, 'profileId');
    if (instanceId === null || profileId === null) continue;
    plates.push({
      profileId,
      instanceId,
      name:   pickStr(inst, 'title') || `Profile ${profileId}`,
      isDefault: inst.isDefault === true,
      rating: pickNum(inst, 'ratingScoreTotal', 'rating') ?? 0
    });
  }
  if (!plates.length) return null;

  if (hintedProfileId != null) {
    const hit = plates.find(p => p.profileId === hintedProfileId);
    if (hit) return { profileId: hit.profileId, instanceId: hit.instanceId, name: hit.name };
  }

  const defaults = plates.filter(p => p.isDefault);
  const pool = defaults.length ? defaults : plates;
  pool.sort((a, b) => b.rating - a.rating);
  const best = pool[0];
  return { profileId: best.profileId, instanceId: best.instanceId, name: best.name };
}
