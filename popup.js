/**
 * Popup script.
 * Orchestrates: settings check → tab URL read → resolve call → import call.
 * All network calls go through background.js to avoid CORS issues.
 *
 * Resolve response shape (MakerworldResolvedModel from Bambuddy):
 *   model_id:                    number          — integer design ID
 *   profile_id:                  number | null   — pre-selected profile from URL fragment
 *   design:                      object          — MakerWorld design metadata (title, coverUrl, …)
 *   instances:                   object[]        — print profiles; each has id, profileId, title, cover
 *   already_imported_library_ids: number[]       — library file IDs (not profile IDs)
 *
 * Import request body:
 *   model_id, instance_id, profile_id, folder_id
 */

// ─── DOM references ──────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const states = {
  unconfigured: $('state-unconfigured'),
  wrongPage:    $('state-wrong-page'),
  loading:      $('state-loading'),
  model:        $('state-model'),
  error:        $('state-error')
};

// ─── State helpers ───────────────────────────────────────────────────────────

function showOnly(key) {
  for (const [k, el] of Object.entries(states)) {
    el.style.display = k === key ? '' : 'none';
  }
}

function showResult(type, text) {
  const iconPaths = {
    success: '<polyline points="20 6 9 17 4 12"/>',
    info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
  };
  const banner = $('result-banner');
  banner.className = `result-banner ${type}`;
  $('result-icon').innerHTML = iconPaths[type] ?? '';
  $('result-text').textContent = text;
  banner.style.display = 'flex';
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error ?? 'Unknown error'));
        return;
      }
      resolve(response.data);
    });
  });
}

// ─── Resolve flow ────────────────────────────────────────────────────────────

/** State kept during a resolve/import session. */
let session = {
  resolveData:   null,
  bambuddyUrl:   null,
  selectedValue: null  // "instanceId:profileId" for the currently selected card
};

/**
 * Set the popup thumbnail to a MakerWorld CDN URL, proxied through Bambuddy.
 * Clears the image if url is empty.
 */
function setThumbnail(url) {
  const img = $('model-thumb');
  const placeholder = $('model-thumb-placeholder');
  if (!url) {
    img.style.display = 'none';
    placeholder.style.display = '';
    return;
  }
  const proxied = `${session.bambuddyUrl}/api/v1/makerworld/thumbnail?url=${encodeURIComponent(url)}`;
  img.onload = () => { img.style.display = ''; placeholder.style.display = 'none'; };
  img.onerror = () => { img.onerror = null; img.src = url; };
  img.src = proxied;
}

/**
 * Safe string field read from an opaque Record — mirrors Bambuddy's own
 * pickString() helper in MakerworldPage.tsx.
 */
function pickStr(obj, key) {
  if (!obj) return '';
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function pickNum(obj, key) {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'number' ? v : null;
}

// ─── Profile card helpers ─────────────────────────────────────────────────────

/** Format seconds into "Xh Ym" or "Ym" */
function formatTime(secs) {
  if (!secs || secs < 60) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Render a 1-5 rating as filled/empty stars */
function starsHtml(rating) {
  if (rating == null) return '';
  const n = Math.round(Math.min(5, Math.max(0, rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * Build the chip descriptors for one instance.
 *
 * `inst`       — hit from /design/{id}/instances (has compatibility merged in,
 *                but detail is all-zeros in practice)
 * `designInst` — matching entry from data.design.instances (the /design/{id}
 *                response), which has the real flat fields:
 *                  prediction, materialCnt, needAms, isDefault,
 *                  ratingScoreTotal, ratingCount,
 *                  extention.modelInfo.plates[]
 *
 * We try `designInst` first, then `inst` as a fallback.
 */
/**
 * @param {object}      src    — design instance (has prediction, materialCnt, etc.)
 * @param {object|null} compat — compatibility object { devProductName, nozzleDiameter }
 */
function buildChips(src, compat = null) {
  const chips = [];

  // ── Print time ────────────────────────────────────────────────────────────
  // src.prediction is the total time for all plates (seconds).
  const totalSecs = pickNum(src, 'prediction') ?? 0;
  const timeStr   = formatTime(totalSecs);
  if (timeStr) chips.push({ icon: 'clock', label: timeStr });

  // ── Plate count ───────────────────────────────────────────────────────────
  // extention.modelInfo.plates[] is the authoritative source; its length is the
  // number of individual print plates in this profile's 3MF.
  const mi        = src?.['extention']?.['modelInfo'] ?? {};
  const platesArr = Array.isArray(mi['plates']) ? mi['plates'] : null;
  const plateCount = platesArr !== null
    ? platesArr.length
    : (pickNum(src, 'plateCount') ?? pickNum(src, 'totalPlate'));

  if (plateCount != null && plateCount > 1) {
    chips.push({ icon: 'layers', label: `${plateCount} plates` });
  }

  // ── Filament / colour count ───────────────────────────────────────────────
  const mats = pickNum(src, 'materialCnt');
  if (mats != null && mats > 0) {
    chips.push({ icon: 'droplet', label: mats === 1 ? '1 color' : `${mats} colors` });
  }

  // ── AMS requirement ───────────────────────────────────────────────────────
  if (src?.['needAms'] === true) chips.push({ icon: 'layers', label: 'AMS', className: 'ams' });

  // ── Rating (0–5) ──────────────────────────────────────────────────────────
  const rTotal = pickNum(src, 'ratingScoreTotal');
  const rCount = pickNum(src, 'ratingCount');
  const rating = (rTotal != null && rCount != null && rCount > 0)
    ? rTotal / rCount
    : pickNum(src, 'rating');
  if (rating != null && rating > 0 && rating <= 5) {
    chips.push({ icon: 'star', label: rating.toFixed(1), className: 'stars' });
  }

  // ── Primary printer ───────────────────────────────────────────────────────
  // `compat` is passed in from the caller (either the merged top-level field
  // from the instances-list hit, or extention.modelInfo.compatibility).
  const printer = typeof compat === 'object' && compat !== null
    ? (compat['devProductName'] ?? null)
    : null;
  if (printer) chips.push({ icon: 'printer', label: printer });

  return chips;
}

/** SVG path data for mini chip icons */
const CHIP_ICONS = {
  clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  layers:  '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  star:    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  printer: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'
};

/**
 * Build a single profile card DOM element.
 * @param {{ value: string, name: string, cover: string, chips: object[] }} opts
 */
function buildProfileCard({ value, name, cover, chips }) {
  const card = document.createElement('div');
  card.className = 'profile-card';
  card.dataset.value = value;
  card.dataset.cover = cover;

  // Thumbnail
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'pc-thumb-wrap';

  if (cover) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    // Proxy through Bambuddy thumbnail endpoint
    img.src = `${session.bambuddyUrl}/api/v1/makerworld/thumbnail?url=${encodeURIComponent(cover)}`;
    img.onerror = () => { img.onerror = null; img.src = cover; };
    thumbWrap.appendChild(img);
  } else {
    thumbWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`;
  }

  card.appendChild(thumbWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'pc-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'pc-name';
  nameEl.textContent = name;
  body.appendChild(nameEl);

  if (chips.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'pc-meta';
    for (const chip of chips) {
      const span = document.createElement('span');
      span.className = `pc-chip${chip.className ? ' ' + chip.className : ''}`;
      const iconPath = CHIP_ICONS[chip.icon] ?? '';
      span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>${chip.label}`;
      meta.appendChild(span);
    }
    body.appendChild(meta);
  }

  card.appendChild(body);

  // Selection checkmark
  const check = document.createElement('div');
  check.className = 'pc-check';
  check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  card.appendChild(check);

  return card;
}

/** Mark a card as selected, update session state and main thumbnail. */
function selectProfileCard(cardEl, value, coverUrl) {
  document.querySelectorAll('#profile-list .profile-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  session.selectedValue = value;
  setThumbnail(coverUrl || '');
}

/**
 * @param {string}      tabUrl       — full URL of the MakerWorld tab (may include #profileId-…)
 * @param {number|null} pageProfileId — profile ID reported by the content script (highest priority)
 */
async function runResolve(tabUrl, pageProfileId = null) {
  showOnly('loading');

  let data;
  try {
    data = await sendToBackground({ action: 'resolve', url: tabUrl });
  } catch (err) {
    if (err.message === 'UNCONFIGURED') {
      showOnly('unconfigured');
      return;
    }
    showOnly('error');
    $('error-detail').textContent = err.message;
    return;
  }

  session.resolveData = data;

  // ── Title ─────────────────────────────────────────────────────────────────
  // design is passed through verbatim from Bambu Lab's design-service response.
  const design = data.design ?? {};
  $('model-title').textContent = pickStr(design, 'title') || 'Untitled Model';

  // ── Thumbnail ─────────────────────────────────────────────────────────────
  const { bambuddyUrl } = await new Promise(res =>
    chrome.storage.local.get('bambuddyUrl', res)
  );
  session.bambuddyUrl = (bambuddyUrl ?? '').replace(/\/+$/, '');

  const designCoverUrl = pickStr(design, 'coverUrl') || pickStr(design, 'cover_url');
  setThumbnail(designCoverUrl);

  // ── Instances (print profiles / plates) ───────────────────────────────────
  // instances[] is passed through verbatim from MakerWorld's API.
  // Fields documented in Bambuddy MakerworldPage.tsx:
  //   id, profileId, title, cover, materialCnt, needAms, downloadCount,
  //   compatibility { devProductName }, otherCompatibility[]
  // Additional fields present but not displayed by Bambuddy's own UI:
  //   printTime (seconds?), plateCount / totalPlate, rating / likeCount
  // data.design.instances[] — from /design/{id} — is the authoritative source:
  //   • Canonical display order (matches MakerWorld's own profile list ordering)
  //   • Full per-profile data: prediction, materialCnt, needAms, isDefault,
  //     ratingScoreTotal, ratingCount, extention.modelInfo.plates[], etc.
  //
  // data.instances (from /design/{id}/instances hits) has a zeroed-out detail
  // sub-object and potentially different ordering, but carries the top-level
  // `compatibility` / `otherCompatibility` fields that Bambuddy merges in.
  // Build a map so we can grab that merged compat for any card that needs it.
  const designInstances = data.design?.['instances'] ?? [];
  const instHitById = new Map();
  for (const hit of (data.instances ?? [])) {
    const iid = pickNum(hit, 'id');
    if (iid != null) instHitById.set(iid, hit);
  }

  // Determine which profile to pre-select, in priority order:
  //   1. pageProfileId — direct from the content script (DOM / live hash).
  //      This works even when MakerWorld hasn't updated the URL hash yet
  //      (e.g. the first/default profile on initial page load).
  //   2. data.profile_id — extracted by Bambuddy from the URL's #profileId-…
  //      fragment. Reliable once the user has clicked a different profile.
  //   3. URL hash parsed locally as a last-resort fallback.
  const urlHashMatch = tabUrl.match(/#profileId[-=](\d+)/i);
  const urlHashProfileId = urlHashMatch ? parseInt(urlHashMatch[1], 10) : null;
  const hintedProfileId = pageProfileId ?? data.profile_id ?? urlHashProfileId;

  const list = $('profile-list');
  list.innerHTML = '';
  session.selectedValue = null;

  if (designInstances.length === 0) {
    // Fallback when the design has no instances (very rare)
    const card = buildProfileCard({
      value: `${data.model_id ?? ''}:${data.model_id ?? ''}`,
      name:  pickStr(design, 'title') || 'Default plate',
      cover: designCoverUrl,
      chips: []
    });
    list.appendChild(card);
    selectProfileCard(card, `${data.model_id ?? ''}:${data.model_id ?? ''}`, designCoverUrl);
  } else {
    for (const designInst of designInstances) {
      const instanceId = pickNum(designInst, 'id');
      const profileId  = pickNum(designInst, 'profileId');
      if (instanceId === null || profileId === null) continue;

      // Prefer the merged top-level compat from the instances-list hit;
      // fall back to extention.modelInfo.compatibility from the design instance.
      const hit    = instHitById.get(instanceId);
      const compat = hit?.['compatibility']
                  ?? designInst?.['extention']?.['modelInfo']?.['compatibility']
                  ?? null;

      const value = `${instanceId}:${profileId}`;
      const name  = pickStr(designInst, 'title') || `Profile ${profileId}`;
      const cover = pickStr(designInst, 'cover');
      const chips = buildChips(designInst, compat);

      const card = buildProfileCard({ value, name, cover, chips });
      list.appendChild(card);

      card.addEventListener('click', () => {
        selectProfileCard(card, value, cover || designCoverUrl);
      });

      // Pre-select logic (highest priority first):
      //   1. profileId matches the hint from URL / content script
      //   2. isDefault === true  (MakerWorld's own default-profile marker)
      //   3. First card after the loop (last-resort fallback)
      const isDefault = designInst['isDefault'] === true;
      const matchHint = hintedProfileId !== null && profileId === hintedProfileId;
      const matchDef  = hintedProfileId === null && isDefault && session.selectedValue === null;

      if (matchHint || matchDef) {
        selectProfileCard(card, value, cover || designCoverUrl);
      }
    }

    // If nothing matched, select the first card — this matches MakerWorld's own
    // behaviour when there is no URL hint and no isDefault marker.
    if (session.selectedValue === null) {
      const first = list.querySelector('.profile-card');
      if (first) first.click();
    }
  }

  showOnly('model');
}

// ─── Import flow ─────────────────────────────────────────────────────────────

async function runImport() {
  const data = session.resolveData;
  if (!data) return;

  const [instanceIdStr, profileIdStr] = (session.selectedValue ?? ':').split(':');
  const instanceId = parseInt(instanceIdStr, 10);
  const profileId  = parseInt(profileIdStr,  10);
  const modelId    = data.model_id;

  if (!modelId || isNaN(instanceId) || isNaN(profileId)) {
    showResult('error', 'Could not determine model or instance ID. Try re-opening the popup.');
    return;
  }

  const btn = $('btn-import');
  btn.classList.add('loading');
  btn.disabled = true;
  $('result-banner').style.display = 'none';

  // Load behaviour prefs
  const prefs = await new Promise(res =>
    chrome.storage.local.get(['autoClose', 'autoCloseDelay', 'showOpenBtn'], res)
  );
  const autoClose    = prefs.autoClose       ?? false;
  const closeDelay   = (prefs.autoCloseDelay ?? 3) * 1000;
  const showOpenBtn  = prefs.showOpenBtn     ?? true;

  try {
    const result = await sendToBackground({
      action:      'import',
      model_id:    modelId,
      instance_id: instanceId,
      profile_id:  profileId
    });

    if (result.was_existing) {
      showResult('info', 'This plate is already in your library.');
    } else {
      const filename = result.filename ? ` — ${result.filename}` : '';
      showResult('success', `Saved to your Bambuddy library${filename}.`);
    }

    // "Open in Bambuddy" deep-link to /files?folder=N
    if (showOpenBtn) {
      const folderParam = result.folder_id != null ? `?folder=${result.folder_id}` : '';
      const link = $('btn-open-bambuddy');
      link.href = `${session.bambuddyUrl}/files${folderParam}`;
      link.style.display = 'flex';
    }

    // Auto-close
    if (autoClose) {
      setTimeout(() => window.close(), closeDelay);
    }
  } catch (err) {
    const msg = err.message ?? 'Import failed';
    if (msg.toLowerCase().includes('already')) {
      showResult('info', 'This plate is already in your library.');
    } else {
      showResult('error', msg);
    }
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function init() {
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-go-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-import').addEventListener('click', runImport);
  $('btn-retry').addEventListener('click', boot);

  await boot();
}

/**
 * Ask the content script (content.js) for the profileId currently active on
 * the MakerWorld page.  This is more reliable than `tab.url` alone because:
 *   - On initial page load MakerWorld does NOT add #profileId-XXXXX to the URL
 *     for the first/default profile.
 *   - The content script runs inside the page and reads window.location.hash
 *     (always current) and can also inspect the DOM.
 *
 * Returns null if the content script is not ready or can't determine the ID.
 */
async function getActiveProfileIdFromPage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getSelectedProfile' });
    return (typeof response?.profileId === 'number') ? response.profileId : null;
  } catch {
    // Content script not injected yet, tab not accessible, or extension context
    // is invalid — none of these are fatal; fall back to URL-based detection.
    return null;
  }
}

async function boot() {
  showOnly('loading');

  // 1. Check configuration
  const { bambuddyUrl } = await new Promise(res =>
    chrome.storage.local.get('bambuddyUrl', res)
  );
  if (!bambuddyUrl) {
    showOnly('unconfigured');
    return;
  }

  // 2. Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  if (!url.includes('makerworld.com')) {
    showOnly('wrongPage');
    return;
  }

  // 3. Update subtitle
  $('header-subtitle').textContent = new URL(url).hostname;

  // 4. Ask the content script for the active profile BEFORE calling resolve
  //    so we can use it to pre-select the card after the resolve returns.
  const pageProfileId = await getActiveProfileIdFromPage(tab.id);

  // 5. Resolve
  await runResolve(url, pageProfileId);
}

document.addEventListener('DOMContentLoaded', init);
