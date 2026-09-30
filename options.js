/**
 * Options page script.
 * Handles saving/loading settings and the test-connection flow.
 */

// ─── DOM ─────────────────────────────────────────────────────────────────────

const urlInput       = document.getElementById('bambuddy-url');
const keyInput       = document.getElementById('api-key');
const btnSave        = document.getElementById('btn-save');
const btnTest        = document.getElementById('btn-test');
const btnToggle      = document.getElementById('btn-toggle-key');
const statusEl       = document.getElementById('conn-status');
const versionEl      = document.getElementById('version-tag');
const showOpenBtnChk = document.getElementById('show-open-btn');
const notifyChk      = document.getElementById('notify-complete');
const concurrencyIn  = document.getElementById('concurrency');
const resolveTtlIn   = document.getElementById('resolve-ttl');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(type, html) {
  const iconMap = {
    success: '<polyline points="20 6 9 17 4 12"/>',
    error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
  };
  statusEl.className = `status-bar ${type}`;
  statusEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">${iconMap[type] ?? ''}</svg>
    <span>${html}</span>
  `;
  statusEl.style.display = 'flex';
}

function clearStatus() { statusEl.style.display = 'none'; }

async function sendToBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error(chrome.runtime.lastError?.message ?? 'No response from background');
  if (!response.success) throw new Error(response.error ?? 'Unknown error');
  return response.data;
}

// ─── Load saved settings ──────────────────────────────────────────────────────

async function loadSettings() {
  const s = await getSettings();
  urlInput.value         = s[STORAGE_KEYS.BAMBUDDY_URL] ?? '';
  keyInput.value         = s[STORAGE_KEYS.API_KEY] ?? '';
  showOpenBtnChk.checked = s[STORAGE_KEYS.SHOW_OPEN_BTN];
  notifyChk.checked      = s[STORAGE_KEYS.NOTIFY_ON_COMPLETE];
  concurrencyIn.value    = s[STORAGE_KEYS.CONCURRENCY];
  resolveTtlIn.value     = s[STORAGE_KEYS.RESOLVE_TTL];
  concurrencyIn.min = LIMITS.CONCURRENCY.min; concurrencyIn.max = LIMITS.CONCURRENCY.max;
  resolveTtlIn.min  = LIMITS.RESOLVE_TTL.min;  resolveTtlIn.max  = LIMITS.RESOLVE_TTL.max;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function save() {
  clearStatus();
  const url = urlInput.value.trim().replace(/\/+$/, '');
  const key = keyInput.value.trim();

  if (!url) {
    setStatus('error', 'Bambuddy URL is required.');
    urlInput.focus();
    return;
  }

  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch {
    setStatus('error', 'Enter a valid URL (e.g. <code>http://192.168.1.100:8000</code>).');
    urlInput.focus();
    return;
  }

  // Request host permission for this specific Bambuddy origin.
  // This replaces the old broad <all_urls> host permission — the browser will
  // prompt once and remember the choice. Without this, background fetch calls
  // to the Bambuddy instance will be blocked.
  const origin  = parsedUrl.origin;
  const pattern = `${origin}/*`;

  const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] });

  if (!alreadyGranted) {
    statusEl.className = 'status-bar info';
    statusEl.innerHTML = `<span class="spinner"></span><span>Requesting access to <code>${origin}</code>…</span>`;
    statusEl.style.display = 'flex';

    const granted = await chrome.permissions.request({ origins: [pattern] });

    if (!granted) {
      setStatus('error',
        `Permission to access <code>${origin}</code> was denied. ` +
        'The extension cannot connect to Bambuddy without it.'
      );
      return;
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.BAMBUDDY_URL]:       url,
    [STORAGE_KEYS.API_KEY]:            key,
    [STORAGE_KEYS.SHOW_OPEN_BTN]:      showOpenBtnChk.checked,
    [STORAGE_KEYS.NOTIFY_ON_COMPLETE]: notifyChk.checked,
    [STORAGE_KEYS.CONCURRENCY]:        clamp(concurrencyIn.value, LIMITS.CONCURRENCY, DEFAULTS[STORAGE_KEYS.CONCURRENCY]),
    [STORAGE_KEYS.RESOLVE_TTL]:        clamp(resolveTtlIn.value, LIMITS.RESOLVE_TTL, DEFAULTS[STORAGE_KEYS.RESOLVE_TTL])
  });
  await chrome.storage.session.clear();

  setStatus('success', `Settings saved. Access to <code>${origin}</code> granted.`);
}

// ─── Test connection ──────────────────────────────────────────────────────────

async function testConnection() {
  clearStatus();
  const url = urlInput.value.trim();
  const key = keyInput.value.trim();

  if (!url) {
    setStatus('error', 'Enter a Bambuddy URL first.');
    return;
  }

  // Temporarily store values for the background script to use
  await chrome.storage.local.set({
    [STORAGE_KEYS.BAMBUDDY_URL]: url.replace(/\/+$/, ''),
    [STORAGE_KEYS.API_KEY]:      key
  });

  statusEl.className = 'status-bar info';
  statusEl.innerHTML = `<span class="spinner"></span><span>Connecting to Bambuddy…</span>`;
  statusEl.style.display = 'flex';
  btnTest.disabled = true;

  try {
    const data = await sendToBackground({ action: 'testConnection' });

    // Version from GET /api/v1/system/info
    const version = data.version ? ` ${data.version}` : '';
    let msg = `Connected to Bambuddy${version}.`;

    // Cloud token status from GET /api/v1/makerworld/status (best-effort)
    if (data.mw_status) {
      const cloudOk = data.mw_status.has_cloud_token ?? data.mw_status.cloud_token_present ?? false;
      const region  = data.mw_status.region ?? data.mw_status.host ?? '';
      if (cloudOk) {
        msg += ` Bambu Cloud token present${region ? ` (${region})` : ''}.`;
        setStatus('success', msg);
      } else {
        msg += ' ⚠ No Bambu Cloud token — link your Bambu account under Settings → Bambu Cloud before importing.';
        setStatus('info', msg);
      }
    } else if (data.mw_error) {
      // MakerWorld status endpoint returned an error — likely missing permissions
      // or the feature isn't enabled. The core connection is still fine.
      msg += ` API key valid. ⚠ MakerWorld status check failed: ${data.mw_error} — verify your key has <strong>Manage Library</strong> and <strong>Allow cloud access</strong>.`;
      setStatus('info', msg);
    } else {
      setStatus('success', msg);
    }
  } catch (err) {
    if (err.message === 'UNCONFIGURED') {
      setStatus('error', 'Bambuddy URL is not set.');
    } else {
      setStatus('error', `Connection failed: ${err.message}`);
    }
  } finally {
    btnTest.disabled = false;
  }
}

// ─── Show/hide API key ────────────────────────────────────────────────────────

function toggleKeyVisibility() {
  const isHidden = keyInput.type === 'password';
  keyInput.type = isHidden ? 'text' : 'password';
  const eyeIcon = document.getElementById('eye-icon');
  eyeIcon.innerHTML = isHidden
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
       <circle cx="12" cy="12" r="3"/>`;
}

// ─── Version ──────────────────────────────────────────────────────────────────

function loadVersion() {
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `v${manifest.version}`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', save);
btnTest.addEventListener('click', testConnection);
btnToggle.addEventListener('click', toggleKeyVisibility);

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadVersion();
});
