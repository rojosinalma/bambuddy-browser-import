# FAQ

## Where do "Open in Bambuddy" links go?

Bambuddy's File Manager deep-links by folder only (`/files?folder=N`); there is no per-file
parameter. The button therefore opens the folder Bambuddy saved to — the one you picked, or the
auto-created `MakerWorld` folder if you left the default.

## Why does the popup not stay open?

Browser popups close as soon as they lose focus, by design. That is why imports run in the
background worker rather than in the popup: closing it changes nothing about the running job, and
reopening it shows the current state of every plate.

## Imports fail with "requires a Bambu Cloud login"

Bambu Cloud tokens last about 90 days. Re-authenticate under **Settings → Bambu Cloud** in Bambuddy,
then run the import again. If the token is fresh, check that the API key has **Allow cloud access**.

## Can I import to a folder that does not exist yet?

Yes — the folder-plus icon in the picker creates a folder (optionally under the one currently
selected) through Bambuddy's folders API and selects it.

## Does the extension send anything to MakerWorld?

No. It reads the page you are on to find the selected profile; all downloads are performed by your
Bambuddy server with your Bambu Cloud token. See [security.md](security.md) and
[PRIVACY.md](../PRIVACY.md).

## Something else is wrong

See [troubleshooting.md](troubleshooting.md), or open an issue at
https://github.com/rojosinalma/bambuddy-browser-import/issues.
