# Usage

1. Open any model page on [makerworld.com](https://makerworld.com) — the toolbar icon shows a green
   **↓** once the model has been resolved.
2. Open the picker in one of three ways: click the toolbar icon, click the **Import to Bambuddy**
   button under *Open in Bambu Studio*, or click the bubble on any model thumbnail (search results,
   home, remixes). The profile you selected on the page (or MakerWorld's default) is pre-selected.
3. Click more cards to add them, or use **All** / **None**.
4. Pick the target folder — the last one used is remembered — or hit the folder-plus icon to create
   one.
5. Click **Import N plates**.

You can close the popup at this point. The badge counts down the remaining plates, each card shows
its own status when you reopen the popup, and a notification fires when everything is done. Clicking
the notification, or the **Open in Bambuddy** button, opens the folder the plates were saved to in
Bambuddy's File Manager.

Plates already in your library are reported as such and not downloaded again.

The in-page buttons can be turned off in Settings (*Show import buttons on MakerWorld pages*); the
toolbar popup keeps working either way. See [configuration.md](configuration.md).

## Collection Top-off

Open a MakerWorld **collection** page. Loaded cards are checked against Bambuddy (via `resolve`
today) and painted **In library** or **Needs import**. The floating panel summarises what’s
missing; use **Import missing**, **Choose…**, or **Missing only** (dims in-library cards the same
way Choose does). Imports use each model’s default plate and your last-used library folder (same as
the picker remembers). While a batch runs, the panel shows import progress.

Large collections can 429 MakerWorld because each check still goes through Bambuddy → cloud. Keep
*Top-off checks at a time* low; a future Bambuddy `library-status` API
([bambuddy#3493](https://github.com/maziggy/bambuddy/issues/3493) /
[bambuddy#3527](https://github.com/maziggy/bambuddy/pull/3527)) is meant to replace that path with
a DB-only membership lookup.
