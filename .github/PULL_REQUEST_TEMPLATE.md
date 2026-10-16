<!-- Plain imperative title, e.g. "Model page: solid button in the native accent colour".
     Do not bump manifest.json's version in a feature PR — the bump is the release and happens on main. -->

## What

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

## How I tested it

<!-- Which browser(s); resolve a model, import a plate, reopen the popup during an import; page.js changes: bubbles on search results and the model-page button. -->

## Checklist

- [ ] `for f in *.js; do node --check "$f"; done` and `npx --yes web-ext lint --source-dir .` pass
- [ ] Tunables live in `shared.js` and are exposed on the options page
- [ ] `docs/` updated when a setting, flow or permission changed (see CONTRIBUTING.md → Documentation)
- [ ] CHANGELOG.md has an entry under *Unreleased*
- [ ] Commits are GPG-signed
