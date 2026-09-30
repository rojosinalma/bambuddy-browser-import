/**
 * Popup script.
 *
 * Flow: settings check → tab URL → (resolve ∥ page profile hint ∥ folders)
 *       → render cards → user picks plates + folder → hand the job to the
 *       background worker → mirror its progress from session storage.
 *
 * The popup owns no long-running work: Chrome closes it the moment focus moves
 * elsewhere, so imports run in background.js and this page just renders
 * whatever job state exists for the current model.
 */

const $ = id => document.getElementById(id);

const states = {
  unconfigured: $('state-unconfigured'),
  wrongPage:    $('state-wrong-page'),
  loading:      $('state-loading'),
  model:        $('state-model'),
  error:        $('state-error')
};

function showOnly(key) {
  for (const [k, el] of Object.entries(states)) el.style.display = k === key ? '' : 'none';
}

const RESULT_ICONS = {
  success: '<polyline points="20 6 9 17 4 12"/>',
  info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
};

function showResult(type, text) {
  const banner = $('result-banner');
  banner.className = `result-banner ${type}`;
  $('result-icon').innerHTML = RESULT_ICONS[type] ?? '';
  $('result-text').textContent = text;
  banner.style.display = 'flex';
}

function hideResult() { $('result-banner').style.display = 'none'; }

async function sendToBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error(chrome.runtime.lastError?.message ?? 'No response from background');
  if (!response.success) throw new Error(response.error ?? 'Unknown error');
  return response.data;
}

// ─── Session state ───────────────────────────────────────────────────────────

const session = {
  tabId:       null,
  tabUrl:      '',
  modelId:     null,
  resolveData: null,
  bambuddyUrl: '',
  settings:    null,
  cards:       new Map(),   // profileId → { el, instanceId, name, cover }
  selected:    new Set(),   // profileIds
  job:         null
};

// ─── Small helpers ───────────────────────────────────────────────────────────

function pickStr(obj, key) {
  const v = obj?.[key];
  return typeof v === 'string' ? v : '';
}

function pickNum(obj, key) {
  const v = obj?.[key];
  return typeof v === 'number' ? v : null;
}

function formatTime(secs) {
  if (!secs || secs < 60) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function proxied(coverUrl, width) {
  const sized = thumbUrl(coverUrl, width);
  return `${session.bambuddyUrl}/api/v1/makerworld/thumbnail?url=${encodeURIComponent(sized)}`;
}

function setThumbnail(url) {
  const img = $('model-thumb');
  const placeholder = $('model-thumb-placeholder');
  if (!url) {
    img.style.display = 'none';
    placeholder.style.display = '';
    return;
  }
  img.onload  = () => { img.style.display = ''; placeholder.style.display = 'none'; };
  img.onerror = () => { img.onerror = null; img.src = thumbUrl(url, 720); };
  img.src = proxied(url, 720);
}

// ─── Chips ───────────────────────────────────────────────────────────────────

const CHIP_ICONS = {
  clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  layers:  '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  star:    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  printer: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'
};

/**
 * @param {object}      src    — design instance (prediction, materialCnt, needAms, …)
 * @param {object|null} compat — compatibility object { devProductName, nozzleDiameter }
 */
function buildChips(src, compat = null) {
  const chips = [];

  const timeStr = formatTime(pickNum(src, 'prediction') ?? 0);
  if (timeStr) chips.push({ icon: 'clock', label: timeStr });

  const mi = src?.extention?.modelInfo ?? {};
  const platesArr = Array.isArray(mi.plates) ? mi.plates : null;
  const plateCount = platesArr !== null
    ? platesArr.length
    : (pickNum(src, 'plateCount') ?? pickNum(src, 'totalPlate'));
  if (plateCount != null && plateCount > 1) chips.push({ icon: 'layers', label: `${plateCount} plates` });

  const mats = pickNum(src, 'materialCnt');
  if (mats != null && mats > 0) chips.push({ icon: 'droplet', label: mats === 1 ? '1 color' : `${mats} colors` });

  if (src?.needAms === true) chips.push({ icon: 'layers', label: 'AMS', className: 'ams' });

  const rTotal = pickNum(src, 'ratingScoreTotal');
  const rCount = pickNum(src, 'ratingCount');
  const rating = (rTotal != null && rCount != null && rCount > 0) ? rTotal / rCount : pickNum(src, 'rating');
  if (rating != null && rating > 0 && rating <= 5) chips.push({ icon: 'star', label: rating.toFixed(1), className: 'stars' });

  const printer = compat && typeof compat === 'object' ? (compat.devProductName ?? null) : null;
  if (printer) chips.push({ icon: 'printer', label: printer });

  return chips;
}

// ─── Profile cards ───────────────────────────────────────────────────────────

const STATUS_ICONS = {
  running: '<span class="spinner small"></span>',
  done:    '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  exists:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  error:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
};

function buildProfileCard({ profileId, name, cover, chips }) {
  const card = document.createElement('div');
  card.className = 'profile-card';
  card.dataset.profileId = String(profileId);

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'pc-thumb-wrap';
  if (cover) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = proxied(cover, 200);
    img.onerror = () => { img.onerror = null; img.src = thumbUrl(cover, 200); };
    thumbWrap.appendChild(img);
  } else {
    thumbWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/></svg>`;
  }
  card.appendChild(thumbWrap);

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
      span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CHIP_ICONS[chip.icon] ?? ''}</svg>`;
      span.appendChild(document.createTextNode(chip.label));
      meta.appendChild(span);
    }
    body.appendChild(meta);
  }

  const statusEl = document.createElement('div');
  statusEl.className = 'pc-status';
  body.appendChild(statusEl);
  card.appendChild(body);

  const check = document.createElement('div');
  check.className = 'pc-check';
  check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  card.appendChild(check);

  return card;
}

function setSelected(profileId, on) {
  const card = session.cards.get(profileId);
  if (!card) return;
  if (on) session.selected.add(profileId); else session.selected.delete(profileId);
  card.el.classList.toggle('selected', on);
}

function toggleSelected(profileId) {
  setSelected(profileId, !session.selected.has(profileId));
  refreshSelection();
}

function refreshSelection() {
  const n = session.selected.size;
  const total = session.cards.size;
  $('sel-count').textContent = total > 1 ? `${n}/${total}` : '';

  const btn = $('btn-import');
  const running = session.job?.status === 'running';
  btn.disabled = running || n === 0;
  $('btn-import-text').textContent =
    n === 0 ? 'Select a plate' : n === 1 ? 'Import 1 plate' : `Import ${n} plates`;

  // Show the first selected card's cover as the hero thumbnail.
  const first = [...session.selected].map(id => session.cards.get(id)).find(c => c?.cover);
  const designCover = pickStr(session.resolveData?.design, 'coverUrl') || pickStr(session.resolveData?.design, 'cover_url');
  setThumbnail(first?.cover || designCover);
}

function renderCards(data, hintedProfileId) {
  const list = $('profile-list');
  list.innerHTML = '';
  session.cards.clear();
  session.selected.clear();

  const design = data.design ?? {};
  const designCover = pickStr(design, 'coverUrl') || pickStr(design, 'cover_url');
  const designInstances = design.instances ?? [];

  // /design/{id}/instances hits carry the merged `compatibility` field.
  const instHitById = new Map();
  for (const hit of (data.instances ?? [])) {
    const iid = pickNum(hit, 'id');
    if (iid != null) instHitById.set(iid, hit);
  }

  if (designInstances.length === 0) {
    const profileId = data.model_id ?? 0;
    const card = buildProfileCard({ profileId, name: pickStr(design, 'title') || 'Default plate', cover: designCover, chips: [] });
    list.appendChild(card);
    session.cards.set(profileId, { el: card, instanceId: data.model_id ?? null, name: card.querySelector('.pc-name').textContent, cover: designCover });
    card.addEventListener('click', () => toggleSelected(profileId));
    setSelected(profileId, true);
    refreshSelection();
    return;
  }

  let defaultProfileId = null;
  for (const inst of designInstances) {
    const instanceId = pickNum(inst, 'id');
    const profileId  = pickNum(inst, 'profileId');
    if (instanceId === null || profileId === null) continue;

    const compat = instHitById.get(instanceId)?.compatibility
                ?? inst?.extention?.modelInfo?.compatibility
                ?? null;
    const name  = pickStr(inst, 'title') || `Profile ${profileId}`;
    const cover = pickStr(inst, 'cover');
    const card  = buildProfileCard({ profileId, name, cover, chips: buildChips(inst, compat) });
    list.appendChild(card);
    session.cards.set(profileId, { el: card, instanceId, name, cover });
    card.addEventListener('click', () => toggleSelected(profileId));

    if (inst.isDefault === true && defaultProfileId === null) defaultProfileId = profileId;
  }

  // Pre-select: URL/page hint → MakerWorld's isDefault → first card.
  const initial = (hintedProfileId !== null && session.cards.has(hintedProfileId))
    ? hintedProfileId
    : (defaultProfileId ?? session.cards.keys().next().value);
  if (initial != null) setSelected(initial, true);
  refreshSelection();
}

// ─── Folder picker ───────────────────────────────────────────────────────────

function renderFolders(tree, preferredId) {
  const sel = $('folder-select');
  sel.innerHTML = '';

  const root = document.createElement('option');
  root.value = '';
  root.textContent = 'Default (MakerWorld)';
  sel.appendChild(root);

  for (const f of flattenFolders(tree)) {
    const opt = document.createElement('option');
    opt.value = String(f.id);
    opt.textContent = `${'\u00a0\u00a0'.repeat(f.depth)}${f.depth ? '↳ ' : ''}${f.name}`;
    opt.disabled = f.disabled;
    sel.appendChild(opt);
  }

  if (preferredId != null && sel.querySelector(`option[value="${preferredId}"]`)) {
    sel.value = String(preferredId);
  }
}

function selectedFolderId() {
  const v = $('folder-select').value;
  return v === '' ? null : parseInt(v, 10);
}

async function loadFolders({ force = false, preferredId } = {}) {
  try {
    const tree = await sendToBackground({ action: 'listFolders', force });
    renderFolders(tree, preferredId ?? session.settings?.[STORAGE_KEYS.LAST_FOLDER_ID]);
  } catch (err) {
    console.warn('[bambuddy] folders unavailable:', err.message);
  }
}

function showNewFolderRow(show) {
  $('new-folder-row').style.display = show ? '' : 'none';
  if (show) { $('new-folder-name').value = ''; $('new-folder-name').focus(); }
}

async function createFolder() {
  const name = $('new-folder-name').value.trim();
  if (!name) { $('new-folder-name').focus(); return; }

  const btn = $('btn-create-folder');
  btn.disabled = true;
  try {
    const folder = await sendToBackground({ action: 'createFolder', name, parentId: selectedFolderId() });
    await loadFolders({ force: true, preferredId: folder.id });
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_FOLDER_ID]: folder.id });
    showNewFolderRow(false);
  } catch (err) {
    showResult('error', `Could not create folder: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ─── Job rendering ───────────────────────────────────────────────────────────

function applyJob(job) {
  session.job = job;
  const progress = $('job-progress');
  const openBtn  = $('btn-open-bambuddy');

  if (!job) {
    progress.style.display = 'none';
    openBtn.style.display = 'none';
    for (const c of session.cards.values()) {
      c.el.classList.remove('busy');
      c.el.querySelector('.pc-status').innerHTML = '';
      c.el.querySelector('.pc-status').className = 'pc-status';
    }
    refreshSelection();
    return;
  }

  for (const item of job.items) {
    const c = session.cards.get(item.profileId);
    if (!c) continue;
    const st = c.el.querySelector('.pc-status');
    st.className = `pc-status ${item.status}`;
    st.innerHTML = STATUS_ICONS[item.status] ?? '';
    if (item.status === 'done')   st.insertAdjacentText('beforeend', item.filename ? ` ${item.filename}` : ' Imported');
    if (item.status === 'exists') st.insertAdjacentText('beforeend', ' Already in library');
    if (item.status === 'error')  st.insertAdjacentText('beforeend', ` ${item.error ?? 'Failed'}`);
    if (item.status === 'running') st.insertAdjacentText('beforeend', ' Importing…');
    c.el.classList.toggle('busy', job.status === 'running');
  }

  const finished = job.items.filter(i => i.status !== 'pending' && i.status !== 'running').length;
  const total = job.items.length;

  if (job.status === 'running') {
    progress.style.display = '';
    $('job-bar-fill').style.width = `${Math.round((finished / total) * 100)}%`;
    $('job-progress-text').textContent = `Importing ${finished}/${total}…`;
    hideResult();
    openBtn.style.display = 'none';
  } else {
    progress.style.display = 'none';
    const done   = job.items.filter(i => i.status === 'done').length;
    const exists = job.items.filter(i => i.status === 'exists').length;
    const errors = job.items.filter(i => i.status === 'error').length;
    const parts = [];
    if (done)   parts.push(`${done} imported`);
    if (exists) parts.push(`${exists} already in library`);
    if (errors) parts.push(`${errors} failed`);
    showResult(errors ? (done || exists ? 'info' : 'error') : (done ? 'success' : 'info'), parts.join(', ') + '.');

    if (job.openUrl && session.settings?.[STORAGE_KEYS.SHOW_OPEN_BTN] !== false) {
      openBtn.href = job.openUrl;
      openBtn.style.display = 'flex';
    }
  }

  refreshSelection();
}

async function runImport() {
  if (!session.resolveData || session.selected.size === 0) return;

  const items = [...session.selected].map(profileId => {
    const c = session.cards.get(profileId);
    return { profileId, instanceId: c.instanceId, name: c.name };
  });
  const folderId = selectedFolderId();
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_FOLDER_ID]: folderId });

  hideResult();
  $('btn-import').disabled = true;
  try {
    const job = await sendToBackground({
      action:  'startImport',
      modelId: session.modelId,
      title:   $('model-title').textContent,
      folderId,
      items,
      tabId:   session.tabId
    });
    applyJob(job);
  } catch (err) {
    showResult('error', err.message ?? 'Import failed');
    refreshSelection();
  }
}

// Mirror job state written by the background worker.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || session.modelId === null) return;
  const key = `${SESSION.JOB}${session.modelId}`;
  if (key in changes) applyJob(changes[key].newValue ?? null);
});

// ─── Boot ────────────────────────────────────────────────────────────────────

async function getActiveProfileIdFromPage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getSelectedProfile' });
    return typeof response?.profileId === 'number' ? response.profileId : null;
  } catch {
    return null;
  }
}

async function boot() {
  showOnly('loading');
  hideResult();

  session.settings = await getSettings();
  session.bambuddyUrl = (session.settings[STORAGE_KEYS.BAMBUDDY_URL] ?? '').replace(/\/+$/, '');
  if (!session.bambuddyUrl) { showOnly('unconfigured'); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const modelId = modelIdFromUrl(url);
  if (modelId === null) { showOnly('wrongPage'); return; }

  session.tabId   = tab.id;
  session.tabUrl  = url;
  session.modelId = modelId;
  $('header-subtitle').textContent = new URL(url).hostname;

  // Everything independent runs at once; the resolve is usually already
  // cached by the background prefetch that fired when the tab loaded.
  const [resolveResult, pageProfileId, job] = await Promise.all([
    sendToBackground({ action: 'resolve', url }).then(d => ({ ok: true, d }), e => ({ ok: false, e })),
    getActiveProfileIdFromPage(tab.id),
    sendToBackground({ action: 'getJob', modelId }).catch(() => null),
    loadFolders()
  ]);

  if (!resolveResult.ok) {
    if (resolveResult.e.message === 'UNCONFIGURED') { showOnly('unconfigured'); return; }
    showOnly('error');
    $('error-detail').textContent = resolveResult.e.message;
    return;
  }

  const data = resolveResult.d;
  session.resolveData = data;
  $('model-title').textContent = pickStr(data.design, 'title') || 'Untitled Model';

  const hinted = pageProfileId ?? data.profile_id ?? profileIdFromHash(url);
  renderCards(data, hinted);
  applyJob(job);
  showOnly('model');
}

function init() {
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-go-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-import').addEventListener('click', runImport);
  $('btn-retry').addEventListener('click', boot);
  $('btn-select-all').addEventListener('click', () => { for (const id of session.cards.keys()) setSelected(id, true); refreshSelection(); });
  $('btn-select-none').addEventListener('click', () => { for (const id of session.cards.keys()) setSelected(id, false); refreshSelection(); });
  $('btn-new-folder').addEventListener('click', () => showNewFolderRow($('new-folder-row').style.display === 'none'));
  $('btn-cancel-folder').addEventListener('click', () => showNewFolderRow(false));
  $('btn-create-folder').addEventListener('click', createFolder);
  $('new-folder-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createFolder();
    if (e.key === 'Escape') showNewFolderRow(false);
  });
  $('folder-select').addEventListener('change', () =>
    chrome.storage.local.set({ [STORAGE_KEYS.LAST_FOLDER_ID]: selectedFolderId() })
  );
  boot();
}

document.addEventListener('DOMContentLoaded', init);
