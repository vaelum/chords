# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version below has a `## [x.y.z]` heading. The release workflow
extracts the section matching the pushed tag (`vx.y.z`) and uses it as the
GitHub Release body — so keep these sections accurate before tagging.

## [Unreleased]

- Work in progress lands here; move it under a new version heading when tagging.

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
