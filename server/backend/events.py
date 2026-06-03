"""In-process pub/sub powering the /api/events SSE stream.

A subscriber is one open SSE connection; events are fanned out per user id.
This lives entirely in this process's memory, which is fine while the app runs
as a SINGLE uvicorn worker (see docker/Dockerfile — no --workers). If you ever
scale to multiple workers or hosts, replace this with Redis pub/sub or Postgres
LISTEN/NOTIFY; the publish()/subscribe() surface can stay the same.

Events are intentionally tiny *signals*, not payloads — e.g. {"type": "inbox"}
or {"type": "playlist", "id": ...}. The client reacts by re-fetching the
affected resource, so what it ends up with is always exactly what the REST API
would return (no second serialization path to keep in sync).
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import AsyncIterator, Iterable


class _Sub:
    __slots__ = ("queue", "loop")

    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue()
        # Captured here, inside the event loop, so publish() (which runs in a
        # threadpool for sync routes) can hop back onto the right loop.
        self.loop = asyncio.get_running_loop()


_subscribers: dict[str, set[_Sub]] = defaultdict(set)


@asynccontextmanager
async def subscribe(user_id: str) -> AsyncIterator[asyncio.Queue]:
    """Register a subscriber for `user_id` and yield its event queue.

    Cleans up on exit — including when the client disconnects and Starlette
    cancels the streaming generator."""
    sub = _Sub()
    _subscribers[user_id].add(sub)
    try:
        yield sub.queue
    finally:
        subs = _subscribers.get(user_id)
        if subs is not None:
            subs.discard(sub)
            if not subs:
                _subscribers.pop(user_id, None)


def publish(user_ids: Iterable[str], event: dict) -> None:
    """Fan `event` out to every live connection for the given users.

    Safe to call from sync route handlers (which FastAPI runs in a threadpool):
    we schedule the enqueue onto each subscriber's event loop. Call it *after*
    db.commit() so the data is visible when the client re-fetches."""
    for uid in set(user_ids):
        for sub in tuple(_subscribers.get(uid, ())):
            sub.loop.call_soon_threadsafe(sub.queue.put_nowait, event)
