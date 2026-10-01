"""In-process state for playlist sessions: one controller, many followers.

A session is what lets a phone on a music stand show whatever the laptop across
the room has open. It holds the song the controller is on — as a full snapshot,
not an id, because the controller may open a song no follower can fetch — plus
where in that song it is and whether it is scrolling.

This lives in this process's memory, beside `events._subscribers`, and for the
same reason: the app runs as a SINGLE uvicorn worker (see docker/Dockerfile).
A restart ends every session, which is survivable — both ends show "session
ended" and starting again is one tap — and is the same constraint the event
stream already documents. If this ever grows a second worker, this module and
`events.py` move to Redis together.

Nothing here touches the database. A session is not a record; it is a
conversation that is happening right now.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Iterator, Optional

# A session with no tick and no change for this long is gone. Long enough to
# survive a set break and a locked phone, short enough that a session forgotten
# on a closed laptop doesn't greet you tomorrow.
TTL_SECONDS = 15 * 60

# A snapshot is a song someone is looking at, not a file upload. The cap stops a
# session being used to park megabytes in the server's memory, and it is far
# above any real song: the largest in a test library is ~8 KB.
MAX_SNAPSHOT_CHARS = 100_000

# Sessions are read and written from sync route handlers, which FastAPI runs in a
# threadpool — so two requests really can land at once, and "start" must not be
# able to interleave with "take over".
_lock = threading.Lock()
_sessions: dict[str, dict] = {}

# Called with the playlist id of every session that expired, outside the lock.
# The router registers the announcement: a follower must hear that a session
# ended even when nobody ended it.
_expiry_listeners: list[Callable[[str], None]] = []


def on_expiry(fn: Callable[[str], None]) -> None:
    _expiry_listeners.append(fn)


def _notify(expired: list[str]) -> None:
    for pid in expired:
        for fn in _expiry_listeners:
            fn(pid)


class SessionError(Exception):
    """Raised for the states a caller has to tell apart: somebody else holds
    control (`conflict`), there is nothing to control (`missing`), and a write
    from the controller that something newer has overtaken (`stale`). The router
    turns these into 409, 404 and 412; keeping HTTP out of here means this
    module can be read on its own."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def _expired(session: dict, now: float) -> bool:
    return now - session["last_seen"] > TTL_SECONDS


def _sweep(now: float) -> list[str]:
    """Drop dead sessions, and return their playlist ids for `_notify` — which
    the caller runs once it has let go of the lock. Called from every entry
    point, and every minute by `sweep_expired` from the app's lifespan, so an
    expiry is announced even when nobody asks."""
    expired = [pid for pid, s in _sessions.items() if _expired(s, now)]
    for pid in expired:
        _sessions.pop(pid, None)
    return expired


def sweep_expired() -> list[str]:
    """Drop and announce every expired session. Returns their playlist ids."""
    with _lock:
        expired = _sweep(time.time())
    _notify(expired)
    return expired


def age(session: dict) -> float:
    """Seconds since the session's line was measured: what a follower needs to
    place an anchor without comparing two machines' clocks."""
    now = session.get("now")
    return max(0.0, time.time() - now["since"]) if now else 0.0


def _check_seq(session: dict, seq: Optional[int]) -> None:
    """The controller numbers its writes. One numbered at or below the last one
    applied was overtaken on the way (FastAPI runs requests in a threadpool) and
    would roll the session back. Unnumbered writes are an older client's, and
    are taken as they come."""
    if seq is None:
        return
    if seq <= session.get("seq", 0):
        raise SessionError("stale", "A newer update from this device has already arrived")
    session["seq"] = seq


def get(playlist_id: str) -> Optional[dict]:
    """The live session for a playlist, or None. Never returns an expired one."""
    with _lock:
        expired = _sweep(time.time())
        session = _sessions.get(playlist_id)
    _notify(expired)
    return session


def live(playlist_ids: Iterator[str] | list[str]) -> list[dict]:
    """Every live session among `playlist_ids`.

    This is what a second device of your own calls at load to discover that the
    laptop is already running a session — so it is asked for a set of playlists,
    not for "mine", and the caller decides what it is allowed to see.
    """
    wanted = set(playlist_ids)
    with _lock:
        expired = _sweep(time.time())
        found = [s for pid, s in _sessions.items() if pid in wanted]
    _notify(expired)
    return found


def start(
    playlist_id: str,
    *,
    user_id: str,
    client_id: str,
    name: str,
    takeover: bool = False,
) -> dict:
    """Begin a session, or take control of one that exists.

    Control belongs to a *client id*, not a user id: your second device is a
    follower like anyone else and has to ask. Two devices of one person silently
    fighting over `now` is exactly what this prevents.

    A repeat call from the device that already controls is a no-op rather than a
    conflict, so a double tap or a retry after a flaky response cannot lock you
    out of your own session.
    """
    expired: list[str] = []
    try:
        with _lock:
            now = time.time()
            expired = _sweep(now)
            existing = _sessions.get(playlist_id)
            if existing is not None:
                if existing["controller_client_id"] == client_id:
                    existing["last_seen"] = now
                    return existing
                if not takeover:
                    raise SessionError("conflict", f"{existing['controller_name']} is already running this session")
                # Take-over keeps `now`, so followers do not blink: the new
                # controller inherits the song on screen and carries on from it.
                # It numbers its writes from its own counter, so `seq` restarts.
                existing.update(
                    controller_user_id=user_id,
                    controller_client_id=client_id,
                    controller_name=name,
                    version=existing["version"] + 1,
                    last_seen=now,
                    seq=0,
                )
                return existing
            session = {
                "playlist_id": playlist_id,
                "controller_user_id": user_id,
                "controller_client_id": client_id,
                "controller_name": name,
                "started_at": now,
                "version": 1,
                "last_seen": now,
                "now": None,
                "seq": 0,
            }
            _sessions[playlist_id] = session
            return session
    finally:
        _notify(expired)


def end(playlist_id: str, *, client_id: str) -> None:
    """End a session. Only the controlling device can; a follower closing its
    screen is not an event anyone else needs to hear about."""
    with _lock:
        session = _sessions.get(playlist_id)
        if session is None:
            raise SessionError("missing", "No session is running for this playlist")
        if session["controller_client_id"] != client_id:
            raise SessionError("conflict", "Only the controlling device can end the session")
        _sessions.pop(playlist_id, None)


def _controlled(playlist_id: str, client_id: str, now: float, expired: list[str]) -> dict:
    """The session `client_id` is driving, under the lock. One found expired is
    dropped and added to `expired`, for the caller to announce."""
    session = _sessions.get(playlist_id)
    if session is not None and _expired(session, now):
        _sessions.pop(playlist_id, None)
        expired.append(playlist_id)
        session = None
    if session is None:
        raise SessionError("missing", "No session is running for this playlist")
    if session["controller_client_id"] != client_id:
        raise SessionError("conflict", "Only the controlling device can drive the session")
    return session


def set_now(
    playlist_id: str,
    *,
    client_id: str,
    song: dict[str, Any],
    line: float,
    speed: float,
    playing: bool,
    seq: Optional[int] = None,
) -> dict:
    """Replace what the session is on: a song the controller just opened, or the
    same song now playing or paused.

    This fires when a song is *opened*, not only when it is played — that is the
    whole point of the feature, and the reason `playing` is a field rather than
    an implication. A follower renders the snapshot either way and only runs its
    clock when `playing` is true.
    """
    body = song.get("body") or ""
    if len(body) > MAX_SNAPSHOT_CHARS:
        raise SessionError("conflict", "That song is too large to share in a session")
    expired: list[str] = []
    try:
        with _lock:
            now = time.time()
            session = _controlled(playlist_id, client_id, now, expired)
            _check_seq(session, seq)
            session["now"] = {
                "song": song,
                "speed": float(speed),
                "line": float(line),
                "playing": bool(playing),
                "since": now,
            }
            session["version"] += 1
            session["last_seen"] = now
            return session
    finally:
        _notify(expired)


def tick(
    playlist_id: str,
    *,
    client_id: str,
    line: float,
    playing: bool,
    song_id: Optional[str] = None,
    speed: Optional[float] = None,
    seq: Optional[int] = None,
) -> dict:
    """The controller's position: the drift beacon every ~10 s while playing,
    a hand scroll while paused, and a change of speed.

    Deliberately cheap: it moves the anchor and nothing else, so it can be
    published with its payload inline instead of making every follower re-fetch a
    whole song body to learn one number. It still bumps `version`, so a follower
    can tell it from the snapshot before it.

    A tick names the song it was measured on. One for a song that is no longer
    on screen — the beacon from the old song, landing after the new one's PUT —
    is refused rather than moving the new song's line. Older clients send no
    song id, no speed and no `seq`; their ticks are taken as before.
    """
    expired: list[str] = []
    try:
        with _lock:
            now = time.time()
            session = _controlled(playlist_id, client_id, now, expired)
            current = session["now"]
            if current is None:
                raise SessionError("missing", "The session has no song open yet")
            if song_id is not None and (current["song"] or {}).get("id") != song_id:
                raise SessionError("stale", "That song is no longer the one on screen")
            _check_seq(session, seq)
            current["line"] = float(line)
            current["playing"] = bool(playing)
            if speed is not None:
                current["speed"] = float(speed)
            current["since"] = now
            session["version"] += 1
            session["last_seen"] = now
            return session
    finally:
        _notify(expired)


def clear_all() -> None:
    """Drop every session. For tests; nothing in the app calls it."""
    with _lock:
        _sessions.clear()
