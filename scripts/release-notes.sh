#!/usr/bin/env bash
# Print the GitHub release notes for one version: its CHANGELOG.md section (summary and changes),
# the install hints for the attached files, and the compare link.
#
#     scripts/release-notes.sh 0.9.8 > notes.md
set -euo pipefail

version=${1:?usage: release-notes.sh <version>}
changelog=${CHANGELOG:-CHANGELOG.md}
repo=https://github.com/rojosinalma/bambuddy-browser-import

# Lines after "## [<version>]" up to the next "## [" heading or the link references.
section=$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && (/^## \[/ || /^\[[^]]+\]: /) { exit }
  on { print }
' "$changelog" | sed -e '/./,$!d')    # drop leading blank lines

[ -n "$section" ] || { echo "release-notes.sh: no section for $version in $changelog" >&2; exit 1; }

compare=$(sed -n "s/^\[$version\]: //p" "$changelog")

printf '%s\n\n' "$section"
cat <<EOF
### Install

- **Chrome Web Store / Firefox Add-ons:** the recommended way; signed and updated automatically —
  [Chrome Web Store](https://chromewebstore.google.com/detail/kcffnknnapkmkabmkbghccgjfcgiobgb),
  [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/bambuddy-browser-import/).
- **\`-chrome.zip\`** (Chrome, Chromium, Edge, Brave): unzip, \`chrome://extensions\` → Developer mode → Load unpacked.
- **\`-chrome.crx\`**: the package uploaded to the Chrome Web Store, signed with the project's Verified CRX Uploads key.
  You can also install it directly: drag it onto \`chrome://extensions\` with Developer mode on (Windows first needs the
  registry entry from the [README]($repo#chrome--chromium--edge--brave-from-the-crx-linux-and-windows)).
  Grab the \`.crx.zip\` if your browser blocks the bare file.
- **\`-firefox.xpi\`**: the unsigned source package; temporary install via \`about:debugging\` only.

EOF
[ -z "$compare" ] || printf '**Full changelog:** %s\n' "$compare"
