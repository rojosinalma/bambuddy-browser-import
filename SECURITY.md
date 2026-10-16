# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/rojosinalma/bambuddy-browser-import/security/advisories/new)
(the **Security** tab → *Report a vulnerability*). Do not open a public issue. You will get an
acknowledgement within a week and a fix or a statement before any public disclosure.

## Supported versions

Only the latest release receives fixes. The stores update the extension automatically; if you
loaded it unpacked, update to the newest
[release](https://github.com/rojosinalma/bambuddy-browser-import/releases/latest) before reporting.

## What the extension holds

The extension stores your Bambuddy URL and a Bambuddy API key in `chrome.storage.local` and sends
the key only to that URL, from the background worker, as an `X-API-Key` header. Use a dedicated key
with just **Manage Library** and **Allow cloud access**, and revoke it in Bambuddy if you stop using
the extension. Permissions, network behaviour and content handling are described in
[docs/security.md](docs/security.md); the data-handling statement is the
[Privacy Policy](PRIVACY.md).
