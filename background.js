/**
 * Background service worker.
 * All Bambuddy API requests are routed through here so they bypass the browser's
 * CORS restrictions that would otherwise block cross-origin fetches from the popup.
 */

const STORAGE_KEYS = {
  BAMBUDDY_URL: 'bambuddyUrl',
  API_KEY:      'apiKey'
};

async function getSettings() {
  return new Promise(resolve =>
    chrome.storage.local.get([STORAGE_KEYS.BAMBUDDY_URL, STORAGE_KEYS.API_KEY], resolve)
  );
}

/**
 * Perform an authenticated fetch against the configured Bambuddy instance.
 * Throws a descriptive Error on non-2xx responses.
 */
async function bambuddyFetch(path, options = {}) {
  const { bambuddyUrl, apiKey } = await getSettings();

  if (!bambuddyUrl) {
    throw new Error('UNCONFIGURED');
  }

  const base = bambuddyUrl.replace(/\/+$/, '');
  const url  = `${base}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {})
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers ?? {}) }
    });
  } catch (err) {
    // A TypeError "Failed to fetch" almost always means the browser blocked
    // the request because the host permission hasn't been granted.
    // Tell the user to re-save their settings (which triggers the permission prompt).
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
      // Always coerce to a readable string before passing to new Error().
      const raw = body.detail ?? body.message;
      if (raw !== undefined && raw !== null) {
        detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      }
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }

  return response.json();
}

// ─── Toolbar badge ───────────────────────────────────────────────────────────
// Show a green "↓" badge on the extension icon whenever the user is viewing
// a MakerWorld model page so it's obvious the extension is ready to use.

function updateBadgeForTab(tabId, url) {
  const onModel = /makerworld\.com\/[a-z-]+\/models\//.test(url);
  chrome.action.setBadgeText({ text: onModel ? '↓' : '', tabId });
  if (onModel) {
    chrome.action.setBadgeBackgroundColor({ color: '#1db954', tabId });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateBadgeForTab(tabId, tab.url ?? '');
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateBadgeForTab(tabId, tab.url ?? '');
  } catch { /* tab may not be accessible (e.g. chrome:// pages) */ }
});

// ─── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(result  => sendResponse({ success: true,  data: result }))
    .catch(error  => sendResponse({ success: false, error: error.message }));

  return true; // keep the port open for the async response
});

async function handleMessage(message) {
  switch (message.action) {

    case 'resolve':
      return bambuddyFetch('/api/v1/makerworld/resolve', {
        method: 'POST',
        body:   JSON.stringify({ url: message.url })
      });

    case 'import':
      return bambuddyFetch('/api/v1/makerworld/import', {
        method: 'POST',
        body:   JSON.stringify({
          model_id:    message.model_id,
          instance_id: message.instance_id,
          profile_id:  message.profile_id,
          folder_id:   null
        })
      });

    case 'status':
      return bambuddyFetch('/api/v1/makerworld/status');

    case 'testConnection': {
      const { bambuddyUrl: bUrl } = await getSettings();
      if (!bUrl) throw new Error('UNCONFIGURED');
      const base = bUrl.replace(/\/+$/, '');

      // Phase 1: unauthenticated health check — confirms the URL is reachable at all.
      // This endpoint is documented at GET /health and requires no API key.
      const healthResp = await fetch(`${base}/health`);
      if (!healthResp.ok) {
        throw new Error(`Bambuddy not reachable (HTTP ${healthResp.status}). Check the URL.`);
      }

      // Phase 2: authenticated system info — confirms the API key is valid
      // and returns the running Bambuddy version.
      const sysInfo = await bambuddyFetch('/api/v1/system/info');

      // Phase 3: MakerWorld status — best-effort check for the Bambu Cloud token.
      // Returns 403 if the key lacks MakerWorld permissions, or 404 on older builds
      // that predate the MakerWorld feature. Neither case is fatal here.
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
