# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version below has a `## [x.y.z]` heading. The release workflow
extracts the section matching the pushed tag (`vx.y.z`) and uses it as the
GitHub Release body — so keep these sections accurate before tagging.

## [2026.8.2]

### Changed

- **AI import now runs on OpenRouter** instead of the Claude Agent SDK. Each
  import step picks the cheapest model that does that particular job well, set
  per *role* in `backend/llm.py` and overridable with env vars
  (`CHORDS_MODEL_SEARCH` / `_SCAN` / `_PARSE` / `_VISION`):

  | role | job | default model | ≈ per call |
  | --- | --- | --- | --- |
  | `search` | find candidate chord/tab URLs | `google/gemini-2.5-flash-lite` | $0.006 |
  | `scan` | map a playlist page to song links | `google/gemini-2.5-flash-lite` | $0.002 |
  | `parse` | page/pasted text → chords format | `google/gemini-3.1-flash-lite` | $0.006 |
  | `vision` | photo of a chord sheet → chords format | `google/gemini-3.1-flash-lite` | $0.003 |

  Web search uses OpenRouter's `web` plugin pinned to the Exa engine
  ($0.005/search; left on `auto`, Google models would use native grounding at
  ~7x that). The `openrouter:web_search` server tool is what OpenRouter's docs
  recommend, but it is beta and returns `404 Server tool request failed` whenever
  a strict `response_format` is attached — see `llm.py`. Every call logs its real
  token count and cost.
- **Structured outputs**: parses now request a strict JSON schema instead of
  asking for a fenced JSON block, with the tolerant parser kept as a fallback.
- **Slimmer image**: the container no longer installs Node.js or the Claude Code
  CLI, and no longer mounts the host's `~/.claude` login.

### Added

- **`python butler.py server key`** sets the OpenRouter API key — on the remote
  by default, `--local` for this machine, `--clear` to remove it. The key is
  stored in the data directory's `secrets.json` (so it survives redeploys) and is
  re-read per request, so no restart is needed.
- **`python butler.py server deploy --openrouter-key`** sets the key as part of a
  deploy; with no value it prompts with hidden input, and it defaults to
  `$OPENROUTER_API_KEY` when that is set. A deploy to a remote with no key
  configured now warns and offers to set one.
- **Deploying is now the butler harness's built-in** (harness v0.4.0), not
  `server/scripts/deploy.sh` — that script is gone, and what it did is declared
  in `butler/butler.toml`. Same sequence as before: compile the frontend, rsync,
  build the image while the old container keeps serving, then stop, snapshot
  `~/.chords` to `~/.chords-backup`, and start. What changed:
  - the pre-deploy check that `zip` is installed now runs *before* the service
    goes down, rather than the backup failing after it;
  - `~/.chords` is created before the stack starts, so a first deploy can't end
    up with a root-owned bind mount the service can't write to;
  - the admin passcode printed at the end is read using the *remote's* home
    directory. The old script interpolated the local `$HOME` into the ssh
    command, so it only worked when both usernames matched;
  - snapshots are named `chords-<stamp>.zip` (was `chords_<stamp>.zip`).
- **`python butler.py server test`** runs the import-pipeline tests in
  `server/tests/`: an offline suite driving the real code against a stub
  OpenRouter server (free), and `--live` for a suite that hits the real API
  (~$0.01 a run) covering all four roles end to end, including chord-sheet OCR
  from an image fixture. The live suite reads the key from `.secrets`,
  `$OPENROUTER_API_KEY` or `~/.chords/secrets.json`, and skips without one.

## [2026.6.4]

The browser extension now works in Firefox too, and the app points you to it.

### Added

- **Firefox extension bundle**: every release now ships a Firefox build of the
  "Chords Importer" extension (`chords-extension-firefox-<version>.zip`) alongside
  the Chrome one (`chords-extension-chrome-<version>.zip`). The two are built from
  the same source — only the manifest differs (Firefox uses an event-page
  background and carries a gecko add-on id).
- **Import screen pointer**: the Import screen now mentions the browser extension
  for sites that block the server-side importer, with a one-click link to the
  GitHub release downloads.

### Changed

- **Extension zip names**: the packaged extension is now
  `chords-extension-chrome-<version>.zip` (was `chords-extension-<version>.zip`),
  to sit clearly beside the new Firefox bundle.

### Docs

- **Manual install instructions** for both Chrome (Load unpacked) and Firefox
  (Load Temporary Add-on) are documented in the README and `extension/README.md`.

## [2026.6.3]

Use your songbook offline — the app no longer needs a connection to open.

### Added

- **Offline mode**: the app now keeps a local snapshot of your last loaded
  session, so launching (or losing connection) while offline shows your songs and
  playlists instead of the login screen. It quietly retries the connection every
  minute and refreshes once you're back online; an "Offline" badge appears in the
  top bar (hidden while a song is maximised and autoscrolling). You're only asked
  to sign in again if you manually log out (or the saved session is rejected).

## [2026.6.2]

The browser extension is now a downloadable release asset.

### Added

- **Browser extension download**: every release now ships
  `chords-extension-<version>.zip` next to the desktop and Android builds, so you
  can install the "Chords Importer" extension without checking out the source —
  unzip it and load the folder unpacked in your browser
  (`chrome://extensions` → Developer mode → Load unpacked).

## [2026.6.1]

Mobile (Android) polish: the app now fits the screen and carries its own identity,
plus a clearer first-run sign-in and a reading-comfort setting.

### Added

- **Song view "Side margins"**: a setting to add empty left/right space beside the
  text, for comfortable reading and to clear curved/edge displays.

### Fixed

- **Android launcher icon**: the app now ships the chords logo instead of the
  default Tauri placeholder.
- **Android safe areas**: the song view and the rest of the app no longer hide
  behind the status bar (top) or the gesture/navigation bar (bottom) — insets are
  applied automatically, so the manual edge-spacing workaround is no longer needed.
- **Mobile bottom navigation**: no longer squished, with its icons clipped, on
  edge-to-edge screens.
- **Sign-in errors**: a server address without `http(s)://` now defaults to https,
  and a non-JSON/HTML response reports a helpful message instead of the cryptic
  "Unexpected token '<'".

### Changed

- **Signed release APK** is now named `chords-<tag-or-date>.apk` (the git tag on a
  tagged build, otherwise a UTC datetime), instead of the generic Tauri filename.

## [2026.6.1-beta-1]

First public beta of chords — guitar tabs that follow you.

### Added

- **Server**: self-hosted backend (FastAPI) with songs, playlists, inbox, invites,
  sharing, and import; runs via Docker with Caddy/TLS.
- **Web frontend**: browse and view songs/playlists with live playback bar.
- **Browser extension**: capture tabs/chords into your chords server.
- **Native apps** (Tauri v2): Linux AppImage, Windows installer (.exe), and Android APK.
  The app bundles the web frontend and connects to a server URL you set on first launch.
- **CI**: matrix build for all three native targets with tag-triggered GitHub Releases.

> ⚠️ Beta — Windows and Android builds are wired up but not yet battle-tested. Expect rough edges.
