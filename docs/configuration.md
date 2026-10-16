# Configuration

All settings live on the options page: click the extension icon → gear (⚙), or right-click the icon
→ **Options**. They are stored in the browser's local extension storage (`chrome.storage.local`) on
your device and apply immediately.

## Connection

| Setting | What it does |
|---|---|
| Bambuddy URL | Origin of your Bambuddy instance, e.g. `http://192.168.1.100:8000` or `https://bambuddy.example.com`. Saving requests host permission for exactly that origin. |
| API key | A Bambuddy API key with **Manage Library** and **Allow cloud access**. Sent as `X-API-Key` on every request. |

**Test Connection** runs `GET /health`, `GET /api/v1/system/info` and `GET /api/v1/makerworld/status`
and reports each result, so a wrong URL, an invalid key and a missing Bambu Cloud login are told
apart.

## Behaviour

| Setting | Default | Range | What it does |
|---|---|---|---|
| Parallel imports | 3 | 1–6 | Plates downloaded concurrently when several are selected |
| Notify when an import finishes | on | | Desktop notification with the outcome; clicking it opens the target folder in Bambuddy |
| Model cache (seconds) | 300 | 30–3600 | How long a resolved model page is kept so the popup opens instantly |
| Show "Open in Bambuddy" after import | on | | Button to jump to the target folder after an import |
| Show import buttons on MakerWorld pages | on | | The bubble on model thumbnails and the **Import to Bambuddy** button on model pages |

Defaults and ranges are defined once in `shared.js` (`DEFAULTS`, `LIMITS`); the options page clamps
values to those ranges.

## Pre-seeding settings for development

An unpacked build picks up a `dev-settings.json` next to `manifest.json` on install and fills in
any setting that is still unset (keys as in `STORAGE_KEYS`, e.g. `bambuddyUrl`, `apiKey`). The file
is gitignored and never part of a release package; `bin/dev-build --seed` copies it into the dev
zip. See [CONTRIBUTING.md](../CONTRIBUTING.md).
