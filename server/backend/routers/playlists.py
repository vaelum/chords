import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Playlist, PlaylistCollaborator, PlaylistEntry,
    Song, SongTag, User,
)
from ..schemas import (
    PlaylistCreate, PlaylistUpdate, PlaylistOut,
    AddToPlaylistRequest, CollaboratorsUpdate, ReorderPlaylistRequest,
)
from ..auth import get_current_user, get_client_id
from ..events import publish

router = APIRouter(prefix="/playlists", tags=["playlists"])

GRADIENTS = [f"gradient-{i}" for i in range(1, 7)]


def _now():
    return datetime.now(timezone.utc)


def _collaborator_ids(pl: Playlist) -> list[str]:
    """Everyone with access — including the actor, whose *other* sessions also
    need the nudge. The originating tab filters out its own echo by `origin`."""
    return [c.user_id for c in pl.collaborators]


def _pl_out(pl: Playlist) -> PlaylistOut:
    return PlaylistOut.model_validate(pl)


def _get_accessible_playlist(playlist_id: str, current_user: User, db: Session) -> Playlist:
    pl = db.get(Playlist, playlist_id)
    if not pl:
        raise HTTPException(404, "Playlist not found")
    collab_ids = [c.user_id for c in pl.collaborators]
    if pl.owner_id != current_user.id and current_user.id not in collab_ids:
        raise HTTPException(404, "Playlist not found")
    return pl


# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------

@router.get("", response_model=List[PlaylistOut])
def list_playlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owned = db.query(Playlist).filter(Playlist.owner_id == current_user.id).all()
    collab_ids = (
        db.query(PlaylistCollaborator.playlist_id)
        .filter(PlaylistCollaborator.user_id == current_user.id)
        .all()
    )
    collab_pl_ids = {row[0] for row in collab_ids}
    owned_ids = {p.id for p in owned}
    extra_ids = collab_pl_ids - owned_ids
    extra = [db.get(Playlist, pid) for pid in extra_ids if pid]
    all_pl = owned + [p for p in extra if p]
    all_pl.sort(key=lambda p: p.updated_at, reverse=True)
    return [_pl_out(p) for p in all_pl]


@router.post("", response_model=PlaylistOut, status_code=201)
def create_playlist(
    body: PlaylistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    existing = db.query(Playlist).filter(Playlist.owner_id == current_user.id).count()
    gradient = GRADIENTS[existing % len(GRADIENTS)]
    pl = Playlist(
        name=body.name,
        gradient=body.gradient or gradient,
        owner_id=current_user.id,
    )
    db.add(pl)
    db.flush()
    db.add(PlaylistCollaborator(playlist_id=pl.id, user_id=current_user.id))
    db.commit()
    db.refresh(pl)
    publish([current_user.id], {"type": "playlists", "origin": origin})
    return _pl_out(pl)


@router.get("/{playlist_id}", response_model=PlaylistOut)
def get_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    return _pl_out(pl)


@router.put("/{playlist_id}", response_model=PlaylistOut)
def update_playlist(
    playlist_id: str,
    body: PlaylistUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    if body.name is not None:
        pl.name = body.name
    if body.gradient is not None:
        pl.gradient = body.gradient
    pl.updated_at = _now()
    db.commit()
    db.refresh(pl)
    publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)


@router.delete("/{playlist_id}")
def delete_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)

    collab_ids = [c.user_id for c in pl.collaborators]
    remaining = [uid for uid in collab_ids if uid != current_user.id]

    # If others still share this playlist, the current user just leaves it —
    # the playlist lives on for everyone else.
    if remaining:
        db.query(PlaylistCollaborator).filter(
            PlaylistCollaborator.playlist_id == pl.id,
            PlaylistCollaborator.user_id == current_user.id,
        ).delete()
        if pl.owner_id == current_user.id:
            pl.owner_id = remaining[0]   # hand ownership to a remaining member
        pl.shared = len(remaining) > 1
        pl.updated_at = _now()
        db.commit()
        # Remaining members see the membership (and possibly owner) change; the
        # leaver's other sessions drop it (their origin tab already did, locally).
        publish(collab_ids, {"type": "playlists", "origin": origin})
        return {"left": True, "playlist_id": pl.id}

    # Last person out (or never shared): remove the playlist and its songs.
    for entry in pl.entries:
        song = db.get(Song, entry.song_id)
        if song and song.playlist_id == playlist_id:
            db.delete(song)
    db.delete(pl)
    db.commit()
    publish([current_user.id], {"type": "playlists", "origin": origin})
    return {"deleted": True, "playlist_id": playlist_id}


# ---------------------------------------------------------------------------
# Songs in playlist
# ---------------------------------------------------------------------------

@router.post("/{playlist_id}/songs", response_model=PlaylistOut)
def add_song_to_playlist(
    playlist_id: str,
    body: AddToPlaylistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)

    # A playlist always owns a hard copy of its songs — never a link to a
    # library song. Build that copy either from an existing owned song
    # (body.song_id) or from a fresh payload (body.song).
    if body.song_id is not None:
        source = db.get(Song, body.song_id)
        if not source or source.owner_id != current_user.id:
            raise HTTPException(404, "Song not found")
        new_song = Song(
            title=source.title,
            artist=source.artist,
            owner_id=current_user.id,
            key=source.key,
            capo=source.capo,
            tempo=source.tempo,
            body=source.body,
            scroll_speed=source.scroll_speed,
            playlist_id=playlist_id,
        )
        db.add(new_song)
        db.flush()
        for t in source.tags:
            db.add(SongTag(song_id=new_song.id, tag=t.tag))
    elif body.song is not None:
        spec = body.song
        new_song = Song(
            title=spec.title,
            artist=spec.artist,
            owner_id=current_user.id,
            key=spec.key,
            capo=spec.capo,
            tempo=spec.tempo,
            body=spec.body,
            scroll_speed=spec.scroll_speed,
            playlist_id=playlist_id,
        )
        db.add(new_song)
        db.flush()
        for tag in spec.tags:
            db.add(SongTag(song_id=new_song.id, tag=tag))
    else:
        raise HTTPException(400, "Provide either song_id or song")
    db.flush()

    position = len(pl.entries)
    db.add(PlaylistEntry(
        playlist_id=playlist_id,
        song_id=new_song.id,
        position=position,
    ))
    pl.updated_at = _now()
    db.commit()
    db.refresh(pl)
    publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)


@router.delete("/{playlist_id}/songs/{song_id}", response_model=PlaylistOut)
def remove_song_from_playlist(
    playlist_id: str,
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    entry = next((e for e in pl.entries if e.song_id == song_id), None)
    if not entry:
        raise HTTPException(404, "Song not in playlist")
    song = db.get(Song, entry.song_id)
    if song and song.playlist_id == playlist_id:
        db.delete(song)
    db.delete(entry)
    pl.updated_at = _now()
    db.commit()
    db.refresh(pl)
    publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)


@router.put("/{playlist_id}/reorder", response_model=PlaylistOut)
def reorder_playlist(
    playlist_id: str,
    body: ReorderPlaylistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = _get_accessible_playlist(playlist_id, current_user, db)
    order = {song_id: i for i, song_id in enumerate(body.song_ids)}
    # Songs not named in the request keep a stable position after the rest.
    fallback = len(order)
    for entry in pl.entries:
        entry.position = order.get(entry.song_id, fallback)
    pl.updated_at = _now()
    db.commit()
    db.refresh(pl)
    publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)


# ---------------------------------------------------------------------------
# Collaborators
# ---------------------------------------------------------------------------

@router.put("/{playlist_id}/collaborators", response_model=PlaylistOut)
def update_collaborators(
    playlist_id: str,
    body: CollaboratorsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    pl = db.get(Playlist, playlist_id)
    if not pl or pl.owner_id != current_user.id:
        raise HTTPException(404, "Playlist not found")

    # always keep owner
    user_ids = list({current_user.id, *body.user_ids})
    old_ids = {c.user_id for c in pl.collaborators}

    db.query(PlaylistCollaborator).filter(
        PlaylistCollaborator.playlist_id == playlist_id
    ).delete()
    for uid in user_ids:
        if db.get(User, uid):
            db.add(PlaylistCollaborator(playlist_id=playlist_id, user_id=uid))

    pl.shared = len(user_ids) > 1
    pl.updated_at = _now()
    db.commit()
    db.refresh(pl)
    # Notify everyone who gained or lost access (added and removed members),
    # plus the actor's other sessions.
    publish(old_ids | set(user_ids), {"type": "playlists", "origin": origin})
    return _pl_out(pl)


# ---------------------------------------------------------------------------
# Read-only public share link (owner only)
# ---------------------------------------------------------------------------

@router.post("/{playlist_id}/share-link", response_model=PlaylistOut)
def create_share_link(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Enable (or return the existing) read-only public link for a playlist."""
    pl = db.get(Playlist, playlist_id)
    if not pl or pl.owner_id != current_user.id:
        raise HTTPException(404, "Playlist not found")
    if not pl.public_token:
        pl.public_token = secrets.token_urlsafe(16)
        db.commit()
        db.refresh(pl)
        publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)


@router.delete("/{playlist_id}/share-link", response_model=PlaylistOut)
def delete_share_link(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Disable the read-only public link (any shared URL stops working)."""
    pl = db.get(Playlist, playlist_id)
    if not pl or pl.owner_id != current_user.id:
        raise HTTPException(404, "Playlist not found")
    if pl.public_token:
        pl.public_token = None
        db.commit()
        db.refresh(pl)
        publish(_collaborator_ids(pl), {"type": "playlist", "id": pl.id, "origin": origin})
    return _pl_out(pl)
