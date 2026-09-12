"""Server-Sent Events stream: pushes live signals (new inbox items, shared
playlist changes) so the client never has to reload to see them.

Native EventSource can't send an Authorization header, so the client opens this
with fetch + Bearer token (see frontend/api.js openEventStream) and parses the
SSE frames itself."""
import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..auth import _decode_token
from ..database import SessionLocal
from ..events import subscribe
from ..models import User
from ..version import BUILD_ID

router = APIRouter(prefix="/events", tags=["events"])

# Send a comment line at least this often so idle connections stay open through
# proxies and so client disconnects are noticed promptly (the failing write
# surfaces the drop and cancels the generator).
_HEARTBEAT_SECONDS = 25


def _authenticate(authorization: Optional[str]) -> str:
    """Validate the Bearer token with a short-lived DB session and return the
    user id. The session is closed before we start streaming so a long-lived
    connection never holds a pooled SQLite connection."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not authenticated")
    user_id = _decode_token(authorization.split(" ", 1)[1])
    if not user_id:
        raise HTTPException(401, "Invalid token")
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
    finally:
        db.close()
    if not user:
        raise HTTPException(401, "User not found")
    return user_id


@router.get("")
async def events(authorization: Optional[str] = Header(default=None)):
    user_id = _authenticate(authorization)

    async def gen():
        async with subscribe(user_id) as queue:
            # Prime the stream so the client knows it's live, and tell it which
            # build this server is serving. The client compares this to the build
            # baked into its loaded page; if they differ (it reconnected after a
            # deploy) it prompts the user to reload. Sent on every (re)connect.
            yield f"data: {json.dumps({'type': 'hello', 'build': BUILD_ID})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Defeat proxy buffering (matches the import NDJSON stream).
            "X-Accel-Buffering": "no",
        },
    )
