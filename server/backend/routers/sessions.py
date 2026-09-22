"""Playlist sessions: one device controls, every other device follows.

The state lives in `session_state` (memory, this process) rather than the
database — see that module for why. This router is the access control and the
fan-out around it: who may look, who may drive, and who gets told.

The audience for every event is `_collaborator_ids(pl)`, the same set playlist
edits already go to. On a playlist you share with nobody that set is just you —
which is what makes "follow my laptop from my phone" work without a special
case: events fan out per *connection*, so your other devices hear it and the
device that sent it filters its own echo by `origin`.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import session_state
from ..auth import get_client_id, get_current_user
from ..database import get_db
from ..events import publish
from ..models import Playlist, PlaylistCollaborator, User
from ..schemas import (
    SessionNowUpdate, SessionOut, SessionStartRequest, SessionTickUpdate,
)
from .playlists import _collaborator_ids, _get_accessible_playlist

router = APIRouter(tags=["sessions"])


def _require_client_id(client_id: Optional[str]) -> str:
    """Control is held by a device, not by an account, so every write needs the
    caller's client id. The web client always sends one (`api.js`); a request
    without one is a script, and it may read but not drive."""
    if not client_id:
        raise HTTPException(400, "X-Client-Id header required to control a session")
    return client_id


def _out(session: dict) -> SessionOut:
    return SessionOut.model_validate(session)


def _fail(err: session_state.SessionError) -> HTTPException:
    return HTTPException(409 if err.kind == "conflict" else 404, str(err))


def _announce(pl: Playlist, origin: Optional[str]) -> None:
    """A signal, not a payload: everyone re-fetches the session. The house style
    (`events.py`), and it keeps one serialization path for the snapshot."""
    publish(_collaborator_ids(pl), {"type": "session", "id": pl.id, "origin": origin})


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

@router.get("/sessions", response_model=List[SessionOut])
def my_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every live session on a playlist I can see, shared or not.

    One call at load. This is how a second device of your own finds out that the
    laptop is already running a session, without you having to remember which
    playlist it was on.
    """
    owned = db.query(Playlist.id).filter(Playlist.owner_id == current_user.id).all()
    collab = (
        db.query(PlaylistCollaborator.playlist_id)
        .filter(PlaylistCollaborator.user_id == current_user.id)
        .all()
    )
    ids = {row[0] for row in owned} | {row[0] for row in collab}
    return [_out(s) for s in session_state.live(ids)]


@router.get("/playlists/{playlist_id}/session", response_model=SessionOut)
def get_session(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The full state, snapshot included. A follower calls this on opening the
    stage view, on every `session` event, and after a reconnect — which is why
    followers need no server-side state of their own: coming back is a GET."""
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    session = session_state.get(pl.id)
    if session is None:
        raise HTTPException(404, "No session is running for this playlist")
    return _out(session)


# ---------------------------------------------------------------------------
# Control
# ---------------------------------------------------------------------------

@router.post("/playlists/{playlist_id}/session", response_model=SessionOut)
def start_session(
    playlist_id: str,
    body: SessionStartRequest = SessionStartRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Start a session, or take over one that is running (`{"takeover": true}`).

    A second starter gets 409 and the client offers *Take over*: a band has one
    leader, and two devices silently co-steering is the failure worth designing
    out — including two devices belonging to the same person.
    """
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    client_id = _require_client_id(origin)
    try:
        session = session_state.start(
            pl.id,
            user_id=current_user.id,
            client_id=client_id,
            name=current_user.name,
            takeover=body.takeover,
        )
    except session_state.SessionError as err:
        raise _fail(err) from err
    _announce(pl, origin)
    return _out(session)


@router.delete("/playlists/{playlist_id}/session")
def end_session(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    client_id = _require_client_id(origin)
    try:
        session_state.end(pl.id, client_id=client_id)
    except session_state.SessionError as err:
        raise _fail(err) from err
    _announce(pl, origin)
    return {"ok": True}


@router.put("/playlists/{playlist_id}/session/now", response_model=SessionOut)
def set_now(
    playlist_id: str,
    body: SessionNowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """What the controller has open: sent when a song is OPENED, and again on
    play, on pause and on every song change.

    Opening is the important one. Waiting for Play would leave every follower
    staring at the previous song while the band turns the page together.
    """
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    client_id = _require_client_id(origin)
    try:
        session = session_state.set_now(
            pl.id,
            client_id=client_id,
            song=body.song.model_dump(),
            line=body.line,
            speed=body.speed,
            playing=body.playing,
        )
    except session_state.SessionError as err:
        raise _fail(err) from err
    _announce(pl, origin)
    return _out(session)


@router.post("/playlists/{playlist_id}/session/tick", response_model=SessionOut)
def tick(
    playlist_id: str,
    body: SessionTickUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """The ~10 s drift beacon, sent only while playing.

    This is the one event that carries its payload inline instead of being a
    signal to re-fetch: making every follower pull a whole song body to learn one
    line number, six times a minute, is not worth the consistency it buys. The
    exception is noted in `events.py`'s docstring.
    """
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    client_id = _require_client_id(origin)
    try:
        session = session_state.tick(
            pl.id, client_id=client_id, line=body.line, playing=body.playing,
        )
    except session_state.SessionError as err:
        raise _fail(err) from err
    publish(_collaborator_ids(pl), {
        "type": "session-tick",
        "id": pl.id,
        "line": body.line,
        "playing": body.playing,
        "origin": origin,
    })
    return _out(session)
