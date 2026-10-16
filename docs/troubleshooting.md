# Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Bambuddy not configured" | Open Settings and enter your URL + API key |
| Test connection: "not reachable" | Wrong IP/port, or Bambuddy isn't running. Default port is `8000` |
| "Cannot reach Bambuddy at …" after changing the URL | The host permission for the new origin was not granted; re-save Settings and accept the prompt |
| Test connection: HTTP 401 | API key invalid or not saved yet |
| Test connection: HTTP 403 | Key lacks **Manage Library** or **Allow cloud access** |
| Folder dropdown only shows "Default" | Key lacks **Manage Library**, or Bambuddy is older than the folders API |
| "requires a Bambu Cloud login" | Key missing **Allow cloud access**, or the cloud token expired — re-link under **Settings → Bambu Cloud** |
| Profile list looks stale | Lower the model cache in Settings, or use **Try again** |
| No completion notification | Enable it in Settings; check the browser's notification permission for extensions |
| No bubbles or button on MakerWorld pages | Enable *Show import buttons on MakerWorld pages* in Settings; MakerWorld may also have changed its markup — open an issue with the page URL |
| Firefox refuses to load the add-on | Firefox ≥ 140 is required (`strict_min_version`) |

Still stuck? Open an issue at https://github.com/rojosinalma/bambuddy-browser-import/issues with the
browser, its version and the text of the error.
