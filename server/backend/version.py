"""Build identity for the served frontend.

A "build" is the exact set of frontend asset bytes this process is serving. We
hash those bytes once at import and use the short digest as the build id. Because
a deploy both replaces the files AND restarts the process (scripts/deploy.sh runs
`docker compose down` then `up`), every deploy yields a fresh import that
recomputes a new id — no manual version bumping needed.

The id reaches the client two ways, and the client compares them:
  - injected into index.html at serve time (see main.py), so a freshly loaded
    page knows the exact build it is running;
  - sent as the first frame of every /events SSE stream (see routers/events.py).
When a client reconnects after a deploy, the stream reports a newer id than the
one baked into its already-loaded page, and the client prompts a reload. See the
frontend's useStore()/UpdateBanner in app.jsx.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Suffixes whose contents define a build: everything a page reload actually
# fetches. (.jsx sources are deliberately excluded — they are never served; only
# the compiled .js is, and hashing the source would flag phantom changes when a
# .jsx is edited without recompiling.)
_BUILD_SUFFIXES = {".html", ".js", ".css", ".webmanifest"}


def _compute() -> str:
    h = hashlib.sha256()
    paths = sorted(
        p for p in FRONTEND_DIR.rglob("*")
        if p.is_file() and p.suffix in _BUILD_SUFFIXES
    )
    for p in paths:
        # Hash the path too, so a rename/move is itself a change.
        h.update(p.relative_to(FRONTEND_DIR).as_posix().encode())
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:12]


BUILD_ID = _compute()
