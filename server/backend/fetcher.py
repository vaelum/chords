"""The fetcher: the headless browser, in a container of its own.

The import used to open pages in a Chromium inside the chords container, which
holds the data directory (secrets.json among it) and sits on the `edge` network
next to Forgejo and the reverse proxy. A page could make that browser read the
one or reach the other. This service runs the same browser code in a container
with neither: no data mount, and a network of its own whose only other member
is the chords backend, which calls it over this small API (see fetching.py).

    uvicorn backend.fetcher:app --port 8001

Single worker, like the backend used to be for the browser: web_fetch keeps the
context in module globals, and Chromium locks its profile directory.
"""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import web_fetch
from .url_policy import require_http_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("chords.fetcher")

# Below the backend's own deadline (agent._FETCH_TIMEOUT, 60s), so a page that
# hangs frees its browser slot here even when nobody is waiting for it any more.
_DEADLINE = float(os.environ.get("CHORDS_FETCHER_DEADLINE", "55"))

app = FastAPI(title="chords fetcher", docs_url=None, redoc_url=None, openapi_url=None)


class FetchRequest(BaseModel):
    url: str


@app.post("/fetch")
async def fetch(body: FetchRequest) -> dict:
    """Render the page and return what web_fetch.fetch_rendered_full saw."""
    try:
        url = require_http_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await asyncio.wait_for(web_fetch.fetch_rendered_full(url), timeout=_DEADLINE)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"the page took longer than {_DEADLINE:.0f}s")
    except Exception as e:
        logger.exception("fetch failed: %s", url)
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")


@app.get("/busy")
async def busy() -> dict:
    return {"busy": web_fetch.busy()}


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}
