# Software design document

## Purpose

Bambuddy Browser Import puts Bambuddy's MakerWorld import where the browsing happens: on the
MakerWorld page. It lets you pick one or more print profiles of a model, choose the library folder,
and have your own Bambuddy instance download and file them, with progress and completion visible in
the browser. It has no backend of its own; everything it does is a call to the Bambuddy API you
configured or a read of the MakerWorld page you are on.

## Architecture

One Manifest V3 codebase, plain JavaScript, no bundler, no build step. The same files load in Chrome
(and every Chromium-based browser) and in Firefox ≥ 140.

| Component | Files | Runs where | Role |
|---|---|---|---|
| Shared constants and helpers | `shared.js` | every context | `STORAGE_KEYS`, `DEFAULTS`, `LIMITS`, `SESSION` key prefixes, `getSettings()`, URL parsers, `thumbUrl()`, `flattenFolders()`. Loaded by `importScripts` in the Chrome service worker, first in `background.scripts` in Firefox, by `<script>` in the pages and as the first content script. |
| Background worker | `background.js` | service worker (Chrome) / event page (Firefox) | The only place that talks to Bambuddy. Resolve cache, folders cache, the import queue, badge, notifications, the dev-settings seed, the message handler. |
| Popup / picker | `popup.html`, `popup.js`, `popup.css` | toolbar popup, or an iframe injected into a MakerWorld page (`?embed=1&url=…[&profile=…]`) | Renders the profile cards, folder picker and job progress. Owns no long-running work. |
| Content script | `content.js` | makerworld.com, isolated world | Answers "which profile is selected on this page?" (URL hash → DOM → `__NEXT_DATA__`). |
| Page script | `page.js` | makerworld.com, isolated world, after `content.js` | Adds the import bubble on model cards and the **Import to Bambuddy** button on model pages, and hosts the embedded picker iframe. |
| Options page | `options.html`, `options.js`, `options.css` | extension page | Connection and behaviour settings, host-permission request, **Test Connection**. |
| Packaging | `scripts/build-crx.py`, `bin/dev-build`, `.github/workflows/release.yml` | CI / developer machine | Zips the extension, signs the Chrome `.crx`, submits to the stores. |

### How they talk

- Pages and content scripts send `chrome.runtime.sendMessage({ action, … })` to the background
  worker, which answers `{ success, data | error }`. Actions: `resolve`, `listFolders`,
  `createFolder`, `startImport`, `getJob`, `clearJob`, `status`, `testConnection`.
- The popup asks the content script of the active tab for the selected profile with
  `chrome.tabs.sendMessage`; `page.js` calls `detectSelectedProfile()` directly, since both run in
  the same isolated world.
- The embedded picker and `page.js` talk across the iframe boundary with `window.postMessage`
  (`source: 'bambuddy-import'`, types `height` and `close`); the model URL and the profile hint go
  in the iframe's query string because an iframe cannot ask for the active tab.
- Job progress reaches the popup through `chrome.storage.onChanged` on the `session` area: the
  worker writes the job after every transition, the popup re-renders whatever it reads.
- `chrome.*` APIs are used with promise returns everywhere, which both browsers support; there are
  no callback wrappers.

## Data model and storage

Everything is in extension storage; there is no database and no file I/O.

**`chrome.storage.local`** (persists, plaintext on disk) — settings keyed by `STORAGE_KEYS`:
`bambuddyUrl`, `apiKey`, `showOpenBtn`, `pageButtons`, `notifyOnComplete`, `importConcurrency`
(1–6, default 3), `resolveCacheTtl` (30–3600 s, default 300), `lastFolderId`.

**`chrome.storage.session`** (cleared when the browser exits):

| Key | Value | Lifetime |
|---|---|---|
| `resolve:<modelId>` | `{ ts, data }` — Bambuddy's resolve response for a model | `resolveCacheTtl` seconds; expired entries are removed before each new one is written |
| `folders` | `{ ts, tree }` — the library folder tree | 60 s, dropped after a folder is created or an import finishes |
| `job:<modelId>` | an `ImportJob` | until `clearJob` or browser exit |

The session area has a fixed quota (10 MB in Chrome). Every write goes through `sessionSet()`: when
the browser refuses a write, it drops all `resolve:*` entries and tries once more. Cache writes
(`resolve:*`, `folders`) are best effort — a write that still fails is logged and the data is
returned anyway; only a job save that still fails is an error.

An `ImportJob` is `{ modelId, title, folderId, tabId, status: running|done|failed, startedAt,
finishedAt, openUrl, items: [{ instanceId, profileId, name, status: pending|running|done|exists|error,
error, libraryFileId, folderId, filename }] }`. One job per model at a time; `runningJobs` in the
worker guards against a duplicate start.

## Key flows

**Resolve (page load → ready popup).** `tabs.onUpdated` fires with `status: 'complete'` for a URL
on makerworld.com; if it is a model URL and Bambuddy is configured, the worker calls
`POST /api/v1/makerworld/resolve {url}` (hash stripped so there is one cache entry per model) and
stores the response under `resolve:<modelId>`. Concurrent requests for the same model share one
in-flight promise. The popup's `resolve` message is then served from the cache, so it opens
instantly; **Try again** passes `force: true`.

**Pick.** The popup renders one card per instance from the resolve data: thumbnail via Bambuddy's
proxy (`/api/v1/makerworld/thumbnail?url=` with the CDN's `image_process=resize,w_200`), print time,
colours, AMS, rating, and an "already in library" marker from `already_imported_library_ids`. The
profile selected on the page (content script) or in the URL hash is pre-selected. The folder picker
is the flattened tree from `GET /api/v1/library/folders`, read-only external folders disabled; the
folder-plus control calls `POST /api/v1/library/folders {name, parent_id}`.

**Import.** `startImport` writes the job and returns at once. `runJob` runs up to
`importConcurrency` workers over the item list, each calling
`POST /api/v1/makerworld/import {model_id, profile_id, instance_id, folder_id}` (there is no batch
endpoint; N plates are N calls). After every item the job is saved and the badge on the originating
tab is updated with the remaining count. A `setInterval` touching session storage every 20 s keeps
the service worker alive while Bambuddy downloads a large 3MF. When all workers finish the job is
marked `done` or `failed`, `openUrl` is computed, the folders cache is dropped (file counts changed),
the badge shows ✓ or ! for five seconds and a notification fires if enabled. Clicking the
notification opens `openUrl`.

**Open in Bambuddy.** Bambuddy's File Manager deep-links by folder only (`/files?folder=N`), so
`buildOpenUrl` prefers the folder Bambuddy reported for a saved item, then the folder you picked,
then — for a re-used existing file — the folder of that file, then the library root.

**Settings save.** `options.js` normalises the URL to an origin, calls
`chrome.permissions.request({ origins: ['<origin>/*'] })` if not yet granted, and only then writes
the settings. **Test Connection** asks the worker for `testConnection`, which runs `GET /health`
(unauthenticated), `GET /api/v1/system/info` (key) and `GET /api/v1/makerworld/status` (cloud token,
best effort) and returns all three.

**Upgrades.** `runtime.onUpdateAvailable` → `runtime.reload()`, so a pending store or dev-build
upgrade applies as soon as it is downloaded instead of waiting for the extension to go idle.

## Configuration surface

- User settings: the options page (see [configuration.md](configuration.md)); every tunable has its
  default and range in `shared.js` and nowhere else.
- Manifest: `manifest.json` — permissions (`storage`, `activeTab`, `notifications`), host
  permission `https://makerworld.com/*`, optional `<all_urls>` for the one Bambuddy origin, both
  `background.service_worker` (Chrome) and `background.scripts` (Firefox), `browser_specific_settings.gecko`
  with the add-on id, `strict_min_version: 140.0` and `data_collection_permissions: none`.
- Dev seed: `dev-settings.json` next to the manifest, read once on install by unpacked builds.
- Release: the `PACKAGE_FILES` list in `.github/workflows/release.yml` is the single definition of
  what ships; `bin/dev-build` reads it from there.

## Decisions and rationale

- **Work lives in the background worker, not the popup.** Browser popups close on blur; a job that
  ran in the popup would be cancelled by a click elsewhere. The popup is a pure view over session
  storage, which also makes "close, reopen, see progress" free.
- **Session storage for cache and jobs.** It survives worker restarts within a browser session and
  is cleared on exit, which is the right lifetime for resolve data and progress and keeps nothing
  stale on disk.
- **Prefetch on page load + per-model TTL cache.** A resolve costs two MakerWorld round-trips inside
  Bambuddy (~0.5 s); doing it when the tab finishes loading is what makes the popup feel instant.
- **Thumbnails at 200 px through Bambuddy's proxy.** The CDN honours `image_process=resize,w_N`,
  turning ~1.3 MB covers into ~8 KB, and the proxy keeps the browser's IP away from the CDN.
- **No `tabs` permission.** `activeTab` plus the MakerWorld host permission cover everything the
  extension needs (the clicked tab's URL, URL changes on makerworld.com) without a broad permission
  that would trigger store review questions.
- **Host permission for Bambuddy requested at save time, for one origin.** Users run Bambuddy at
  arbitrary addresses; asking for `<all_urls>` up front would be far more than needed.
- **Both `service_worker` and `scripts` in the manifest.** Chrome ignores `scripts`, Firefox ignores
  `service_worker`; shipping both is what makes one codebase install in both.
- **Firefox ≥ 140.** `gecko.data_collection_permissions` is required for new AMO submissions and
  understood only from 140.
- **No dynamic `innerHTML`.** Icon markup is constant strings; anything from MakerWorld or Bambuddy
  goes through `textContent`, so a hostile model title cannot script the popup.
- **The in-page picker is the popup in an iframe.** One picker implementation for the toolbar and
  the page; the iframe boundary keeps MakerWorld's page from reading or scripting it.
- **No build step.** Plain scripts keep "edit, reload on `chrome://extensions`" as the whole dev
  loop and make the published package identical to the source.

## Current scope and non-goals

- Imports are plates (print profiles) of MakerWorld models into a Bambuddy library; Bambuddy does
  the downloading with your Bambu Cloud token. The extension holds no Bambu credentials itself.
- One Bambuddy instance per browser profile.
- One import job per model at a time; different models can run concurrently.
- The "Open in Bambuddy" button opens the target folder, which is as deep as Bambuddy's File Manager
  links go today.
- The extension is MV3 and targets Chromium-based browsers and Firefox; Safari is not packaged.

## Operations

- **Logs:** the background worker logs to the extension's service-worker console
  (`chrome://extensions` → Details → *Inspect views: service worker*; `about:debugging` →
  *Inspect* in Firefox) with a `[bambuddy]` prefix. Popup and options log to their own DevTools.
- **Health:** **Test Connection** on the options page is the health check for the whole chain
  (reachability, key, cloud token). The toolbar badge shows a green ↓ when a model is resolved, a
  count while importing, ✓/! when done.
- **Upgrade:** store installs update through the browser and apply immediately thanks to the
  `onUpdateAvailable` reload. Unpacked installs: pull and hit *Reload* on the extensions page, or
  install the next `bin/dev-build` `.crx` over the previous one (same dev key → same id → storage
  is kept).
- **Reset:** remove the extension (clears `storage.local`) or clear the URL and key on the options
  page. Session caches vanish on browser exit.
- **Releasing:** bump `version` in `manifest.json` and push to `main`; see
  [CONTRIBUTING.md](../CONTRIBUTING.md) → Releasing.
