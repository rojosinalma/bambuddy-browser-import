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

// ─── Resolve cache ───────────────────────────────────────────────────────────
// Resolving a model costs two MakerWorld round-trips inside Bambuddy (~0.5 s).
// We resolve as soon as a model tab finishes loading so the popup opens with
// the data already in hand, and cache by model id for a short TTL.

const inflightResolves = new Map();

async function resolveModel(url, { force = false } = {}) {
  const modelId = modelIdFromUrl(url);
  if (modelId === null) throw new Error('Not a MakerWorld model URL');

  const key = `${SESSION.RESOLVE}${modelId}`;
  if (!force) {
    const settings = await getSettings();
    const ttlMs = clamp(settings[STORAGE_KEYS.RESOLVE_TTL], LIMITS.RESOLVE_TTL, DEFAULTS[STORAGE_KEYS.RESOLVE_TTL]) * 1000;
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
      await chrome.storage.session.set({ [key]: { ts: Date.now(), data } });
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
  await chrome.storage.session.set({ [SESSION.FOLDERS]: { ts: Date.now(), tree } });
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
  await chrome.storage.session.set({ [jobKey(job.modelId)]: job });
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
  try {
    const tab = await chrome.tabs.get(job.tabId);
    if (modelIdFromUrl(tab.url) !== job.modelId) return;
  } catch { return; }

  if (job.status === 'running') {
    const remaining = job.items.filter(i => i.status === 'pending' || i.status === 'running').length;
    setBadge(job.tabId, String(remaining), '#60a9ff');
  } else {
    setBadge(job.tabId, job.status === 'failed' ? '!' : '✓', job.status === 'failed' ? '#ff5555' : '#1db954');
    setTimeout(() => updateBadgeForTab(job.tabId, `https://makerworld.com/en/models/${job.modelId}`), 5000);
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

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(result => sendResponse({ success: true,  data: result }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.action) {

    case 'resolve':
      return resolveModel(message.url, { force: message.force === true });

    case 'listFolders':
      return listFolders({ force: message.force === true });

    case 'createFolder':
      return createFolder(message.name, message.parentId);

    case 'startImport':
      return startImport(message);

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
