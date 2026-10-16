# Contributing

Thanks for helping out. Bug reports and ideas go to the
[issue tracker](https://github.com/rojosinalma/bambuddy-browser-import/issues); fixes and features
as pull requests against `main`.

## Running it locally

There is no build step. Clone the repo and load the folder as an unpacked extension:

- **Chrome / Chromium / Edge / Brave** — `chrome://extensions/` → Developer mode → **Load unpacked**
  → select the repo folder. After editing a file, hit *Reload* on that page.
- **Firefox (≥ 140)** — `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
  select `manifest.json`. Use *Reload* there after edits.

Point it at a Bambuddy instance through the options page (icon → gear). To skip the typing on every
fresh install, put a `dev-settings.json` next to `manifest.json` (gitignored):

```json
{ "bambuddyUrl": "http://192.168.1.100:8000", "apiKey": "…" }
```

Unpacked builds read it once on install and fill in whatever is still unset.

`bin/dev-build` produces `build/bambuddy-browser-import-dev.zip` (files at the archive root, constant
name, so it extracts to the same folder every time) and, when a dev signing key exists at
`~/.config/bambuddy-browser-import/dev-signing-key.pem` (or `$BBI_DEV_KEY`),
`build/bambuddy-browser-import-dev.crx` signed with it — a stable extension id distinct from the
store's, so installing a new build over the old one keeps storage. The staged manifest gets a fourth
version component so every build is an upgrade; the repo manifest is untouched. `--seed` packs
`dev-settings.json` too. `build/BUILD.md` records version, commit, id and checksums.

Needs `node`, `jq`, `zip`, `python3` and `openssl` on the PATH.

## Tests

There is no unit-test suite; the extension is checked the way the release pipeline checks it:

```sh
for f in *.js; do node --check "$f"; done
npx --yes web-ext lint --source-dir . --warnings-as-errors=false
```

`.github/workflows/check-extension.yml` runs the same on every push and pull request. Before opening
a PR, also exercise the change by hand in at least one browser: resolve a model, import a plate,
reopen the popup during an import, and (if you touched `page.js`) check the bubbles on search
results and the button on a model page.

## Code style and layout

- Plain ES2020+ JavaScript, no modules, no bundler: every file must load as a classic script in a
  service worker, an event page, an extension page and a content script.
- Use `chrome.*` with promise returns everywhere; no callback wrappers, no `browser.*` polyfill.
- Every tunable (defaults, ranges, storage keys) lives in `shared.js` and is exposed on the options
  page. Never hardcode a limit elsewhere.
- Only `background.js` talks to Bambuddy. Pages and content scripts send messages.
- Never put dynamic text through `innerHTML`; icon markup is constant strings, everything else goes
  through `textContent`.
- Keep both `background.service_worker` and `background.scripts` in the manifest, `shared.js` first
  in `scripts`. Do not add the `tabs` permission.
- Two-space indent, single quotes, semicolons, aligned object literals where it helps reading. Match
  the surrounding file.
- Layout: `manifest.json`, `shared.js`, `background.js`, `content.js`, `page.js`, `popup.*`,
  `options.*`, `icons/` (rendered from `icons/src/icon.svg`), `scripts/build-crx.py`, `bin/dev-build`.
  The GitHub Pages site is `index.md`, `_config.yml`, `_layouts/`, `assets/`, `CNAME`, `PRIVACY.md`,
  `TERMS.md`; `_config.yml` excludes the extension files from the site.

## Commits and PRs

- Plain, descriptive commit messages in the imperative ("Model page: solid button in the native
  accent colour"). No tags, no trailers.
- One logical change per commit; a PR may hold several.
- Do not bump `manifest.json`'s version in a feature PR — the version bump is the release (see
  below) and is done on `main`.
- Describe how you tested the change in the PR, and in which browser(s).

## Documentation

- `README.md` — what it is, requirements, setup, licence. Nothing else goes there.
- `docs/features.md` — what the extension does.
- `docs/usage.md` — the import flow step by step.
- `docs/configuration.md` — every setting, its default and range.
- `docs/security.md` — permissions, credentials, network behaviour. `PRIVACY.md` and `TERMS.md` are
  the store-facing policy texts and render on the site.
- `docs/faq.md`, `docs/troubleshooting.md` — questions and symptoms.
- `docs/SDD.md` — the design: architecture, storage, flows, decisions. Update it when you change a
  flow or a decision it describes.
- `index.md` — the GitHub Pages landing page (https://bambuddy-import.rojo.dev).

## Releasing

`release.yml` runs on every push to `main`. It reads `version` from `manifest.json`; if a GitHub
release `v<version>` already exists it stops with a notice, otherwise it:

1. syntax-checks the scripts and runs `web-ext lint` on the staged package (`PACKAGE_FILES` in the
   workflow is the single list of what ships);
2. builds `bambuddy-browser-import-<version>-chrome.zip`, the `.crx` signed with the Verified CRX
   Uploads key (`CWS_SIGNING_KEY` secret; also zipped, because Chromium drops bare `.crx` downloads)
   and the unsigned `-firefox.xpi`;
3. submits the Firefox package to addons.mozilla.org (`AMO_JWT_ISSUER` / `AMO_JWT_SECRET`; listed
   channel, so AMO signs and distributes it after review);
4. creates the GitHub release `v<version>` with generated notes and all packages attached;
5. uploads the `.crx` to the Chrome Web Store item and submits it for review
   (`CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN`). This step is non-fatal: the store
   refuses an upload while the previous version is still in review.

So a release is: bump `version` in `manifest.json`, commit, push to `main`. Steps that need a secret
are skipped when it is absent, so the workflow also works on a fork without store access.

Two manual workflows cover the Chrome Web Store side: **Chrome Web Store status** (`cws-status.yml`)
shows the item's draft state, and **Chrome Web Store upload** (`cws-upload.yml`, input: a release tag)
re-uploads that release's `.crx` once an earlier review has cleared.
