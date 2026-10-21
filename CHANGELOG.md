# Changelog

All notable changes to Bambuddy Browser Import are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Every version is a GitHub release with the same notes;
the version is `version` in `manifest.json`.

## [Unreleased]

These changes are in `main` and ship with the next version bump (the stores receive a new build
only when `manifest.json` changes).

### Added

- Release tags are GPG-signed by the release workflow.

## [0.9.7] - 2026-10-21

### Changed

- Licence: AGPL-3.0 from this release on; the MIT notice for the inherited parts and for
  releases up to 0.9.6 stays at the end of `LICENSE`.
- README reorganised: requirements with minimum versions, installation, usage, development,
  licence; topic documentation under `docs/`, design in `docs/SDD.md`.
- CONTRIBUTING covers signed commits, the changelog and the documentation layout.

### Added

- `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates, Dependabot for the
  workflow actions, this changelog.
- `check-extension` workflow: syntax check and `web-ext lint` on every push and pull request.
- `cws-upload` workflow: re-upload a released tag's `.crx` to the Chrome Web Store once an earlier
  review has cleared.
- Workflow run names show the version, the actor and the commit or release.

### Fixed

- "Session storage quota bytes exceeded" no longer blocks a model from loading or importing. The
  model cache now drops expired entries as it goes, and makes room when the browser's session
  storage is full; a model that cannot be cached still loads.

## [0.9.6] - 2026-10-13

### Changed

- Model page: the **Import to Bambuddy** button is solid, in MakerWorld's accent colour.

## [0.9.5] - 2026-10-13

### Added

- Import buttons on MakerWorld pages: an import bubble on every model thumbnail (search, home,
  remixes) and an **Import to Bambuddy** button under *Open in Bambu Studio* on model pages, both
  opening the picker in an in-page panel. They can be turned off in Settings.
- Popup: an *At root* toggle when creating a folder while one is selected.
- Options: **Test Connection** requests the host permission the same way **Save** does.
- Pending upgrades are applied as soon as the browser downloads them.
- `bin/dev-build`: constant-name dev zip, dev-key-signed `.crx`, `dev-settings.json` seed for
  unpacked builds, `BUILD.md` with version, commit, id and checksums.

### Fixed

- Page buttons locate the Studio control by its label band and copy their look from the computed
  styles, so they survive MakerWorld's markup changes; bubbles anchor to the thumbnail and sit
  top-left on horizontal cards.

## [0.9.4] - 2026-10-13

Superseded by 0.9.5 the same day; its changes are listed there.

## [0.9.3] - 2026-10-05

### Changed

- Compact model card: the popup shows four profiles at once.
- Options: the subtitle no longer repeats the name.

### Added

- Release workflow uploads the signed `.crx` to the Chrome Web Store and submits it for review;
  a manual **Chrome Web Store status** workflow shows the item's draft state.

## [0.9.2] - 2026-09-30

### Changed

- Content script rewritten; the UI is named Bambuddy Browser Import throughout.
- Site: privacy and terms links in the footer.

## [0.9.1] - 2026-09-30

### Added

- Own icon and branding (layered B monogram with an import arrow); headers use the extension icon.
- Project site at https://bambuddy-import.rojo.dev with the privacy policy and terms of service.

## [0.9.0] - 2026-09-30

First release under this name, prepared for the Chrome Web Store and addons.mozilla.org.

### Added

- Multi-select of print profiles, folder picker with folder creation, background import queue with
  badge countdown and completion notification, prefetch cache for model data.
- Firefox support from the same codebase (`background.scripts` alongside the service worker).
- Release workflow: Chrome zip, signed `.crx` (also zipped), unsigned Firefox `.xpi`, AMO
  submission, GitHub release.
- MIT licence, privacy policy, terms of service.

### Changed

- Started from [wolfrage76/Bambuddy-Extension](https://github.com/wolfrage76/Bambuddy-Extension)
  and reworked into an independent project.

[Unreleased]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.7...HEAD
[0.9.7]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.3...v0.9.5
[0.9.4]: https://github.com/rojosinalma/bambuddy-browser-import/commit/ac8ac6e
[0.9.3]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/rojosinalma/bambuddy-browser-import/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/rojosinalma/bambuddy-browser-import/releases/tag/v0.9.0
