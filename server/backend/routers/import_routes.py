import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

logger = logging.getLogger("chords.import")

from ..agent import (
    stream_search, stream_extract, stream_scan_playlist, stream_auto_import,
    stream_extract_text, stream_extract_image, stream_scan_text, stream_auto_text,
)
from ..web_fetch import fetch_screenshot
from ..auth import get_current_user
from ..models import User

router = APIRouter(prefix="/import", tags=["import"])


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class SearchRequest(_Base):
    query: str


class ExtractRequest(_Base):
    url: str


class ExtractTextRequest(_Base):
    text: str
    url: Optional[str] = None


class ExtractImageRequest(_Base):
    image_data: str            # base64 (no data: URL prefix)
    media_type: Optional[str] = "image/png"


class PlaylistScanRequest(_Base):
    url: str


class ScanTextRequest(_Base):
    text: str
    links: list[dict] = []
    url: Optional[str] = None


class AutoImportRequest(_Base):
    url: str


class ScreenshotRequest(_Base):
    url: str


def _ndjson(stream, label: str = "import"):
    """Wrap an event stream as an NDJSON response, stamping each event with
    timing so the client (and logs) show where the time went:
      t  — seconds since the request started
      dt — seconds since the previous event (i.e. how long the step that just
           finished took — the gap before a slow event is the slow phase)."""
    async def gen():
        start = time.perf_counter()
        last = start
        try:
            async for evt in stream:
                now = time.perf_counter()
                t, dt = round(now - start, 2), round(now - last, 2)
                last = now
                logger.info("[%s] %-8s t=%5.2fs dt=%5.2fs %s",
                            label, evt.get("type", "?"), t, dt, evt.get("message", ""))
                yield json.dumps({**evt, "t": t, "dt": dt}) + "\n"
        except Exception:
            # The stream itself blew up (not a handled error event). Log the full
            # traceback with timing, and send a final error line so the client
            # shows a failure instead of hanging on a half-open connection.
            elapsed = round(time.perf_counter() - start, 2)
            logger.exception("[%s] import stream crashed after %.2fs", label, elapsed)
            yield json.dumps({
                "type": "error",
                "message": "Server error during import — check the server logs.",
                "t": elapsed,
            }) + "\n"
    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        # Disable buffering so progress events reach the client promptly.
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/search")
async def search(body: SearchRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_search(body.query), "search")


@router.post("/extract")
async def extract(body: ExtractRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_extract(body.url), "extract")


@router.post("/extract-text")
async def extract_text(body: ExtractTextRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_extract_text(body.text, body.url or ""), "extract-text")


@router.post("/extract-image")
async def extract_image(body: ExtractImageRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_extract_image(body.image_data, body.media_type or "image/png"), "extract-image")


@router.post("/playlist-scan")
async def playlist_scan(body: PlaylistScanRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_scan_playlist(body.url), "playlist-scan")


@router.post("/scan-text")
async def scan_text(body: ScanTextRequest, _: User = Depends(get_current_user)):
    """Scan client-scraped page text + links for playlist song links."""
    return _ndjson(stream_scan_text(body.text, body.links, body.url or ""), "scan-text")


@router.post("/auto-text")
async def auto_text(body: ScanTextRequest, _: User = Depends(get_current_user)):
    """Auto-detect playlist vs single song from client-scraped text + links."""
    return _ndjson(stream_auto_text(body.text, body.links, body.url or ""), "auto-text")


@router.post("/auto")
async def auto_import(body: AutoImportRequest, _: User = Depends(get_current_user)):
    return _ndjson(stream_auto_import(body.url), "auto")


@router.post("/screenshot")
async def screenshot(body: ScreenshotRequest, _: User = Depends(get_current_user)):
    try:
        png = await fetch_screenshot(body.url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="chords-debug.png"'},
    )
