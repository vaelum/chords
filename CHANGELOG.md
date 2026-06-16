# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version below has a `## [x.y.z]` heading. The release workflow
extracts the section matching the pushed tag (`vx.y.z`) and uses it as the
GitHub Release body — so keep these sections accurate before tagging.

## [Unreleased]

- Work in progress lands here; move it under a new version heading when tagging.

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
