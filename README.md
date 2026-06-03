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
- **AI import** — give it a URL, paste a chord chart, or upload an image and
  Claude parses it into a clean, structured chart. A web-search step helps find a
  good source when you only have a song title.
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
├── extension/        Chrome (MV3) "Chords Importer" extension
└── butler.py         project task runner for every component
```

### Backend (`server/backend`)

A [FastAPI](https://fastapi.tiangolo.com/) app backed by SQLAlchemy over a single
SQLite database (`$CHORDS_DATA_DIR/chords.db`). Auth is JWT (bcrypt-hashed
passwords, `python-jose` tokens, 30-day expiry). The API lives under `/api`, and
the compiled frontend is served as static files from the same process.

Routers: `users`/`auth`, `songs`, `playlists`, `inbox` (sharing), `import`
(AI parsing), `invites`, `transfer`, `events`, `public` (read-only shared
playlists).

**Import pipeline** (`agent.py`, `web_fetch.py`) uses the
[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python):
Playwright renders the target page server-side, then Claude parses the rendered
text (or a pasted chart / uploaded image) into the chords format. A WebSearch
step finds candidate sources from a free-text query. Results stream to the client
as NDJSON `progress` / `result` / `error` events.

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

A Manifest V3 Chrome extension that scrapes the page you're viewing in your own
browser and imports it into Chords — the client-side alternative to the
server-side Playwright path for sites that block servers. See
[`extension/README.md`](extension/README.md).

## Getting started

Everything is driven through `butler.py`.

### Run the backend locally (no Docker)

```bash
pip install -r server/backend/requirements.txt
python butler.py server run          # uvicorn --reload, http://localhost:8000
```

The first run creates the SQLite database and an admin account. The AI import
features need the host's Claude Code login to be available to the Agent SDK.

### Run with Docker

```bash
python butler.py server dev          # dev stack on :8000 (no TLS)
python butler.py server build        # production stack: Caddy + automatic HTTPS
```

Docker Compose mounts `~/.chords` for persistent data and forwards your
`~/.claude` login into the container so the import agent can authenticate.

### Frontend changes

```bash
node server/scripts/build-frontend.js   # recompile .jsx → .js after editing
```

### Native app & extension

```bash
python butler.py app dev             # Tauri desktop app, hot reload
python butler.py app build           # desktop bundles for this OS
python butler.py app android build   # Android APK (needs the SDK/NDK toolchain)
python butler.py extension package   # zip the extension into dist/
```

See `python butler.py --help` for the full list of components and actions.

## Deployment

`python butler.py server deploy` rsyncs `server/` to the configured remote and
restarts the production Docker stack. Caddy terminates TLS and reverse-proxies
the backend; data lives in `~/.chords` on the host (`butler.py server backup`
snapshots it).

## License

[MIT](LICENSE)
