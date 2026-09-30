# Bambuddy MakerWorld Import — Chrome Extension

Send any MakerWorld print profile to your Bambuddy instance in one click, exactly as if you used the built-in **Import from MakerWorld** feature inside Bambuddy.

<img width="1479" height="886" alt="image" src="https://github.com/user-attachments/assets/8d3f1f4f-710a-48f1-bf9a-c9623d33384a" />

---

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. The Bambuddy icon will appear in your toolbar (pin it via the puzzle-piece menu for easy access)

---

## First-time setup

Click the extension icon and then the gear (⚙) button, or right-click the icon → **Options**.

### 1. Bambuddy URL

Enter the base URL of your Bambuddy instance:

| Setup | Example URL |
|---|---|
| Local network | `http://192.168.1.100:8000` |
| Docker on same machine | `http://localhost:8000` |
| Reverse-proxied with HTTPS | `https://bambuddy.example.com` |

### 2. API Key

Create a dedicated key in Bambuddy:

1. **Settings → API Keys → Create API Key**
2. Give it a descriptive name (e.g. *Chrome Extension*)
3. Enable **Manage Library** — covers saving files and importing from MakerWorld
4. Enable **Allow cloud access** — required for Bambuddy to use your Bambu Cloud token when downloading from MakerWorld
5. Make sure a Bambu Cloud account is linked under **Settings → Bambu Cloud**
6. Copy the key (it's shown only once) and paste it into the extension

Click **Test Connection** to verify everything works before saving. The test runs three checks in order:
- `GET /health` — unauthenticated, confirms the URL is reachable
- `GET /api/v1/system/info` — confirms the API key is valid, shows Bambuddy version
- `GET /api/v1/makerworld/status` — best-effort, reports whether the Bambu Cloud token is present

---

## Usage

1. Browse [makerworld.com](https://makerworld.com) and open any model page
2. Optionally, click the specific print profile you want so the URL includes `#profileId-XXXXX` — the extension will pre-select it
3. Click the Bambuddy icon in the toolbar
4. The popup resolves the model and shows all available print profiles
5. Select the profile you want (it is pre-selected from the URL if you clicked one)
6. Click **Send to Bambuddy** — the 3MF is downloaded into your Bambuddy library just like a manual import

Profiles already in your library appear with a ✓ and an "Already in library" badge.

---

## Suggestions & notes

### Security
The extension uses `<all_urls>` host permissions so it can reach your Bambuddy instance at any IP/hostname. For a personal self-hosted tool this is fine. If you want to tighten this, edit `manifest.json` and add your specific Bambuddy URL as a host permission, then handle the `chrome.permissions.request` flow in `options.js`.

### API key permissions
The key needs **Manage Library** and **Allow cloud access** — both are required. If imports return *"Downloading files from MakerWorld requires a Bambu Cloud login"* even with valid credentials, make sure **Allow cloud access** is checked on the key.

### Bambu Cloud token expiry
Bambu Cloud tokens are valid for ~90 days. If imports start failing after a long period, re-authenticate under **Settings → Bambu Cloud** in Bambuddy to refresh the token.

### Multi-plate models
The popup shows all plates/profiles for a model in the dropdown. Use Bambuddy's built-in **Import all plates** feature for bulk import; this extension is designed for single-profile one-click imports.

### Content Security Policy
The popup loads the model thumbnail through Bambuddy's own proxy endpoint (`/api/v1/makerworld/thumbnail`) — your IP is never exposed to MakerWorld's CDN directly (mirrors Bambuddy's own behavior).

---

## File structure

```
├── manifest.json       MV3 manifest
├── background.js       Service worker — handles all Bambuddy API calls
├── popup.html/js/css   Toolbar popup — resolve + import UI
├── options.html/js/css Settings page — URL, API key, test connection
└── icons/              Extension icons (16, 48, 128 px)
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Bambuddy not configured" | Open Settings and enter your URL + API key |
| Test connection: "not reachable" | Wrong IP/port, or Bambuddy isn't running. Default port is `8000`. |
| Test connection: HTTP 401 | API key is invalid or wasn't saved yet |
| Test connection: HTTP 403 | API key doesn't have the required permissions — check **Manage Library** and **Allow cloud access** |
| "Could not resolve model" | Network issue, or the MakerWorld feature isn't enabled on your build |
| "requires a Bambu Cloud login" | API key missing **Allow cloud access**, or Bambu Cloud token expired |
| Thumbnail doesn't load | Bambuddy's thumbnail proxy may not be available on older builds; the extension falls back to the direct CDN URL |
| Profile list is empty | The model page returned no profiles from the resolve endpoint; try re-opening the popup |
