# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version below has a `## [x.y.z]` heading. The release workflow
extracts the section matching the pushed tag (`vx.y.z`) and uses it as the
release body, on Forgejo and then on GitHub — so keep these sections accurate
before tagging.
## [2026.9.5]

### Changed

- **A follower now tracks the leader with the song paused, too.** Sessions only
  followed a song that was *playing*, so reading through a set at talking pace —
  stopping on a bridge, scrolling back over a verse — left everyone else's
  screen where the last play had put it. Scrolling a paused song by hand now
  moves the followers with you.

- **A follower's screen no longer takes scroll input.** It mirrors another
  device, so scrolling it yourself only ever ended with the text snapping back
  when the next update arrived. Wheel, drag and keyboard do nothing there now;
  text size and margins still do.

### Fixed

- **A following screen could run on and then jump back.** Two things were
  writing the scroll position — the follower's own clock and the corrections
  arriving from the leader — and a correction that pulled *backwards* was
  visible as a jump. The two are one loop now, corrections while playing only
  ever run forward, and the leader reports a fractional line instead of a whole
  one (a whole-line answer is half a line stale on average, which is a lag the
  follower was dutifully correcting for and did not have).

## [2026.9.4]

### Added

- **Playlist sessions: one device leads, the others follow.** Start a session
  from a playlist and every other device sees the song you are on — the moment
  you open it, not when you start playing. Open the next song and it turns the
  page on every screen; start scrolling and they scroll with you, in step,
  whatever their screen size or text setting (the pace is shared in lines per
  second, so nobody has to match anyone's pixels).

  The followers can be other people on a shared playlist, or your own other
  devices: a session works on a playlist you have shared with nobody, so the
  phone on the music stand can follow the laptop you are driving. Any device
  showing *Live* on a playlist offers **Follow**, and **Take over** moves
  control to the device you are holding.

  The follower's screen is for reading and nothing else — text size and margins,
  no transpose, no chord popups — and it keeps itself awake. Joining late,
  leaving mid-song and coming back, or losing the network for a minute all land
  you back at the right line. While you are leading, a **Broadcasting** pill
  marks it, because every song you open is on other people's screens; tapping it
  ends the session.

### Fixed

- **A song no longer drops out of play mode when it reaches its last line.**
  Autoscroll used to switch itself off the moment the scroll hit the bottom, so
  the controls and chips sprang back while you were still on the final chorus.
  It now holds at the end — controls stay hidden, the screen stays awake — until
  you stop it yourself, and scrolling back up picks the scroll up again.

## [2026.9.3]

### Added

- **Tap a chord to see how to play it.** Every chord badge — over the lyrics, in
  a progression line, in the "Used" bar — is a button now, and tapping one opens
  a fingering diagram: a hand-written open-position shape where one exists, then
  movable E- and A-shape barre positions, lowest first. A suffix we have no shape
  for falls back to the nearest chord and says so. Autoscroll holds while a
  diagram is open, and Escape closes the diagram before it leaves the song.

### Changed

- **Songs start at half the autoscroll pace they used to.** A song that has never
  had its speed touched opens at what the bar shows as "1.0x" rather than "2.0x".
  Songs already carrying a speed keep it.

### Fixed

- **Edits to a shared playlist's songs now reach its collaborators live.** Sharing
  a playlist was already live — the invite lands in the inbox instantly, and
  renaming it, adding a song or reordering it all showed up straight away — but
  editing one of its songs did not. Two things were wrong: the change was
  announced only to the person making it, and a collaborator could not edit a song
  somebody else had added at all. Transposing, capo, tempo and autoscroll pace
  travel with it. A collaborator can also take their own copy of a shared song
  again, which "Add to library" had been offering them and then refusing.

- **The editor no longer reports "Updated for everyone" when the save failed.** It
  fired the write without waiting for it and toasted regardless, closing over the
  lost edit. It waits now, and stays open with the draft intact on failure.

- **Deleting a song that belongs to a playlist no longer fails with a server
  error.** Its playlist entry still referenced it, so the delete tripped a foreign
  key.

## [2026.9.2]

Nothing in the app, the server or the extension changed in this release: the
five downloads are the same software as 2026.9.1, rebuilt. What changed is how
they are built and published.

### Changed

- **One build machine per target.** The four release builds shared a single CI
  image and a single matrix job whose every step was guarded by a condition on
  which target it was running. They are four jobs on four images now — the
  Linux AppImage, the cross-compiled Windows installer, the signed Android APK,
  and the extension zips, which need no toolchain at all and are packaged on a
  small image carrying little more than Python. Each job checks the tools it
  expects before it starts building, so an image that has drifted from the
  workflow says which tool is missing rather than failing halfway through a
  build.

- **The GitHub release is copied from the build, not rebuilt here.** Releases
  are built where development happens and then mirrored onto the public tag —
  assets, notes and the pre-release flag — by the shared project harness
  (`butler/butler.toml`), which replaces the export script this repository used
  to carry. The five files attached to a release, and the tags they hang on,
  are unchanged.

### Removed

- The README's "Contributing" section. It described how a pull request against
  a generated mirror is applied upstream — which is still true, and is what the
  2026.9.1 note above says; repeating it under a heading that invites patches
  was promising a workflow this repository cannot offer directly.

## [2026.9.1]

### Changed

- **Releases are built on self-hosted CI instead of GitHub Actions.** The same
  five files are published here as before, built from Linux: the Windows
  installer is now cross-compiled (cargo-xwin + NSIS) rather than built on a
  Windows runner, and the AppImage is still built on Ubuntu 22.04, so it keeps
  running on the same distributions.

- **This GitHub repository is now a generated export.** Development moved to a
  private repository, and `vaelum/chords` was recreated from it with its
  history rebuilt, so commit hashes differ from before. Releases continue here
  as usual. Older release downloads remain in the archived
  [vaelum/chords-legacy](https://github.com/vaelum/chords-legacy/releases).

- **The headless browser is now bounded in both directions.** It was launched on
  the first import and never closed, so a single import kept a Chromium process
  tree resident for the life of the worker — measured at ~250MB still held a
  month after the last import. Nothing capped concurrency either: every
  simultaneous import opened another tab, and Chromium spawns a renderer process
  per tab.

  `backend/web_fetch.py` now closes the context after `CHORDS_BROWSER_IDLE_TIMEOUT`
  seconds idle (default 600) and caps simultaneous tabs at
  `CHORDS_BROWSER_MAX_PAGES` (default 2). The persistent profile stays on disk,
  so a relaunch costs ~1-2s and keeps anti-bot clearance cookies.

  Concurrent imports now **queue** rather than each opening a tab; the import
  streams emit a "Waiting for a free browser slot…" progress event so that is
  visible instead of looking like a hang. Raise `CHORDS_BROWSER_MAX_PAGES` if
  imports feel queued too often.

- **The Playwright profile moved out of the data directory**
  (`CHORDS_BROWSER_PROFILE_DIR`, its own Docker volume in production). The
  deploy backup zips all of `CHORDS_DATA_DIR`, so a disposable Chromium cache
  was making every backup roughly four times larger (11MB → 47MB). A restore
  loses accumulated clearance cookies, which regenerate.

- `CHORDS_BROWSER_CHANNEL` is set empty in the production compose. The code
  default is `"chrome"`, but the image installs only the bundled Chromium, so
  that default was a guaranteed failed launch attempt on every cold start with
  none of the bot-detection benefit it exists for.


- **The reverse proxy is no longer part of the chords stack.** Caddy used to be
  a service in `docker/docker-compose.yml`, which meant it owned :80/:443 and
  every `butler.py server deploy` took TLS down with it. It now runs as its own
  stack on the deploy host, shared with the other services on the
  box, and the two meet on an external `edge` network.

  A deploy now stops only the chords container, and `lb_try_duration 30s` in
  `caddy/Caddyfile` makes requests arriving during the swap wait for the new
  container instead of getting an immediate 502.

  Nothing changes for local use: `scripts/build.sh` still brings up Caddy with
  automatic TLS, via the new `docker/docker-compose.caddy.yml` overlay, and
  creates the `edge` network if it does not exist.

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
