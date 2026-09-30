# Bambuddy Browser Import

Import MakerWorld print profiles into your [Bambuddy](https://github.com/maziggy/bambuddy) library
from the browser — pick the plates, pick the folder, one click. Works in Chrome and Firefox from the
same codebase.

Based on [wolfrage76/Bambuddy-Extension](https://github.com/wolfrage76/Bambuddy-Extension), reworked with:

- **Multi-select** — import one plate, a few, or all of them in one go
- **Folder picker** — choose the target library folder (or create one) instead of always landing in `MakerWorld/`
- **Background imports** — the job runs in the extension's background worker, so closing the popup no longer cancels it; reopen it to see live progress, or wait for the desktop notification
- **Instant popup** — models are resolved the moment the page loads and cached; thumbnails are fetched at 200 px instead of full size (~8 KB instead of ~1.3 MB each)
- **Open in Bambuddy** always lands in the folder the plates were saved to

---

## Installation

### Chrome / Chromium / Edge / Brave

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Pin the icon via the puzzle-piece menu

### Firefox (≥ 140)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `manifest.json`

Temporary add-ons are removed when Firefox exits; a signed build will follow.

---

## First-time setup

Click the extension icon → gear (⚙), or right-click the icon → **Options**.

### 1. Bambuddy URL

| Setup | Example URL |
|---|---|
| Local network | `http://192.168.1.100:8000` |
| Docker on same machine | `http://localhost:8000` |
| Reverse-proxied with HTTPS | `https://bambuddy.example.com` |

Saving asks the browser for permission to reach that one origin — the extension does not hold a
blanket host permission.

### 2. API key

Create a dedicated key in Bambuddy under **Settings → API Keys → Create API Key**:

- enable **Manage Library** (saving files, importing from MakerWorld, listing/creating folders)
- enable **Allow cloud access** (Bambuddy uses your Bambu Cloud token to download from MakerWorld)
- make sure a Bambu Cloud account is linked under **Settings → Bambu Cloud**

Paste the key, click **Test Connection**, then **Save**. The test runs three checks:
`GET /health` (reachable), `GET /api/v1/system/info` (key valid, shows version),
`GET /api/v1/makerworld/status` (cloud token present).

### 3. Behaviour

| Setting | Default | What it does |
|---|---|---|
| Parallel imports | 3 | Plates downloaded concurrently when several are selected |
| Notify when an import finishes | on | Desktop notification with the outcome; clicking it opens the folder in Bambuddy |
| Model cache | 300 s | How long a resolved model page is kept so the popup opens instantly |
| Show "Open in Bambuddy" | on | Button to jump to the target folder after an import |

---

## Usage

1. Open any model page on [makerworld.com](https://makerworld.com) — the toolbar icon shows a green **↓**
2. Click the icon. The profile you clicked on the page (or MakerWorld's default) is pre-selected
3. Click more cards to add them, or use **All** / **None**
4. Pick the target folder (the last one used is remembered), or hit the folder-plus icon to create one
5. Click **Import N plates**

You can close the popup at this point. The badge counts down the remaining plates, each card shows
its own status when you reopen the popup, and a notification fires when everything is done.

Plates already in your library are reported as such and not downloaded again.

---

## Notes

### Where do "Open in Bambuddy" links go?

Bambuddy's File Manager deep-links by folder only (`/files?folder=N`); there is no per-file
parameter. The button therefore opens the folder Bambuddy saved to — the one you picked, or the
auto-created `MakerWorld` folder if you left the default.

### Why does the popup not stay open?

Browser popups close as soon as they lose focus, by design. That is why imports run in the
background worker rather than in the popup, and why the old "auto-close" option is gone.

### Security

- Host permission is requested for your Bambuddy origin only, at save time.
- The API key is kept in `chrome.storage.local`, which is plaintext on disk — use a dedicated key
  with just the two permissions above.
- Thumbnails are loaded through Bambuddy's own proxy (`/api/v1/makerworld/thumbnail`), so your IP
  is not exposed to MakerWorld's CDN directly; the direct CDN URL is only a fallback if the proxy fails.

### Bambu Cloud token expiry

Bambu Cloud tokens last ~90 days. If imports start failing with "requires a Bambu Cloud login",
re-authenticate under **Settings → Bambu Cloud** in Bambuddy.

---

## File structure

```
├── manifest.json       MV3 manifest (service_worker for Chrome, scripts for Firefox)
├── shared.js           Constants, settings, helpers used by every context
├── background.js       Background worker — API calls, resolve cache, import queue, notifications
├── content.js          Runs on makerworld.com — reports the profile selected on the page
├── popup.html/js/css   Toolbar popup — cards, folder picker, progress
├── options.html/js/css Settings page
└── icons/              16 / 32 / 48 / 64 / 128 px, rendered from icons/src/icon.svg
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Bambuddy not configured" | Open Settings and enter your URL + API key |
| Test connection: "not reachable" | Wrong IP/port, or Bambuddy isn't running. Default port is `8000` |
| Test connection: HTTP 401 | API key invalid or not saved yet |
| Test connection: HTTP 403 | Key lacks **Manage Library** or **Allow cloud access** |
| Folder dropdown only shows "Default" | Key lacks **Manage Library**, or Bambuddy is older than the folders API |
| "requires a Bambu Cloud login" | Key missing **Allow cloud access**, or the cloud token expired |
| Profile list looks stale | Lower the model cache in Settings, or use **Try again** |
| No completion notification | Enable it in Settings; check the browser's notification permission for extensions |

---

## License

[MIT](LICENSE). Originally based on wolfrage76/Bambuddy-Extension.
