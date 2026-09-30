---
title: Bambuddy Browser Import
class: home
---

<div class="hero">
  <div class="hero-copy">
    <img class="logo" src="{{ '/icons/icon128.png' | relative_url }}" alt="">
    <h1>MakerWorld → <span>Bambuddy</span>, one click.</h1>
    <p class="lead">Pick the plates, pick the folder, hit import. Print profiles land straight in your self-hosted Bambuddy library — from Chrome or Firefox.</p>
    <div class="buttons" id="install">
      <a class="btn primary" href="{{ site.chrome_store }}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg>
        Chrome Web Store
      </a>
      <a class="btn" href="{{ site.firefox_store }}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10c0-2.5-.8-4.4-2-6 .3 1.6.1 3-.6 3.6-.2-2.6-1.6-4.5-3.4-5.6.6 1.3.5 2.6-.2 3.4C14.6 5.3 12.5 4 10 4c1.2 1 1.8 2.3 1.6 3.6C10 7.2 8 8 7 10c-.4-.7-.4-1.6 0-2.4C4.7 9 3.6 11.3 4 13.6"/></svg>
        Firefox Add-ons
      </a>
      <a class="btn" href="{{ site.repo }}/releases/latest">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download <small>(.zip / .xpi)</small>
      </a>
    </div>
  </div>
  <div class="hero-shot">
    <img src="{{ '/docs/screenshot.jpg' | relative_url }}" alt="The popup open on a MakerWorld model page: profile cards, folder picker and the import button">
  </div>
</div>

<section>
  <h2>What it does</h2>
  <p class="sub">Everything Bambuddy's own MakerWorld import does, without leaving the model page.</p>
  <div class="features">
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
      <h3>Pick any plates</h3>
      <p>One profile, a handful, or all of them. Each card shows print time, colours, AMS and rating so you know what you're grabbing.</p>
    </div>
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <h3>Choose the folder</h3>
      <p>Your whole library tree in a dropdown, last choice remembered. Create a new folder right from the popup.</p>
    </div>
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></div>
      <h3>Runs in the background</h3>
      <p>Close the popup, keep browsing. Imports continue in the extension's worker; the badge counts down and a notification tells you when it's done.</p>
    </div>
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
      <h3>Opens instantly</h3>
      <p>Models are resolved the moment the page loads and cached, and thumbnails come down at 200&nbsp;px instead of full size.</p>
    </div>
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
      <h3>Your server only</h3>
      <p>No backend, no telemetry. The extension talks to the Bambuddy URL you configure and to the MakerWorld page you're on — nothing else.</p>
    </div>
    <div class="feature">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
      <h3>Open source</h3>
      <p>Plain MV3 JavaScript, no build step, MIT licensed. One codebase for Chrome and Firefox.</p>
    </div>
  </div>
</section>

<section id="setup">
  <h2>Setup</h2>
  <p class="sub">Two minutes, once.</p>
  <div class="steps">
    <div class="step">
      <div>
        <h3>Create an API key in Bambuddy</h3>
        <p><strong>Settings → API Keys → Create API Key.</strong> Enable <em>Manage Library</em> and <em>Allow cloud access</em>, and make sure a Bambu Cloud account is linked under <strong>Settings → Bambu Cloud</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div>
        <h3>Point the extension at your server</h3>
        <p>Click the toolbar icon → gear. Enter your Bambuddy URL (e.g. <code>http://192.168.1.100:8000</code>) and paste the key. The browser asks once for permission to reach that origin — that's the only site the extension ever gets access to besides makerworld.com.</p>
      </div>
    </div>
    <div class="step">
      <div>
        <h3>Import from any model page</h3>
        <p>Open a model on makerworld.com — the icon shows a green <strong>↓</strong>. Click it, select plates, pick a folder, <strong>Import</strong>. "Open in Bambuddy" takes you to the folder afterwards.</p>
      </div>
    </div>
  </div>
  <p class="note" style="margin-top:20px">Full documentation, troubleshooting and the changelog live in the <a href="{{ site.repo }}#readme">README on GitHub</a>. Issues and ideas: <a href="{{ site.repo }}/issues">issue tracker</a>.</p>
</section>
