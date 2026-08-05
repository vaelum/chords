# Chords

A self-hosted songbook for guitarists: store chord charts, organize them into
playlists, share them with bandmates, and import new songs from the web with the
help of an AI parser.
## What it does

- **Songbook** — every song is a chord chart (title, artist, key, capo, tempo,
  auto-scroll speed, tags) stored as plain text with inline chords.
- **Playlists** — group songs, reorder them, and invite other users
  to collaborate or share a read-only public link.
- **Sharing & inbox** — send a song or a whole playlist to another user; they
  accept it from their inbox. New accounts are created through single-use invite
  links.
- **AI import** — give it a URL, paste a chord chart, or upload an image and it
  is parsed into a clean, structured chart. A web-search step helps find a good
  source when you only have a song title. Runs on OpenRouter; bring your own key.
- **Import Extension** — some sites are uncooperative when being scraped, this extension allows you to do so from your own browser which gets around some things the server based scraper will not

> **Note:** Scraping a website may violate its terms of service. Routing imports
> through the browser extension shifts that activity onto your own browser and
> session — this is usually fine for personal use (not legal advice), make sure you're allowed to scrape a given
> site before importing from it.

## Architecture

```
chords/
├── server/
│   ├── backend/      FastAPI + SQLAlchemy (SQLite) API; also serves the frontend
│   ├── frontend/     React single-page app (precompiled JSX, vendored React)
│   ├── caddy/        Caddy reverse proxy (automatic HTTPS) for production
│   ├── docker/       Dockerfile + docker-compose for dev and prod
│   └── scripts/      build / deploy / backup helpers
├── app/              Tauri v2 wrapper — native desktop & mobile builds
├── extension/        Chrome + Firefox (MV3) "Chords Importer" extension
├── butler.py         task runner for every component — a shim over the shared
│                     butler harness
└── butler/
    ├── butler.toml       declares what chords has
    └── butler_tasks.py   the chords-specific tasks
```

### Backend (`server/backend`)

A [FastAPI](https://fastapi.tiangolo.com/) app backed by SQLAlchemy over a single
SQLite database (`$CHORDS_DATA_DIR/chords.db`). Auth is JWT (bcrypt-hashed
passwords, `python-jose` tokens, 30-day expiry). The API lives under `/api`, and
the compiled frontend is served as static files from the same process.

Routers: `users`/`auth`, `songs`, `playlists`, `inbox` (sharing), `import`
(AI parsing), `invites`, `transfer`, `events`, `public` (read-only shared
playlists).

**Import pipeline** (`agent.py`, `web_fetch.py`, `llm.py`) runs on
[OpenRouter](https://openrouter.ai): Playwright renders the target page
server-side, then a model parses the rendered text (or a pasted chart / uploaded
image) into the chords format. A web-search step finds candidate sources from a
free-text query. Results stream to the client as NDJSON `progress` / `result` /
`error` events.

Each step picks the cheapest model that does *that* job well — set per role in
`llm.py`, overridable with env vars, and logged with its real cost per call:

| role | job | default model | ≈ per call |
| --- | --- | --- | --- |
| `search` | find candidate chord/tab URLs | `google/gemini-2.5-flash-lite` | $0.006 |
| `scan` | map a playlist page to song links | `google/gemini-2.5-flash-lite` | $0.002 |
| `parse` | page/pasted text → chords format | `google/gemini-3.1-flash-lite` | $0.006 |
| `vision` | photo of a chord sheet → chords format | `google/gemini-3.1-flash-lite` | $0.003 |

Override with `CHORDS_MODEL_SEARCH` / `_SCAN` / `_PARSE` / `_VISION` (any
OpenRouter slug), `CHORDS_MODEL_<ROLE>_REASONING` (`off`/`low`/`medium`/`high`),
and `CHORDS_SEARCH_ENGINE` / `CHORDS_SEARCH_RESULTS`.

Requests use strict structured outputs, with tolerant JSON extraction as a
fallback. Web search goes through OpenRouter's `web` plugin pinned to Exa — not
the `openrouter:web_search` server tool, which is beta and 404s when a strict
schema is attached (see the comment in `llm.py`).

### Frontend (`server/frontend`)

A React SPA written in `.jsx` and **precompiled** to `.js` (see
`scripts/build-frontend.js`) — no in-browser Babel in production. Uses the
"Chords" design system (Geist font, dark zinc theme, orange accent).

### Native app (`app/`)

A [Tauri v2](https://tauri.app) shell that bundles the same web frontend and
talks to a chords backend over the network. No server URL is baked in — you enter
it on first launch. Builds for Linux, Windows, and Android. See
[`app/README.md`](app/README.md).

### Browser extension (`extension/`)

A Manifest V3 extension (Chrome and Firefox) that scrapes the page you're viewing
in your own browser and imports it into Chords — the client-side alternative to
the server-side Playwright path for sites that block servers. See
[`extension/README.md`](extension/README.md).

#### Install the extension

Every [GitHub release](https://github.com/vaelum/chords/releases/latest) ships two
zips next to the desktop/Android builds — grab the one for your browser:

- `chords-extension-chrome-<version>.zip`
- `chords-extension-firefox-<version>.zip`

**Chrome / Edge / Brave (any Chromium browser)**

1. Download `chords-extension-chrome-<version>.zip` and unzip it to a folder you'll
   keep (the browser loads it from that location every launch — don't delete it).
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.

The "Chords Importer" icon appears in the toolbar; right-click it → **Options** to
set your site URL and auth token.

**Firefox**

The release zip is unsigned, so it loads as a *temporary* add-on (removed when
Firefox restarts — re-load it after a restart, or self-sign via Mozilla's
[AMO](https://addons.mozilla.org/developers/) for a permanent install):

1. Download `chords-extension-firefox-<version>.zip` (no need to unzip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the downloaded **zip**.
4. Open the add-on's options (`about:addons` → Chords Importer → Preferences) to
   set your site URL and auth token. Firefox treats `<all_urls>` access as opt-in,
   so also grant **Access your data for all websites** under its **Permissions**
   tab if scraping is blocked.

Prefer to build from source instead of downloading? See
[`extension/README.md`](extension/README.md) for loading the `extension/` folder
directly, and run `python butler.py extension package` to produce the same zips
locally in `dist/`.

## Getting started

Everything is driven through `butler.py`. It is a small bootstrap shim: on first
use it prepares a cached virtualenv holding the shared
[butler harness](https://github.com/vaelum/butler) (pinned by `HARNESS_REF` in
that file) and then hands off to it. Nothing to install by hand; the first run
just needs network access. What chords itself declares lives in
`butler/butler.toml`; what only chords does (the OpenRouter key workflow, the
import-pipeline tests) lives in `butler/butler_tasks.py`.

Run `python butler.py doctor` on a new machine to see what tooling is present.

### Run the backend locally (no Docker)

```bash
pip install -r server/backend/requirements.txt
python butler.py server run          # uvicorn --reload, http://localhost:8000
```

The first run creates the SQLite database and an admin account.

### Run with Docker

```bash
python butler.py server dev          # dev stack on :8000 (no TLS)
python butler.py server build        # production stack: Caddy + automatic HTTPS
```

Docker Compose mounts `~/.chords` for persistent data.

### OpenRouter API key (AI import)

The import features call [OpenRouter](https://openrouter.ai), so they need a key.
It is stored in the data directory's `secrets.json` — alongside the JWT secret
and admin passcode — which means it survives redeploys and image rebuilds, and
is re-read on every request (rotating it needs no restart).

```bash
python butler.py server key                       # prompt, write to the remote
python butler.py server key --local               # write to this machine
python butler.py server key --openrouter-key sk-or-…
python butler.py server key --clear               # remove it

# or set it as part of a deploy:
python butler.py server deploy --openrouter-key -   # prompt, then deploy
OPENROUTER_API_KEY=sk-or-… python butler.py server deploy
```

Deploying to a remote with no key set warns and offers to set one. The
`OPENROUTER_API_KEY` environment variable, if set on the server, takes precedence
over the stored key.

### Tests

```bash
python butler.py server test             # offline: stub OpenRouter, free
python butler.py server test --live      # + real API calls (~$0.01 a run)
python butler.py server test --live-only --only search,vision
```

The offline suite (`server/tests/test_pipeline.py`) drives the real pipeline
against a stub server that speaks OpenRouter's SSE dialect — request shaping,
streaming, schema fallback, retries, error paths. The live suite
(`server/tests/test_live.py`) exercises all four roles against the real API,
including reading chords off an image fixture; it takes the key from `.secrets`
(gitignored), `$OPENROUTER_API_KEY`, or `~/.chords/secrets.json`, and skips when
there is none.

### Frontend changes

```bash
node server/scripts/build-frontend.js   # recompile .jsx → .js after editing
```

### Native app & extension

```bash
python butler.py app dev             # Tauri desktop app, hot reload
python butler.py app build           # desktop bundles for this OS
python butler.py app android build   # Android APK (needs the SDK/NDK toolchain)
python butler.py extension package   # zip Chrome + Firefox bundles into dist/
```

See `python butler.py --help` for the full list of components and actions.

## Deployment

`python butler.py server deploy` rsyncs `server/` to the configured remote and
restarts the production Docker stack. Caddy terminates TLS and reverse-proxies
the backend; data lives in `~/.chords` on the host (`butler.py server backup`
snapshots it).

## License

[MIT](LICENSE)
