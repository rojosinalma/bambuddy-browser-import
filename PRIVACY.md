# Privacy Policy — Bambuddy Browser Import

_Last updated: 2026-09-30_

Bambuddy Browser Import is a browser extension that sends MakerWorld print profiles to a
**Bambuddy server that you run yourself**. It has no backend of its own and collects no data.

## What the extension stores

- The URL of your Bambuddy instance and an API key for it, both entered by you in the extension's
  settings. They are kept in the browser's local extension storage on your device only.
- Behaviour preferences (parallel imports, notifications, cache duration, last used folder).
- A short-lived cache of MakerWorld model metadata and import progress, kept in session storage and
  cleared when the browser closes.

## Where data is sent

- **Your Bambuddy server** (the URL you configured): the MakerWorld model URL you are viewing, the
  profiles you chose to import, the target folder, and your API key in a request header. Thumbnails
  are loaded through your server's proxy endpoint.
- **makerworld.com**: the extension reads the currently selected profile from the page you are
  viewing. It sends nothing to MakerWorld itself; downloads are performed by your Bambuddy server.

Nothing is sent to the extension's author or to any third party. There is no analytics, telemetry,
crash reporting or remote code.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your settings locally |
| `activeTab` | Read the MakerWorld URL of the tab you clicked the extension on |
| `notifications` | Tell you when a background import has finished |
| `https://makerworld.com/*` | Detect model pages and read the selected profile |
| Optional host permission (requested at save time) | Reach the one Bambuddy origin you configured |

## Contact

Open an issue at https://github.com/rojosinalma/bambuddy-browser-import/issues.
