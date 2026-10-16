# Features

- **Multi-select** — import one plate, a few, or all of them in one go. Each card shows print
  time, colours, AMS use and rating.
- **Folder picker** — choose the target library folder, or create one from the picker, instead of
  always landing in `MakerWorld/`. The last folder used is remembered.
- **Background imports** — the job runs in the extension's background worker, so closing the popup
  does not cancel it. Reopen the popup to see live per-plate progress, watch the badge count down,
  or wait for the desktop notification.
- **Instant popup** — models are resolved the moment the page loads and cached for a configurable
  time; thumbnails are fetched at 200 px instead of full size (~8 KB instead of ~1.3 MB each).
- **Open in Bambuddy** — one click lands in the folder the plates were saved to.
- **Import from the page itself** — a small import bubble on every model thumbnail (search
  results, home, remixes) and an **Import to Bambuddy** button under *Open in Bambu Studio* on
  model pages. Both open the same picker in an in-page panel; no toolbar click needed.
- **Already-imported detection** — plates that are already in your library are reported as such
  and not downloaded again.
- **One codebase, two browsers** — plain MV3 JavaScript with no build step, running as a service
  worker in Chrome and as an event page in Firefox.
- **Your server only** — the extension talks to the Bambuddy URL you configure and reads the
  MakerWorld page you are on. No backend, no telemetry (see [security.md](security.md) and
  [PRIVACY.md](../PRIVACY.md)).
