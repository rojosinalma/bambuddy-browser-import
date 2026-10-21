/**
 * Background worker.
 *
 * Chrome runs this as an MV3 service worker (`background.service_worker`),
 * Firefox as an event page (`background.scripts`). Everything that must outlive
 * the popup lives here: Bambuddy API calls (also sidesteps CORS), the resolve
 * cache, the import queue and completion notifications.
 */

if (typeof importScripts === 'function') importScripts('shared.js');

// ─── Bambuddy API ────────────────────────────────────────────────────────────

async function bambuddyFetch(path, options = {}) {
  const settings = await getSettings();
  const bambuddyUrl = settings[STORAGE_KEYS.BAMBUDDY_URL];
  const apiKey      = settings[STORAGE_KEYS.API_KEY];

  if (!bambuddyUrl) throw new Error('UNCONFIGURED');

  const base = bambuddyUrl.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {})
  };

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers ?? {}) }
    });
  } catch (err) {
    // A TypeError "Failed to fetch" almost always means the host permission
    // for the Bambuddy origin has not been granted yet.
    if (err instanceof TypeError) {
      throw new Error(
        `Cannot reach Bambuddy at ${base}. ` +
        'If you just changed the URL, re-save Settings so the extension can request access.'
      );
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      // FastAPI 422 validation errors return detail as an array, not a string.
      const raw = body.detail ?? body.message;
      if (raw !== undefined && raw !== null) {
        detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      }
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }

  return response.json();
}

// ─── Session storage ─────────────────────────────────────────────────────────
// chrome.storage.session has a fixed quota (10 MB in Chrome). The resolve cache
// is the only part that grows with browsing, so it is what makes room when a
// write is refused.

async function sessionSet(items) {
  try {
    await chrome.storage.session.set(items);
  } catch (err) {
    const dropped = await pruneResolveCache({ all: true });
    if (dropped === 0) throw err;
    console.warn(`[bambuddy] session storage full (${err.message}); dropped ${dropped} cached models`);
    await chrome.storage.session.set(items);
  }
}

/** Remove expired `resolve:*` entries, or all of them. Returns how many went. */
async function pruneResolveCache({ all = false } = {}) {
  const ttlMs   = resolveTtlMs(await getSettings());
  const now     = Date.now();
  const entries = await chrome.storage.session.get(null);
  const doomed  = Object.keys(entries).filter(k =>
    k.startsWith(SESSION.RESOLVE) && (all || !(now - (entries[k]?.ts ?? 0) < ttlMs)));
  if (doomed.length) await chrome.storage.session.remove(doomed);
  return doomed.length;
}

// ─── Resolve cache ───────────────────────────────────────────────────────────
// Resolving a model costs two MakerWorld round-trips inside Bambuddy (~0.5 s).
// We resolve as soon as a model tab finishes loading so the popup opens with
// the data already in hand, and cache by model id for a short TTL.

const inflightResolves = new Map();

function resolveTtlMs(settings) {
  return clamp(settings[STORAGE_KEYS.RESOLVE_TTL], LIMITS.RESOLVE_TTL, DEFAULTS[STORAGE_KEYS.RESOLVE_TTL]) * 1000;
}

/** Best effort: a cache that cannot be written must not fail the resolve. */
async function cacheResolve(key, data) {
  try {
    await pruneResolveCache();
    await sessionSet({ [key]: { ts: Date.now(), data } });
  } catch (err) {
    console.warn('[bambuddy] resolve not cached:', err.message);
  }
}

async function resolveModel(url, { force = false } = {}) {
  const modelId = modelIdFromUrl(url);
  if (modelId === null) throw new Error('Not a MakerWorld model URL');

  const key = `${SESSION.RESOLVE}${modelId}`;
  if (!force) {
    const ttlMs  = resolveTtlMs(await getSettings());
    const cached = (await chrome.storage.session.get(key))[key];
    if (cached && Date.now() - cached.ts < ttlMs) return { ...cached.data, _cached: true };
  }

  if (inflightResolves.has(modelId)) return inflightResolves.get(modelId);

  const p = (async () => {
    try {
      // Strip the hash: the profile hint is derived client-side, and a
      // hash-free URL keeps one cache entry per model.
      const cleanUrl = url.split('#')[0];
      const data = await bambuddyFetch('/api/v1/makerworld/resolve', {
        method: 'POST',
        body:   JSON.stringify({ url: cleanUrl })
      });
      await cacheResolve(key, data);
      return data;
    } finally {
      inflightResolves.delete(modelId);
    }
  })();
  inflightResolves.set(modelId, p);
  return p;
}

async function prefetchResolve(url) {
  try {
    const { [STORAGE_KEYS.BAMBUDDY_URL]: configured } = await getSettings();
    if (!configured) return;
    await resolveModel(url);
  } catch (err) {
    console.debug('[bambuddy] prefetch skipped:', err.message);
  }
}

// ─── Folders ─────────────────────────────────────────────────────────────────

const FOLDERS_TTL_MS = 60_000;

async function listFolders({ force = false } = {}) {
  if (!force) {
    const cached = (await chrome.storage.session.get(SESSION.FOLDERS))[SESSION.FOLDERS];
    if (cached && Date.now() - cached.ts < FOLDERS_TTL_MS) return cached.tree;
  }
  const tree = await bambuddyFetch('/api/v1/library/folders');
  try {
    await sessionSet({ [SESSION.FOLDERS]: { ts: Date.now(), tree } });
  } catch (err) {
    console.warn('[bambuddy] folders not cached:', err.message);
  }
  return tree;
}

async function createFolder(name, parentId) {
  const folder = await bambuddyFetch('/api/v1/library/folders', {
    method: 'POST',
    body:   JSON.stringify({ name, parent_id: parentId ?? null })
  });
  await chrome.storage.session.remove(SESSION.FOLDERS);
  return folder;
}

// ─── Import queue ────────────────────────────────────────────────────────────
// One job per model. Items run through a small parallel queue; state is
// written to session storage after every transition so the popup can show
// progress even after being closed and reopened.

const runningJobs = new Set();

function jobKey(modelId) { return `${SESSION.JOB}${modelId}`; }

async function getJob(modelId) {
  const key = jobKey(modelId);
  return (await chrome.storage.session.get(key))[key] ?? null;
}

async function saveJob(job) {
  await sessionSet({ [jobKey(job.modelId)]: job });
}

async function startImport({ modelId, title, folderId, items, tabId }) {
  if (!modelId || !Array.isArray(items) || items.length === 0) {
    throw new Error('Nothing selected to import.');
  }
  if (runningJobs.has(modelId)) {
    throw new Error('An import for this model is already running.');
  }

  const job = {
    modelId,
    title:      title ?? '',
    folderId:   folderId ?? null,
    tabId:      tabId ?? null,
    status:     'running',
    startedAt:  Date.now(),
    finishedAt: null,
    items: items.map(it => ({
      instanceId:    it.instanceId,
      profileId:     it.profileId,
      name:          it.name ?? '',
      status:        'pending',    // pending | running | done | exists | error
      error:         null,
      libraryFileId: null,
      folderId:      null,
      filename:      null
    }))
  };
  await saveJob(job);

  runningJobs.add(modelId);
  runJob(job).catch(err => console.error('[bambuddy] job crashed:', err));
  return job;
}

async function runJob(job) {
  const settings    = await getSettings();
  const concurrency = clamp(settings[STORAGE_KEYS.CONCURRENCY], LIMITS.CONCURRENCY, DEFAULTS[STORAGE_KEYS.CONCURRENCY]);

  // Extension API calls reset the service worker's idle timer; a long-running
  // 3MF download inside Bambuddy must not let the worker be torn down mid-job.
  const keepalive = setInterval(() => chrome.storage.session.get(SESSION.FOLDERS), 20_000);

  let cursor = 0;
  const worker = async () => {
    while (cursor < job.items.length) {
      const item = job.items[cursor++];
      item.status = 'running';
      await saveJob(job);
      await updateJobBadge(job);

      try {
        const result = await bambuddyFetch('/api/v1/makerworld/import', {
          method: 'POST',
          body:   JSON.stringify({
            model_id:    job.modelId,
            instance_id: item.instanceId,
            profile_id:  item.profileId,
            folder_id:   job.folderId
          })
        });
        item.status        = result.was_existing ? 'exists' : 'done';
        item.libraryFileId = result.library_file_id ?? null;
        item.folderId      = result.folder_id ?? null;
        item.filename      = result.filename ?? null;
      } catch (err) {
        const msg = err.message ?? 'Import failed';
        if (/already/i.test(msg)) {
          item.status = 'exists';
        } else {
          item.status = 'error';
          item.error  = msg;
        }
      }
      await saveJob(job);
      await updateJobBadge(job);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, job.items.length) }, worker));
  } finally {
    clearInterval(keepalive);
    runningJobs.delete(job.modelId);
  }

  job.status     = job.items.some(i => i.status === 'error') ? 'failed' : 'done';
  job.finishedAt = Date.now();
  job.openUrl    = await buildOpenUrl(job);
  await saveJob(job);
  await chrome.storage.session.remove(SESSION.FOLDERS); // file counts changed
  await updateJobBadge(job);
  await notifyJobDone(job);
}

/**
 * Bambuddy's File Manager deep-links by folder only (`/files?folder=N`); there
 * is no per-file focus parameter. Prefer the folder Bambuddy actually saved to,
 * then the folder the user picked, then the library root.
 */
async function buildOpenUrl(job) {
  const settings = await getSettings();
  const base = (settings[STORAGE_KEYS.BAMBUDDY_URL] ?? '').replace(/\/+$/, '');
  if (!base) return null;

  let folderId = job.items.find(i => i.folderId != null)?.folderId ?? job.folderId ?? null;

  // A re-used existing file reports no folder; look it up from the file itself.
  if (folderId == null) {
    const existing = job.items.find(i => i.libraryFileId != null);
    if (existing) {
      try {
        const file = await bambuddyFetch(`/api/v1/library/files/${existing.libraryFileId}`);
        folderId = file.folder_id ?? null;
      } catch { /* fall through to root */ }
    }
  }

  return folderId != null ? `${base}/files?folder=${folderId}` : `${base}/files`;
}

function summarizeJob(job) {
  const count = s => job.items.filter(i => i.status === s).length;
  return { done: count('done'), exists: count('exists'), error: count('error'), total: job.items.length };
}

async function notifyJobDone(job) {
  const settings = await getSettings();
  if (!settings[STORAGE_KEYS.NOTIFY_ON_COMPLETE] || !chrome.notifications) return;

  const s = summarizeJob(job);
  const parts = [];
  if (s.done)   parts.push(`${s.done} imported`);
  if (s.exists) parts.push(`${s.exists} already in library`);
  if (s.error)  parts.push(`${s.error} failed`);

  const notifId = `bambuddy-job-${job.modelId}-${job.finishedAt}`;
  await chrome.notifications.create(notifId, {
    type:     'basic',
    iconUrl:  chrome.runtime.getURL('icons/icon128.png'),
    title:    s.error ? 'Bambuddy import finished with errors' : 'Bambuddy import complete',
    message:  `${job.title || `Model ${job.modelId}`}\n${parts.join(', ')}`
  });
  if (job.openUrl) notificationTargets.set(notifId, job.openUrl);
}

const notificationTargets = new Map();

if (chrome.notifications) {
  chrome.notifications.onClicked.addListener(id => {
    const url = notificationTargets.get(id);
    if (url) chrome.tabs.create({ url });
    chrome.notifications.clear(id);
    notificationTargets.delete(id);
  });
}

// ─── Toolbar badge ───────────────────────────────────────────────────────────
// "↓" on a model page = ready to import. While a job runs the badge shows how
// many plates are still pending, then a check mark briefly on completion.

function setBadge(tabId, text, color) {
  const opts = tabId != null ? { tabId } : {};
  chrome.action.setBadgeText({ ...opts, text }).catch?.(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ ...opts, color }).catch?.(() => {});
}

function updateBadgeForTab(tabId, url) {
  const onModel = modelIdFromUrl(url) !== null;
  setBadge(tabId, onModel ? '↓' : '', '#1db954');
  if (onModel) prefetchResolve(url);
}

async function updateJobBadge(job) {
  if (job.tabId == null) return;
  // The job may have been started from a search/list page, so only require
  // the tab to still be on MakerWorld — not on this model's page.
  try {
    const tab = await chrome.tabs.get(job.tabId);
    if (!/(^|\.)makerworld\.com$/i.test(new URL(tab.url ?? '').hostname)) return;
  } catch { return; }

  if (job.status === 'running') {
    const remaining = job.items.filter(i => i.status === 'pending' || i.status === 'running').length;
    setBadge(job.tabId, String(remaining), '#60a9ff');
  } else {
    setBadge(job.tabId, job.status === 'failed' ? '!' : '✓', job.status === 'failed' ? '#ff5555' : '#1db954');
    setTimeout(() => {
      chrome.tabs.get(job.tabId).then(t => updateBadgeForTab(job.tabId, t.url ?? '')).catch(() => {});
    }, 5000);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') updateBadgeForTab(tabId, tab.url ?? '');
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateBadgeForTab(tabId, tab.url ?? '');
  } catch { /* chrome:// pages etc. */ }
});

// ─── Updates ─────────────────────────────────────────────────────────────────
// Chromium defers an upgrade while any extension page is open (options tab,
// toolbar popup, the embedded picker on a MakerWorld tab) and applies it only
// when the extension goes idle. Reloading on the pending-update event applies
// it at once instead.

chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());

// ─── Dev seed ────────────────────────────────────────────────────────────────
// Unpacked builds only: a `dev-settings.json` next to the manifest (gitignored,
// not in the release package) pre-fills settings that are still unset, so a
// fresh "Load unpacked" needs no typing. Missing file = no-op.

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const resp = await fetch(chrome.runtime.getURL('dev-settings.json'));
    if (!resp.ok) return;
    const seed    = await resp.json();
    const allowed = new Set(Object.values(STORAGE_KEYS));
    const current = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    const toSet   = {};
    for (const [k, v] of Object.entries(seed)) {
      if (allowed.has(k) && current[k] === undefined) toSet[k] = v;
    }
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
  } catch { /* no dev-settings.json: packaged build */ }
});

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(result => sendResponse({ success: true,  data: result }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {

    case 'resolve':
      return resolveModel(message.url, { force: message.force === true });

    case 'listFolders':
      return listFolders({ force: message.force === true });

    case 'createFolder':
      return createFolder(message.name, message.parentId);

    case 'startImport':
      // The toolbar popup knows its tab; the embedded picker does not, but its
      // message arrives from the MakerWorld tab hosting the iframe.
      return startImport({ ...message, tabId: message.tabId ?? sender.tab?.id ?? null });

    case 'getJob':
      return getJob(message.modelId);

    case 'clearJob':
      await chrome.storage.session.remove(jobKey(message.modelId));
      return true;

    case 'status':
      return bambuddyFetch('/api/v1/makerworld/status');

    case 'testConnection': {
      const settings = await getSettings();
      const bUrl = settings[STORAGE_KEYS.BAMBUDDY_URL];
      if (!bUrl) throw new Error('UNCONFIGURED');
      const base = bUrl.replace(/\/+$/, '');

      // 1. Unauthenticated health check — is the URL reachable at all?
      const healthResp = await fetch(`${base}/health`);
      if (!healthResp.ok) {
        throw new Error(`Bambuddy not reachable (HTTP ${healthResp.status}). Check the URL.`);
      }

      // 2. Authenticated system info — is the API key valid?
      const sysInfo = await bambuddyFetch('/api/v1/system/info');

      // 3. MakerWorld status — best-effort Bambu Cloud token check.
      let mwStatus = null;
      let mwError  = null;
      try {
        mwStatus = await bambuddyFetch('/api/v1/makerworld/status');
      } catch (err) {
        mwError = err.message;
      }

      return { ...sysInfo, mw_status: mwStatus, mw_error: mwError };
    }

    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}
