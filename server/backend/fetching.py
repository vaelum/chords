"""Where the import's page fetches go.

With CHORDS_FETCHER_URL set (the Docker stacks set it), every fetch is a call to
the fetcher service (fetcher.py), whose browser runs in a container without the
data directory and off the `edge` network. Unset, as under `server run` and the
tests, the browser runs in this process, as it always did.

The app image has no browser installed, so a stack that lost the variable fails
its imports loudly rather than quietly fetching next to secrets.json.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("chords.fetching")

FETCHER_URL = os.environ.get("CHORDS_FETCHER_URL", "").rstrip("/")

# Longer than the backend's own deadline (agent._FETCH_TIMEOUT), which is the
# one that should fire; this only keeps a dead fetcher from hanging a request.
_HTTP_TIMEOUT = httpx.Timeout(70.0, connect=5.0)

# Tests swap in an httpx transport that serves the fetcher app in-process.
_transport: httpx.AsyncBaseTransport | None = None


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=FETCHER_URL, timeout=_HTTP_TIMEOUT, transport=_transport)


async def fetch_rendered_full(url: str) -> dict:
    """What the browser saw at `url`; see web_fetch.fetch_rendered_full."""
    if not FETCHER_URL:
        from . import web_fetch
        return await web_fetch.fetch_rendered_full(url)
    async with _client() as client:
        r = await client.post("/fetch", json={"url": url})
    if r.status_code != 200:
        try:
            detail = r.json().get("detail") or r.text
        except ValueError:
            detail = r.text
        raise RuntimeError(f"fetcher answered {r.status_code}: {detail}")
    return r.json()


async def browser_busy() -> bool:
    """True when every browser slot is taken, so the next fetch will queue.

    Only ever used to tell the user they are waiting, so a fetcher that cannot
    say counts as not busy."""
    if not FETCHER_URL:
        from . import web_fetch
        return web_fetch.busy()
    try:
        async with _client() as client:
            r = await client.get("/busy", timeout=3.0)
        return bool(r.json().get("busy"))
    except Exception:
        logger.debug("asking the fetcher whether it is busy failed", exc_info=True)
        return False
