# Chords Importer — Chrome & Firefox extension

Scrapes the page you're looking at **in your own browser** and sends its rendered
text to the Chords backend. Because the fetch/render happens in your real browser
(your IP, your session, your cookies), bot checks / captcha challenges are
usually already cleared — and if one appears, you just solve it in the tab
before importing.

This is the client-side alternative to the server-side Playwright path in
`backend/web_fetch.py` for sites that block the server.

> **Note:** Scraping a website may violate its terms of service. Routing imports
> through the browser extension shifts that activity onto your own browser and
> session — this is usually fine for personal use (not legal advice), make sure you're allowed to scrape a given
> site before importing from it.

## How it works

It mirrors what the web app does, in two steps (see `frontend/api.js` + backend):

1. `POST /api/import/extract-text` with `{text, url}` → NDJSON stream of
   `progress` / `result` / `error` events. This **parses** the chords with Claude
   but does **not** save them; the parsed song comes back in the `result` event.
2. `POST /api/songs` with the parsed song to **persist** it.

## Install

This one source tree ships as two bundles — Chrome uses a service-worker
background, Firefox an event-page one (`python butler.py extension package`
writes `dist/chords-extension-chrome-<label>.zip` and
`dist/chords-extension-firefox-<label>.zip`; the only difference is the generated
`manifest.json`). Prebuilt zips are attached to every
[GitHub release](https://github.com/vaelum/chords/releases/latest).

### Chrome / Edge / Brave (any Chromium browser)

From source:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this `extension/` folder

From a release: unzip `chords-extension-chrome-<label>.zip` to a folder you'll
keep, then **Load unpacked** that folder (same steps).

### Firefox

The bundle is unsigned, so it loads as a **temporary** add-on (gone on restart;
re-load it, or self-sign on Mozilla [AMO](https://addons.mozilla.org/developers/)
for a permanent install):

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select the `chords-extension-firefox-<label>.zip`
   (or, when working from source, the `manifest.json` produced by
   `butler.py extension package` — Firefox's plain manifest differs from Chrome's,
   so don't point it at this folder's `manifest.json` directly)
3. Firefox treats `<all_urls>` as opt-in — if scraping is blocked, grant **Access
   your data for all websites** under the add-on's **Permissions** tab in
   `about:addons`.

## UI

The extension uses the **Chords design system** (Geist font, shadcn-zinc dark
theme, brand orange accent) so it matches the app — tokens/components are in
`theme.css`, mirrored from `frontend/colors_and_type.css` + `frontend/app.css`.

Clicking the toolbar icon opens the importer in its **own standalone window**
(not the cramped browser popup), so it stays open while you switch tabs to solve
a captcha or watch a playlist import. The window operates on the tab that was
active when you opened it (passed through as `?tabId=`).

It mirrors the app's **Import section** one-to-one:

- **Web** tab — one smart field:
  - a **URL** → the page is scraped *in your browser*, then auto-detected as a
    single song (preview → Save) or a playlist/collection (target + song picker).
  - **free text** → web search → candidate versions → pick one → scraped → preview.
  - **Use current page** → runs the same auto-detect on the tab you're on.
- **Text or image** tab — paste a chord chart or upload an image → preview → Save.
- **Playlists** offer the same **Library only / Playlist only / Both** targets as
  the app; selected songs are imported by the background worker (one tab each,
  captcha-aware, survives closing the window). If a playlist with the entered
  name already exists, you're asked whether to **add to the existing playlist**
  or **create a new one**.

These rely on two endpoints added to the backend alongside `scan-text`:
`POST /api/import/auto-text` and `POST /api/import/extract-text` /
`extract-image` / `search` (the latter three already existed).

## Configure

Click the extension → **Settings** (or right-click → Options):

- **Site URL** — where the Chords app is served (it proxies `/api`), e.g.
  `https://chords.example` or `http://localhost:8000`.
- **Auth token** — your JWT. Easiest: open and log into the app in a tab, switch
  to that tab, then click **Grab token from active app tab** (it reads
  `localStorage["chords_token"]` and auto-fills the Site URL from that tab).

## Use — single song

1. Open the chord page in a normal tab and let it fully load (clear any
   "are you human" check).
2. Click the extension → **Scrape & import this page**.
3. Progress streams in the popup; the imported song is listed when done.

> For single-song import the popup must stay open (the requests run from it).

## Use — whole playlist

1. Open the **playlist / collection page** in a tab and let it load (clear any
   captcha).
2. Click the extension → **Scan & import this playlist**. It scrapes the page's
   text + links and asks `POST /api/import/scan-text` (the new endpoint) to
   identify the songs.
3. Confirm the playlist name → **Import N songs**.
4. A **background worker** takes over: it creates the playlist, then opens each
   song URL in a background tab, lets it render, scrapes it, parses via
   `extract-text`, and adds it to the playlist. Progress (with a per-song log and
   a Cancel button) shows in the popup — but the job **keeps running even if you
   close the popup**.
   - If a song page shows a captcha, the worker brings that tab to the front so
     you can solve it; once cleared it continues automatically. Songs that can't
     be cleared within ~2.5 min are skipped and listed as failed.

> Service-worker caveat: Chrome may suspend the background worker if it sits idle
> too long (e.g. a captcha left unsolved for minutes). If a big import stalls,
> reopen the popup — and you can always re-run; already-imported songs will just
> be duplicated, so prefer importing into a fresh playlist.

### Backend requirement

The playlist feature needs the `POST /api/import/scan-text` endpoint added in
`backend/routers/import_routes.py` + `stream_scan_text` in `backend/agent.py`.
Restart the backend after pulling those changes.

## Permissions

`host_permissions` is `<all_urls>` so the popup can read arbitrary chord sites and
POST to your backend wherever it's hosted. To tighten it, replace `<all_urls>` in
`manifest.json` with your specific chord-site origins plus your site origin.

## Notes / caveats

- The chords icons under `assets/` are bundled and referenced from
  `manifest.json`, so the toolbar shows the brand icon (not a puzzle piece).
