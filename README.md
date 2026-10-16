# Bambuddy Browser Import

[![Check extension](https://github.com/rojosinalma/bambuddy-browser-import/actions/workflows/check-extension.yml/badge.svg)](https://github.com/rojosinalma/bambuddy-browser-import/actions/workflows/check-extension.yml)
[![Release](https://github.com/rojosinalma/bambuddy-browser-import/actions/workflows/release.yml/badge.svg)](https://github.com/rojosinalma/bambuddy-browser-import/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/rojosinalma/bambuddy-browser-import)](https://github.com/rojosinalma/bambuddy-browser-import/releases/latest)
[![License](https://img.shields.io/github/license/rojosinalma/bambuddy-browser-import)](LICENSE)

![Popup on a MakerWorld model page: profile cards with print time, colours, AMS and rating, folder picker and the import button](docs/screenshot.jpg)

Import MakerWorld print profiles into your [Bambuddy](https://github.com/maziggy/bambuddy) library
from the browser — pick the plates, pick the folder, one click. Works in Chrome and Firefox from the
same codebase.

Features, configuration, usage, security and troubleshooting are documented in [`docs/`](docs/);
the design is in [`docs/SDD.md`](docs/SDD.md).

## Requirements

| Dependency | Minimum | Notes |
|---|---|---|
| [Bambuddy](https://github.com/maziggy/bambuddy) | 0.2.4.5 | first release with the **Manage Library** and **Allow cloud access** API-key scopes and the `/api/v1/makerworld/*` endpoints |
| Bambu Cloud account | — | linked in Bambuddy under **Settings → Bambu Cloud**; Bambuddy downloads the profiles with that token |
| Bambuddy API key | — | created in **Settings → API Keys** with **Manage Library** and **Allow cloud access** enabled |
| Chrome, Chromium, Edge, Brave | 116 | any Manifest V3 browser of that generation |
| Firefox | 140 | |

## Installation

From the stores:

- [Chrome Web Store](https://chromewebstore.google.com/detail/kcffnknnapkmkabmkbghccgjfcgiobgb)
- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/bambuddy-browser-import/)

Or load it yourself from a clone or a [release](https://github.com/rojosinalma/bambuddy-browser-import/releases/latest) `.zip`:

- **Chrome / Chromium / Edge / Brave** — open `chrome://extensions/`, enable **Developer mode**,
  click **Load unpacked** and select the folder, then pin the icon via the puzzle-piece menu.
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and
  select `manifest.json`. Temporary add-ons are removed when Firefox exits; install from Firefox
  Add-ons for a permanent, signed copy.

Then connect it to Bambuddy: click the extension icon → gear (⚙), or right-click the icon → **Options**.

1. **Bambuddy URL**

   | Setup | Example URL |
   |---|---|
   | Local network | `http://192.168.1.100:8000` |
   | Docker on same machine | `http://localhost:8000` |
   | Reverse-proxied with HTTPS | `https://bambuddy.example.com` |

   Saving asks the browser for permission to reach that one origin — the extension does not hold a
   blanket host permission.

2. **API key** — create a dedicated key in Bambuddy under **Settings → API Keys → Create API Key**
   with **Manage Library** (saving files, importing from MakerWorld, listing/creating folders) and
   **Allow cloud access** (Bambuddy uses your Bambu Cloud token to download from MakerWorld). Paste
   it, click **Test Connection**, then **Save**. The test runs three checks: `GET /health`
   (reachable), `GET /api/v1/system/info` (key valid, shows version), `GET /api/v1/makerworld/status`
   (cloud token present).

## Usage

Open any model on [makerworld.com](https://makerworld.com), click the toolbar icon (or the
**Import to Bambuddy** button on the page), tick the plates, pick the folder and click
**Import N plates**. The badge counts down while Bambuddy downloads; a notification opens the folder
when it is done. Step by step, with the in-page buttons and the status indicators:
[`docs/usage.md`](docs/usage.md).

## Development

There is no build step: clone the repo and load the folder as an unpacked extension (see
Installation). After editing a file, hit *Reload* on the extensions page. The checks the release
pipeline runs:

```sh
for f in *.js; do node --check "$f"; done
npx --yes web-ext lint --source-dir . --warnings-as-errors=false
```

`bin/dev-build` packs a dev zip and a dev-key-signed `.crx`. Everything else — code style, the
`dev-settings.json` seed, what to test by hand, how a release is cut — is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE) · Copyright (C) 2026 rojosinalma. Started from
[wolfrage76/Bambuddy-Extension](https://github.com/wolfrage76/Bambuddy-Extension); releases up to
0.9.6 were MIT-licensed and the MIT notice for the inherited parts is kept at the end of
[LICENSE](LICENSE).
[Privacy Policy](PRIVACY.md) · [Terms of Service](TERMS.md) · Site: https://bambuddy-import.rojo.dev
