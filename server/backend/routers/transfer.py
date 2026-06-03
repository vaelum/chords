"""Import / export of songs and playlists as portable JSON files.

The frontend turns the exported bundle into a downloadable `.json` file and,
on import, posts a parsed bundle back here. Bundles carry no ids or ownership
so they're safe to move between accounts and installations.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Song, SongTag, Playlist, PlaylistCollaborator, PlaylistEntry, User,
)
from ..schemas import (
    TransferBundle, PortableSong, PortablePlaylist, SongOut, PlaylistOut,
)
from ..auth import get_current_user

router = APIRouter(prefix="/transfer", tags=["transfer"])

FORMAT = "chords-export"
VERSION = 1


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _portable_song(song: Song) -> PortableSong:
    return PortableSong(
        title=song.title,
        artist=song.artist,
        key=song.key,
        capo=song.capo,
        tempo=song.tempo,
        body=song.body,
        scroll_speed=song.scroll_speed,
        tags=[t.tag for t in song.tags],
    )


def _materialize_song(spec: PortableSong, owner_id: str, db: Session,
                      playlist_id: str | None = None) -> Song:
    song = Song(
        title=spec.title,
        artist=spec.artist,
        owner_id=owner_id,
        key=spec.key,
        capo=spec.capo,
        tempo=spec.tempo,
        body=spec.body,
        scroll_speed=spec.scroll_speed,
        playlist_id=playlist_id,
    )
    db.add(song)
    db.flush()
    for tag in spec.tags:
        db.add(SongTag(song_id=song.id, tag=tag))
    return song


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.get("/songs", response_model=TransferBundle)
def export_library(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export every song in the user's library (playlist songs excluded)."""
    songs = (
        db.query(Song)
        .filter(Song.owner_id == current_user.id, Song.playlist_id == None)
        .order_by(Song.updated_at.desc())
        .all()
    )
    return TransferBundle(
        kind="songs",
        exported_at=_now_ms(),
        songs=[_portable_song(s) for s in songs],
    )


@router.get("/song/{song_id}", response_model=TransferBundle)
def export_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.get(Song, song_id)
    if not song or song.owner_id != current_user.id:
        raise HTTPException(404, "Song not found")
    return TransferBundle(
        kind="songs",
        exported_at=_now_ms(),
        songs=[_portable_song(song)],
    )


@router.get("/playlist/{playlist_id}", response_model=TransferBundle)
def export_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pl = db.get(Playlist, playlist_id)
    if not pl:
        raise HTTPException(404, "Playlist not found")
    collab_ids = [c.user_id for c in pl.collaborators]
    if pl.owner_id != current_user.id and current_user.id not in collab_ids:
        raise HTTPException(404, "Playlist not found")

    songs = []
    for entry in sorted(pl.entries, key=lambda e: e.position):
        s = entry.song or db.get(Song, entry.song_id)
        if s:
            songs.append(_portable_song(s))

    return TransferBundle(
        kind="playlist",
        exported_at=_now_ms(),
        playlist=PortablePlaylist(name=pl.name, gradient=pl.gradient),
        songs=songs,
    )


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

@router.post("/import", status_code=201)
def import_bundle(
    body: TransferBundle,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import a previously exported bundle.

    A "playlist" bundle becomes a brand-new playlist (with its own song copies);
    a "songs" bundle drops its songs into the library. Either way the importer
    becomes the owner — nothing links back to the original.
    """
    if body.format != FORMAT:
        raise HTTPException(400, "Unrecognized file — not a chords export")
    if not body.songs and body.kind != "playlist":
        raise HTTPException(400, "Nothing to import")

    if body.kind == "playlist":
        meta = body.playlist or PortablePlaylist(name="Imported playlist")
        pl = Playlist(
            name=meta.name or "Imported playlist",
            gradient=meta.gradient or "gradient-1",
            owner_id=current_user.id,
            shared=False,
        )
        db.add(pl)
        db.flush()
        db.add(PlaylistCollaborator(playlist_id=pl.id, user_id=current_user.id))
        for i, spec in enumerate(body.songs):
            song = _materialize_song(spec, current_user.id, db, playlist_id=pl.id)
            db.add(PlaylistEntry(playlist_id=pl.id, song_id=song.id, position=i))
        db.commit()
        db.refresh(pl)
        return {"kind": "playlist", "playlist": PlaylistOut.model_validate(pl)}

    # kind == "songs" (default): import into the library
    created = [_materialize_song(spec, current_user.id, db) for spec in body.songs]
    db.commit()
    for s in created:
        db.refresh(s)
    return {"kind": "songs", "songs": [SongOut.model_validate(s) for s in created]}
