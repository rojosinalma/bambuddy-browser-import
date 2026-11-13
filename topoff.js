/**
 * Collection Top-off on makerworld.com /collections/ pages.
 *
 * Scans visible cards for Bambuddy membership via resolve (session-cached),
 * paints In library / Needs import, and batch-imports missing default plates
 * into the last-used folder through startImport. Loaded after page.js.
 *
 * Membership today = resolve.already_imported_library_ids (MakerWorld I/O inside
 * Bambuddy). A future DB-only library-status API would replace the probe path
 * without changing this UI.
 */

(() => {
  const MARK          = 'data-bambuddy-topoff';
  const STYLE_ID      = 'bambuddy-topoff-style';
  const CARD_SELECTOR = '.js-design-card, [class*="design-card"]';
  const MODEL_LINK    = 'a[href*="/models/"]';
  const SCAN_DELAY    = 120;
  // Layout / pills only — colours + .bbi-btn* come from shared-ui.css.
  const CSS = `
    .bbi-topoff {
      position: fixed; right: 24px; bottom: 24px; z-index: 2147483645;
      display: flex; flex-direction: column; gap: 8px;
      width: min(360px, calc(100vw - 48px));
      padding: 12px 14px;
    }
    .bbi-topoff[hidden] { display: none !important; }
    .bbi-topoff__summary { font-weight: 600; font-size: 13px; color: var(--text); letter-spacing: .01em; }
    .bbi-topoff__status {
      display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 600;
    }
    .bbi-topoff__status--busy { color: var(--green); }
    .bbi-topoff__status[hidden] { display: none !important; }
    .bbi-topoff__status--busy .bbi-topoff__pulse { display: block; }
    .bbi-topoff__status--error { color: var(--danger); }
    .bbi-topoff__pulse {
      display: none; width: 8px; height: 8px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 0 0 rgba(29,185,84,.5); flex: 0 0 auto;
      animation: bbi-topoff-pulse 1.2s ease-out infinite;
    }
    @keyframes bbi-topoff-pulse {
      0% { box-shadow: 0 0 0 0 rgba(29,185,84,.45); }
      70% { box-shadow: 0 0 0 8px rgba(29,185,84,0); }
      100% { box-shadow: 0 0 0 0 rgba(29,185,84,0); }
    }
    .bbi-topoff__hint { margin: 0; }
    .bbi-topoff__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .bbi-topoff-pill {
      appearance: none; display: inline-flex; align-items: center; gap: 4px;
      margin-left: 6px; padding: 2px 8px 2px 4px; border-radius: 999px;
      border: 1px solid var(--border); background: rgba(15,17,23,.88);
      color: var(--text); font: 650 11px/1 var(--font);
      vertical-align: middle; min-height: 22px; cursor: default;
    }
    .bbi-topoff-pill__dot {
      width: 14px; height: 14px; border-radius: 50%; display: grid; place-items: center;
      background: var(--muted); color: #fff; font-size: 9px; line-height: 1;
    }
    .bbi-topoff-pill--needs { color: #f5d78e; border-color: rgba(196,140,20,.55); }
    .bbi-topoff-pill--needs .bbi-topoff-pill__dot { background: #c48c14; }
    .bbi-topoff-pill--library { color: #4ade80; border-color: rgba(29,185,84,.5); }
    .bbi-topoff-pill--library .bbi-topoff-pill__dot { background: var(--green); }
    .bbi-topoff-pill--busy { color: #60a9ff; border-color: rgba(96,169,255,.45); }
    .bbi-topoff-pill--busy .bbi-topoff-pill__dot { background: #60a9ff; }
    .bbi-topoff-pill--error { color: var(--danger); border-color: rgba(255,112,112,.5); }
    .bbi-topoff-pill--error .bbi-topoff-pill__dot { background: var(--danger); }
    .bbi-topoff-pill--importing { animation: bbi-pill-pulse 1.4s ease-in-out infinite; }
    @keyframes bbi-pill-pulse {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.08); }
    }
    /* Same treatment as Choose for non-targets — dim in place. Hiding with
       display:none leaves empty MakerWorld grid cells ("white holes"). */
    .bbi-topoff-card--dimmed { opacity: .4; filter: grayscale(.2); pointer-events: none; }
    .bbi-topoff-pick {
      position: absolute; top: 10px; left: 10px; z-index: 6;
      display: grid; place-items: center; width: 28px; height: 28px;
      padding: 0; margin: 0;
      border-radius: 999px; background: rgba(15,17,23,.88);
      border: 2px solid var(--border); cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
    }
    .bbi-topoff-pick.is-on {
      border-color: var(--green); background: var(--green);
    }
    .bbi-topoff-pick.is-on::after {
      content: '';
      width: 8px; height: 12px;
      border: solid #fff;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg) translate(-1px, -1px);
    }
  `;

  let enabled       = true;
  let configured    = false;
  let checkLimit    = DEFAULTS[STORAGE_KEYS.TOP_OFF_CHECKS];
  let lastFolderId  = null;
  let settingsReady = false;

  let bar           = null;
  let selectMode    = false;
  let missingOnly   = false;
  let importing     = false;
  const selected    = new Set();
  const batchIds    = new Set();
  let batchDoneAt   = 0;

  const stateById   = new Map();   // modelId → { status, detail, libraryIds, title, url, card }
  const probed      = new Set();
  const probeQueue  = [];
  let probeRunning  = false;
  let probeTimer    = null;
  let backoffUntil  = 0;
  let cooldownTimer = null;

  let observer      = null;
  let scanTimer     = null;
  let lastHref      = location.href;

  function send(message) {
    return chrome.runtime.sendMessage(message).then(response => {
      if (!response?.success) throw new Error(response?.error ?? 'Extension request failed.');
      return response.data;
    });
  }

  function isCollectionPage() {
    return /\/collections\//i.test(location.pathname);
  }

  function topoffActiveHere() {
    return settingsReady && enabled && configured && isCollectionPage();
  }

  function ensureStyle() {
    const head = document.head ?? document.documentElement;
    if (!document.getElementById(`${STYLE_ID}-shared`)) {
      const link = document.createElement('link');
      link.id = `${STYLE_ID}-shared`;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('shared-ui.css');
      head.appendChild(link);
    }
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    head.appendChild(style);
  }

  function cardModelUrl(card) {
    let a = null;
    if (card.matches?.(MODEL_LINK)) a = card;
    else a = card.querySelector?.(MODEL_LINK) ?? card.closest?.(MODEL_LINK);
    if (!a) return null;
    const url = a.href;
    const id = modelIdFromUrl(url);
    if (id === null) return null;
    for (const other of card.querySelectorAll?.(MODEL_LINK) ?? []) {
      const otherId = modelIdFromUrl(other.href);
      if (otherId !== null && otherId !== id) return null;
    }
    return url.split('#')[0].split('?')[0];
  }

  function setState(modelId, patch) {
    const prev = stateById.get(modelId) || { status: 'idle', detail: '', libraryIds: [], title: null, url: null };
    const next = { ...prev, ...patch };
    stateById.set(modelId, next);
    return next;
  }

  function isRateLimitError(error) {
    return /429|rate-?limit/i.test(String(error?.message || error || ''));
  }

  function coolingDown() {
    return Date.now() < backoffUntil;
  }

  function coolSecs() {
    return Math.max(0, Math.ceil((backoffUntil - Date.now()) / 1000));
  }

  function noteBackoff(errorOrForce = true) {
    if (errorOrForce !== true && !isRateLimitError(errorOrForce)) return;
    backoffUntil = Math.max(backoffUntil, Date.now() + TOPOFF_TIMING.BACKOFF_MS);
    scheduleCooldownUi();
  }

  function scheduleCooldownUi() {
    paintBar();
    paintCards();
    if (cooldownTimer) return;
    const tick = () => {
      cooldownTimer = null;
      paintBar();
      paintCards();
      if (coolingDown()) cooldownTimer = setTimeout(tick, 1000);
      else if (probeQueue.length) scheduleProbe();
    };
    cooldownTimer = setTimeout(tick, 1000);
  }

  function applyMembership(modelId, libraryIds) {
    const ids = Array.isArray(libraryIds) ? libraryIds : [];
    const imported = ids.length > 0;
    setState(modelId, {
      libraryIds: ids,
      status: imported ? 'in-library' : 'needs-import',
      detail: imported ? 'Already in your Bambuddy library' : 'Not in Bambuddy yet'
    });
  }

  function queueProbe(modelId, url) {
    if (!topoffActiveHere() || !Number.isFinite(modelId)) return;
    if (probed.has(modelId)) {
      return;
    }
    probed.add(modelId);

    const existing = stateById.get(modelId);
    if (existing && (existing.status === 'in-library' || existing.status === 'needs-import')
        && Array.isArray(existing.libraryIds)) {
      paintCards();
      paintBar();
      return;
    }

    probeQueue.push({ modelId, url });
    scheduleProbe();
  }

  function scheduleProbe() {
    if (probeTimer || probeRunning) return;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      pumpProbe().catch(() => {});
    }, 40);
  }

  async function probeOne(item) {
    const cur = stateById.get(item.modelId);
    if (cur && (cur.status === 'importing' || cur.status === 'queued')) return;

    setState(item.modelId, { status: 'probing', detail: 'Checking Bambuddy…', url: item.url });
    paintCards();
    try {
      const data = await send({ action: 'resolve', url: item.url });
      applyMembership(item.modelId, alreadyImportedIds(data));
      const title = pickStr(data?.design, 'title');
      if (title) setState(item.modelId, { title });
      setState(item.modelId, { resolveData: data });
    } catch (error) {
      if (isRateLimitError(error)) {
        noteBackoff(error);
        probed.delete(item.modelId);
        probeQueue.unshift(item);
        setState(item.modelId, {
          status: 'idle',
          detail: `MakerWorld rate-limited — wait ${coolSecs()}s`
        });
      } else {
        setState(item.modelId, {
          status: 'idle',
          detail: 'Could not check Bambuddy'
        });
      }
    }
  }

  async function pumpProbe() {
    if (probeRunning) return;
    probeRunning = true;
    try {
      while (probeQueue.length) {
        const waitMs = backoffUntil - Date.now();
        if (waitMs > 0) {
          paintBar();
          await new Promise(r => setTimeout(r, Math.min(waitMs, TOPOFF_TIMING.BACKOFF_MS)));
          continue;
        }
        const batch = [];
        while (batch.length < checkLimit && probeQueue.length) {
          const item = probeQueue.shift();
          if (item) batch.push(item);
        }
        if (!batch.length) break;
        paintBar();
        await Promise.all(batch.map(probeOne));
        paintCards();
        if (selectMode) paintSelectMode();
        paintBar();
        if (probeQueue.length) {
          await new Promise(r => setTimeout(r, TOPOFF_TIMING.BATCH_GAP_MS));
        }
      }
    } finally {
      probeRunning = false;
      if (probeQueue.length) scheduleProbe();
      paintBar();
    }
  }

  function enhanceCard(card) {
    if (!(card instanceof Element)) return;
    if (card.parentElement?.closest(CARD_SELECTOR)) return;
    const url = cardModelUrl(card);
    const modelId = modelIdFromUrl(url);
    if (!url || modelId === null) return;

    if (card.getAttribute(MARK) === 'card' && card._bbiTopoff?.pill?.isConnected) {
      // Already painted — still ensure membership is queued (DOM-loaded, not
      // viewport-gated). IntersectionObserver used to wait for scroll; that
      // left "N left to check" hanging for above-the-fold cards.
      queueProbe(modelId, url);
      return;
    }

    const row = card.querySelector('.design-bottom-row') || card;
    const stats = row.lastElementChild || row;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'bbi-topoff-pill';
    pill.setAttribute(MARK, 'pill');
    const dot = document.createElement('span');
    dot.className = 'bbi-topoff-pill__dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.setAttribute(MARK, 'pill-label');
    pill.append(dot, label);
    stats.append(pill);

    const title = card.querySelector(MODEL_LINK)?.textContent?.trim() || null;
    setState(modelId, { url, title: title || stateById.get(modelId)?.title || null, card });
    card.setAttribute(MARK, 'card');
    card._bbiTopoff = { pill, modelId, url, dot, label };
    queueProbe(modelId, url);
    paintOneCard(card);
  }

  /** Apply membership from a background import job (picker or Top-off). */
  function syncFromJob(job) {
    if (!job || !Number.isFinite(Number(job.modelId))) return;
    const modelId = Number(job.modelId);
    if (job.status === 'running') {
      const st = stateById.get(modelId)?.status;
      if (st !== 'in-library') {
        setState(modelId, { status: 'importing', detail: 'Importing…' });
      }
      paintCards();
      paintBar();
      return;
    }
    if (job.status === 'done') {
      const ids = (job.items || [])
        .map(i => i.libraryFileId)
        .filter(id => Number.isFinite(Number(id)))
        .map(Number);
      if (ids.length) applyMembership(modelId, ids);
      else setState(modelId, {
        status: 'in-library',
        detail: 'Already in your Bambuddy library',
        libraryIds: stateById.get(modelId)?.libraryIds || []
      });
      probed.add(modelId);
      paintCards();
      paintBar();
      return;
    }
    if (job.status === 'failed') {
      const anyOk = (job.items || []).some(i => i.status === 'done' || i.status === 'exists');
      if (anyOk) {
        const ids = (job.items || [])
          .map(i => i.libraryFileId)
          .filter(id => Number.isFinite(Number(id)))
          .map(Number);
        if (ids.length) applyMembership(modelId, ids);
        else setState(modelId, { status: 'in-library', detail: 'Already in your Bambuddy library' });
      } else {
        const err = job.items?.find(i => i.status === 'error')?.error || 'Import failed';
        setState(modelId, { status: 'error', detail: err });
      }
      paintCards();
      paintBar();
    }
  }

  function onSessionChange(changes) {
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(SESSION.JOB)) continue;
      syncFromJob(change.newValue ?? null);
    }
  }

  function paintOneCard(card) {
    const meta = card._bbiTopoff;
    if (!meta?.pill?.isConnected) return;
    const st = stateById.get(meta.modelId) || { status: 'idle' };
    const pill = meta.pill;
    const label = meta.label;
    const dot = meta.dot;
    pill.className = 'bbi-topoff-pill';
    let text = '…';
    let glyph = '·';
    switch (st.status) {
      case 'needs-import':
        pill.classList.add('bbi-topoff-pill--needs');
        text = 'Needs import';
        glyph = '+';
        break;
      case 'in-library':
        pill.classList.add('bbi-topoff-pill--library');
        text = 'In library';
        glyph = '✓';
        break;
      case 'probing':
        pill.classList.add('bbi-topoff-pill--busy');
        text = 'Checking';
        glyph = '…';
        break;
      case 'queued':
      case 'importing':
        pill.classList.add('bbi-topoff-pill--busy', 'bbi-topoff-pill--importing');
        text = st.status === 'queued' ? 'Queued' : 'Importing';
        glyph = '…';
        break;
      case 'error':
        pill.classList.add('bbi-topoff-pill--error');
        text = 'Retry';
        glyph = '!';
        break;
      default:
        text = '…';
        glyph = '·';
    }
    label.textContent = text;
    dot.textContent = glyph;
    pill.title = st.detail || text;
  }

  function paintCards() {
    for (const card of document.querySelectorAll(`.js-design-card[${MARK}="card"], [${MARK}="card"]`)) {
      paintOneCard(card);
    }
    paintMissingOnly();
  }

  function loadedMetas() {
    const out = [];
    for (const card of document.querySelectorAll(`[${MARK}="card"]`)) {
      const meta = card._bbiTopoff;
      if (!meta?.pill?.isConnected) continue;
      out.push(meta);
    }
    return out;
  }

  function snapshot() {
    const loaded = loadedMetas();
    let checking = 0, missing = 0, failed = 0, inLibrary = 0, inFlight = 0;
    const missingItems = [];
    const failedItems = [];
    for (const meta of loaded) {
      const st = stateById.get(meta.modelId);
      const status = st?.status;
      if (status === 'queued' || status === 'importing') { inFlight += 1; continue; }
      if (status === 'error') { failed += 1; failedItems.push(meta); continue; }
      if (status === 'probing' || status === 'idle' || !status) { checking += 1; continue; }
      if (status === 'in-library') { inLibrary += 1; continue; }
      if (status === 'needs-import') { missing += 1; missingItems.push(meta); continue; }
      checking += 1;
    }
    return {
      loaded: loaded.length,
      checking, missing, failed, inLibrary, inFlight,
      missingItems, failedItems,
      actionableItems: [...failedItems, ...missingItems],
      scanned: loaded.length - checking
    };
  }

  function batchProgress() {
    if (!batchIds.size) return null;
    let done = 0, failed = 0, active = 0;
    for (const modelId of batchIds) {
      const status = stateById.get(modelId)?.status;
      if (status === 'queued' || status === 'importing') active += 1;
      else if (status === 'in-library') done += 1;
      else if (status === 'error') failed += 1;
      else active += 1;
    }
    const progress = { total: batchIds.size, done, failed, active };
    if (active === 0 && done + failed >= progress.total) {
      if (!batchDoneAt) batchDoneAt = Date.now();
      if (Date.now() - batchDoneAt > 2500) {
        batchIds.clear();
        batchDoneAt = 0;
        return null;
      }
    } else {
      batchDoneAt = 0;
    }
    return progress;
  }

  function ensureBar() {
    if (bar?.isConnected) return bar;
    ensureStyle();
    const el = document.createElement('div');
    el.className = 'bbi-panel bbi-theme bbi-topoff';
    el.setAttribute(MARK, 'bar');
    el.setAttribute('role', 'status');
    el.hidden = true;

    const head = document.createElement('div');
    const brand = document.createElement('div');
    brand.className = 'bbi-brand';
    brand.textContent = 'Bambuddy';
    const summary = document.createElement('div');
    summary.className = 'bbi-topoff__summary';
    summary.setAttribute(MARK, 'summary');
    head.append(brand, summary);

    const status = document.createElement('div');
    status.className = 'bbi-topoff__status';
    status.setAttribute(MARK, 'status');
    status.hidden = true;
    const pulse = document.createElement('span');
    pulse.className = 'bbi-topoff__pulse';
    pulse.setAttribute('aria-hidden', 'true');
    const statusText = document.createElement('span');
    statusText.setAttribute(MARK, 'status-text');
    status.append(pulse, statusText);

    const hint = document.createElement('p');
    hint.className = 'bbi-topoff__hint bbi-muted';
    hint.setAttribute(MARK, 'hint');

    const actions = document.createElement('div');
    actions.className = 'bbi-topoff__actions';

    function btn(cls, mark, text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.setAttribute(MARK, mark);
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b;
    }

    const retryBtn = btn('bbi-btn bbi-btn--danger', 'retry', 'Retry failed', () => {
      importMetas(snapshot().failedItems).catch(() => {});
    });
    const importMissingBtn = btn('bbi-btn bbi-btn--primary', 'import-missing', 'Import missing', () => {
      const snap = snapshot();
      const items = snap.missingItems.length ? snap.missingItems : snap.failedItems;
      importMetas(items).catch(() => {});
    });
    const chooseBtn = btn('bbi-btn bbi-btn--secondary', 'choose', 'Choose…', () => enterSelectMode());
    const missingOnlyBtn = btn('bbi-btn bbi-btn--secondary', 'missing-only', 'Missing only', () => {
      missingOnly = !missingOnly;
      paintMissingOnly();
      paintBar();
    });
    const dismissBtn = btn('bbi-btn bbi-btn--secondary', 'dismiss', 'Clear retries', () => {
      for (const meta of snapshot().failedItems) {
        const ids = stateById.get(meta.modelId)?.libraryIds;
        if (Array.isArray(ids)) applyMembership(meta.modelId, ids);
        else setState(meta.modelId, { status: 'needs-import', detail: 'Not in Bambuddy yet' });
      }
      batchIds.clear();
      batchDoneAt = 0;
      paintCards();
      paintBar();
    });
    const cancelBtn = btn('bbi-btn bbi-btn--secondary', 'cancel', 'Cancel', () => exitSelectMode());
    cancelBtn.hidden = true;
    const importSelectedBtn = btn('bbi-btn bbi-btn--primary', 'import-selected', 'Import selected', () => {
      const ids = new Set([...selected].map(Number));
      const items = snapshot().actionableItems.filter(m => ids.has(Number(m.modelId)));
      exitSelectMode();
      importMetas(items).catch(() => {});
    });
    importSelectedBtn.hidden = true;

    actions.append(retryBtn, importMissingBtn, chooseBtn, missingOnlyBtn, dismissBtn, cancelBtn, importSelectedBtn);
    el.append(head, status, hint, actions);
    document.documentElement.append(el);
    bar = el;
    return el;
  }

  function paintBar() {
    if (!topoffActiveHere()) {
      if (selectMode) exitSelectMode();
      missingOnly = false;
      paintMissingOnly();
      bar?.remove();
      bar = null;
      return;
    }

    const snap = snapshot();
    if (!snap.loaded) {
      if (selectMode) exitSelectMode();
      bar?.remove();
      bar = null;
      return;
    }

    const el = ensureBar();
    el.hidden = false;
    const summary = el.querySelector(`[${MARK}="summary"]`);
    const status = el.querySelector(`[${MARK}="status"]`);
    const statusText = el.querySelector(`[${MARK}="status-text"]`);
    const hint = el.querySelector(`[${MARK}="hint"]`);
    const retryBtn = el.querySelector(`[${MARK}="retry"]`);
    const importMissingBtn = el.querySelector(`[${MARK}="import-missing"]`);
    const chooseBtn = el.querySelector(`[${MARK}="choose"]`);
    const missingOnlyBtn = el.querySelector(`[${MARK}="missing-only"]`);
    const dismissBtn = el.querySelector(`[${MARK}="dismiss"]`);
    const cancelBtn = el.querySelector(`[${MARK}="cancel"]`);
    const importSelectedBtn = el.querySelector(`[${MARK}="import-selected"]`);
    if (!summary || !status || !statusText || !hint) return;

    const progress = batchProgress();
    const batchBusy = Boolean(importing || (progress && progress.active > 0));
    const cool = coolingDown();
    const secs = coolSecs();

    status.classList.toggle('bbi-topoff__status--busy', batchBusy || snap.checking > 0 || cool);
    status.classList.toggle('bbi-topoff__status--error', !cool && snap.failed > 0 && !batchBusy && snap.checking === 0);

    if (selectMode) {
      summary.textContent = selected.size === 1 ? '1 model selected' : `${selected.size} models selected`;
      status.hidden = true;
      hint.textContent = cool
        ? `MakerWorld rate-limited — wait ${secs}s before importing`
        : 'Dimmed cards are already in Bambuddy.';
    } else if (cool) {
      summary.textContent = 'Paused — MakerWorld rate limit';
      status.hidden = false;
      statusText.textContent = `Try again in ${secs}s`;
      hint.textContent = 'Checks and imports are paused so we don’t dig a deeper hole.';
    } else if (batchBusy) {
      summary.textContent = 'Importing into Bambuddy…';
      status.hidden = false;
      statusText.textContent = progress
        ? `Imported ${progress.done} of ${progress.total}`
        : 'Starting…';
      hint.textContent = 'Hang tight — imports run in the background.';
    } else if (snap.checking > 0) {
      summary.textContent = snap.scanned
        ? 'Checking newly loaded models…'
        : 'Checking what’s already in Bambuddy…';
      status.hidden = false;
      statusText.textContent = snap.checking === 1 ? '1 left to check' : `${snap.checking} left to check`;
      hint.textContent = 'Scroll down to check more!';
    } else if (snap.failed > 0) {
      summary.textContent = snap.failed === 1 ? '1 import failed' : `${snap.failed} cards need a retry`;
      status.hidden = false;
      statusText.textContent = 'Retry failed, or Clear retries';
      hint.textContent = 'Scroll down to check more!';
    } else if (snap.missing > 0) {
      summary.textContent = snap.scanned
        ? `${snap.missing} missing of ${snap.scanned} checked`
        : `${snap.missing} models aren’t in Bambuddy yet`;
      if (snap.inLibrary > 0) {
        status.hidden = false;
        statusText.textContent = snap.inLibrary === 1
          ? '1 already in library'
          : `${snap.inLibrary} already in library`;
      } else {
        status.hidden = true;
      }
      hint.textContent = 'Scroll down to check more!';
    } else {
      summary.textContent = snap.inLibrary
        ? (snap.scanned ? `0 missing of ${snap.scanned} checked` : 'Everything here is already in Bambuddy')
        : 'Nothing to import on this page yet';
      status.hidden = true;
      hint.textContent = 'Scroll for more — new cards get checked as they show up.';
    }

    if (missingOnly && !selectMode && !batchBusy && !cool) {
      hint.textContent = snap.missing
        ? 'In-library cards are dimmed — scroll still loads more to check.'
        : 'No missing cards in this loaded batch — scroll for more, or turn off Missing only.';
    }

    // During a batch, keep the chrome simple — progress line + Importing… only.
    const showActions = !batchBusy || selectMode;
    retryBtn.hidden = !(showActions && snap.failed > 0 && !selectMode);
    importMissingBtn.hidden = !showActions || selectMode
      || !(snap.missing > 0 || (snap.failed > 0 && snap.missing === 0));
    if (snap.failed > 0 && snap.missing === 0) importMissingBtn.hidden = true;
    chooseBtn.hidden = !showActions || selectMode;
    dismissBtn.hidden = !(showActions && snap.failed > 0 && !selectMode);
    cancelBtn.hidden = !selectMode;
    importSelectedBtn.hidden = !selectMode;
    missingOnlyBtn.hidden = !showActions || selectMode;
    missingOnlyBtn.classList.toggle('is-active', missingOnly);
    missingOnlyBtn.setAttribute('aria-pressed', missingOnly ? 'true' : 'false');
    missingOnlyBtn.textContent = missingOnly ? 'Show all' : 'Missing only';

    const blocked = cool || importing || batchBusy;
    retryBtn.disabled = blocked;
    importMissingBtn.disabled = blocked || snap.missing === 0;
    // Choose stays available whenever there is something to pick — Missing only
    // is only a filter, not a different import mode.
    chooseBtn.disabled = snap.actionableItems.length === 0 || blocked;
    importSelectedBtn.disabled = selected.size === 0 || blocked;
    importSelectedBtn.textContent = selected.size
      ? `Import selected (${selected.size})`
      : 'Import selected';
    importMissingBtn.textContent = cool ? `Wait ${secs}s` : 'Import missing';
  }

  function cardIsSelectable(modelId) {
    const st = stateById.get(modelId)?.status;
    return st === 'needs-import' || st === 'error';
  }

  /** Dim in-library (and other non-targets) — shared by Missing only + Choose. */
  function paintCardEmphasis() {
    for (const card of document.querySelectorAll(`[${MARK}="card"]`)) {
      const meta = card._bbiTopoff;
      if (!meta) continue;
      card.querySelector(`[${MARK}="pick"]`)?.remove();
      card.classList.remove('bbi-topoff-card--dimmed');

      if (selectMode) {
        if (!cardIsSelectable(meta.modelId)) {
          card.classList.add('bbi-topoff-card--dimmed');
          continue;
        }
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'bbi-topoff-pick';
        pick.setAttribute(MARK, 'pick');
        pick.setAttribute('aria-label', 'Select for import');
        const on = selected.has(meta.modelId);
        pick.setAttribute('aria-pressed', on ? 'true' : 'false');
        pick.classList.toggle('is-on', on);
        pick.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (selected.has(meta.modelId)) selected.delete(meta.modelId);
          else selected.add(meta.modelId);
          paintCardEmphasis();
          paintBar();
        });
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        card.append(pick);
        continue;
      }

      if (missingOnly && !cardIsSelectable(meta.modelId)) {
        card.classList.add('bbi-topoff-card--dimmed');
      }
    }
  }

  function paintMissingOnly() {
    paintCardEmphasis();
  }

  function enterSelectMode() {
    const snap = snapshot();
    if (!snap.actionableItems.length || importing) return;
    selectMode = true;
    selected.clear();
    for (const meta of snap.actionableItems) selected.add(meta.modelId);
    paintCardEmphasis();
    paintBar();
  }

  function exitSelectMode() {
    selectMode = false;
    selected.clear();
    paintCardEmphasis();
    paintBar();
  }

  function paintSelectMode() {
    paintCardEmphasis();
  }

  async function waitForJob(modelId) {
    for (;;) {
      const job = await send({ action: 'getJob', modelId }).catch(() => null);
      paintBar();
      if (!job || job.status === 'done' || job.status === 'failed') return job;
      await new Promise(r => setTimeout(r, TOPOFF_TIMING.JOB_POLL_MS));
    }
  }

  async function importOne(meta) {
    setState(meta.modelId, { status: 'queued', detail: 'Queued' });
    paintCards();
    paintBar();

    let data = stateById.get(meta.modelId)?.resolveData;
    if (!data) {
      data = await send({ action: 'resolve', url: meta.url });
      setState(meta.modelId, { resolveData: data });
    }

    const existing = alreadyImportedIds(data);
    if (existing.length && stateById.get(meta.modelId)?.status !== 'error') {
      // Force path for failed retries still goes through import; skip only clean misses.
    }

    const plate = pickDefaultPlate(data);
    if (!plate) throw new Error('No print profile to import.');

    setState(meta.modelId, { status: 'importing', detail: 'Importing…' });
    paintCards();

    await send({
      action:   'startImport',
      modelId:  meta.modelId,
      title:    stateById.get(meta.modelId)?.title || pickStr(data?.design, 'title') || meta.url,
      folderId: lastFolderId,
      items:    [{ profileId: plate.profileId, instanceId: plate.instanceId, name: plate.name }]
    });

    const job = await waitForJob(meta.modelId);
    if (!job || job.status === 'failed') {
      const errItem = job?.items?.find(i => i.status === 'error');
      throw new Error(errItem?.error || 'Import failed');
    }
    const ids = (job.items || [])
      .map(i => i.libraryFileId)
      .filter(id => Number.isFinite(Number(id)))
      .map(Number);
    // Job finished without failure → treat as in library even if Bambuddy
    // omitted libraryFileId on an "already exists" item.
    if (ids.length) applyMembership(meta.modelId, ids);
    else setState(meta.modelId, {
      status: 'in-library',
      detail: 'Already in your Bambuddy library',
      libraryIds: stateById.get(meta.modelId)?.libraryIds || []
    });
  }

  async function importMetas(metas) {
    if (!metas?.length || importing) return;
    if (coolingDown()) { paintBar(); return; }

    const unique = [];
    const seen = new Set();
    for (const meta of metas) {
      const id = Number(meta.modelId);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      unique.push(meta);
    }
    if (!unique.length) return;

    importing = true;
    batchIds.clear();
    batchDoneAt = 0;
    for (const meta of unique) batchIds.add(meta.modelId);
    paintBar();

    try {
      // One model at a time — each startImport already parallelises plates.
      for (const meta of unique) {
        if (coolingDown()) break;
        try {
          await importOne(meta);
        } catch (error) {
          if (isRateLimitError(error)) {
            noteBackoff(error);
            setState(meta.modelId, { status: 'error', detail: error.message });
            break;
          }
          setState(meta.modelId, { status: 'error', detail: error.message || 'Import failed' });
        }
        paintCards();
        paintBar();
      }
    } finally {
      importing = false;
      paintCards();
      paintBar();
    }
  }

  function clearCards() {
    for (const card of document.querySelectorAll(`[${MARK}="card"]`)) {
      card.querySelector(`[${MARK}="pill"]`)?.remove();
      card.querySelector(`[${MARK}="pick"]`)?.remove();
      card.removeAttribute(MARK);
      card.classList.remove('bbi-topoff-card--dimmed');
      delete card._bbiTopoff;
    }
    probed.clear();
    probeQueue.length = 0;
  }

  function scan() {
    if (!topoffActiveHere()) {
      clearCards();
      paintBar();
      return;
    }
    ensureStyle();
    for (const card of document.querySelectorAll(CARD_SELECTOR)) enhanceCard(card);
    const snap = snapshot();
    paintCards();
    paintBar();
  }

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (location.href !== lastHref) {
        lastHref = location.href;
        if (selectMode) exitSelectMode();
        missingOnly = false;
        clearCards();
      }
      scan();
    }, SCAN_DELAY);
  }

  async function loadSettings() {
    const s = await getSettings();
    // getSettings merges DEFAULTS — false must win over the default true.
    enabled = s[STORAGE_KEYS.TOP_OFF] !== false;
    configured = Boolean(s[STORAGE_KEYS.BAMBUDDY_URL] && s[STORAGE_KEYS.API_KEY]);
    checkLimit = clamp(
      s[STORAGE_KEYS.TOP_OFF_CHECKS],
      LIMITS.TOP_OFF_CHECKS,
      DEFAULTS[STORAGE_KEYS.TOP_OFF_CHECKS]
    );
    lastFolderId = s[STORAGE_KEYS.LAST_FOLDER_ID] ?? null;
    settingsReady = true;
  }

  function applySettingsSideEffects() {
    if (!topoffActiveHere()) {
      if (selectMode) exitSelectMode();
      missingOnly = false;
      clearCards();
      bar?.remove();
      bar = null;
      return;
    }
    scheduleScan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    // Best-effort: some browsers expose session changes to content scripts.
    if (area === 'session') {
      onSessionChange(changes);
      return;
    }
    if (area !== 'local') return;
    const keys = [
      STORAGE_KEYS.TOP_OFF, STORAGE_KEYS.TOP_OFF_CHECKS,
      STORAGE_KEYS.BAMBUDDY_URL, STORAGE_KEYS.API_KEY, STORAGE_KEYS.LAST_FOLDER_ID
    ];
    if (!keys.some(k => k in changes)) return;
    loadSettings().then(applySettingsSideEffects).catch(() => {});
  });
  if (chrome.storage.session?.onChanged?.addListener) {
    chrome.storage.session.onChanged.addListener(onSessionChange);
  }

  // Primary sync path: background broadcasts job updates to MakerWorld tabs.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.action !== 'jobUpdate') return;
    syncFromJob(message.job);
  });

  loadSettings()
    .then(() => {
      observer = new MutationObserver(() => scheduleScan());
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleScan();
    })
    .catch(() => {});
})();
