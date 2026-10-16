# Security

The full data-handling statement is the [Privacy Policy](../PRIVACY.md); this page covers what the
extension does to keep your Bambuddy credentials and your browsing to yourself.

## Permissions

- `storage`, `activeTab`, `notifications` and the `https://makerworld.com/*` host permission are
  the only permissions requested at install time. There is no `tabs` permission: `activeTab` gives
  the popup the URL of the tab you clicked on, and the MakerWorld host permission is what lets the
  background worker see URL changes on that host and nothing else.
- Host permission for your Bambuddy origin is requested **at save time**, for exactly the origin you
  entered (`optional_host_permissions`). The extension never holds a blanket host permission.

## Credentials

- The API key is kept in `chrome.storage.local`, which is plaintext on disk. Use a dedicated key
  with just **Manage Library** and **Allow cloud access**, and revoke it in Bambuddy if you stop
  using the extension.
- The key is sent only to the Bambuddy URL you configured, as an `X-API-Key` header, and only from
  the background worker.

## Network

- All Bambuddy calls go through the background worker; content scripts and the popup never talk to
  your server directly.
- Thumbnails are loaded through Bambuddy's own proxy (`/api/v1/makerworld/thumbnail`), so your IP is
  not exposed to MakerWorld's CDN directly; the direct CDN URL is only a fallback if the proxy fails.
- Nothing is sent to MakerWorld by the extension itself; downloads happen on your Bambuddy server.

## Content

- No dynamic text is inserted through `innerHTML`; everything that comes from MakerWorld or Bambuddy
  goes through `textContent` or attribute setters.
- The in-page picker is the extension's own `popup.html` in an iframe (a web-accessible resource
  limited to `https://makerworld.com/*`), so the page cannot read or script it.
- There is no remote code, analytics, telemetry or crash reporting.
