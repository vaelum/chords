from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Song, SongTag, Playlist, PlaylistEntry
from ..schemas import SongCreate, SongUpdate, SongOut
from ..auth import get_current_user, get_client_id
from ..events import publish
from ..models import User

router = APIRouter(prefix="/songs", tags=["songs"])


def _now():
    return datetime.now(timezone.utc)


def _sync_tags(db: Session, song: Song, tags: List[str]):
    db.query(SongTag).filter(SongTag.song_id == song.id).delete()
    for tag in tags:
        db.add(SongTag(song_id=song.id, tag=tag))


def _song_out(song: Song) -> SongOut:
    return SongOut.model_validate(song)


def _playlist_of(db: Session, song: Song) -> Optional[Playlist]:
    """The playlist that owns this song, or None for a library song."""
    return db.get(Playlist, song.playlist_id) if song.playlist_id else None


def _audience(db: Session, song: Song) -> List[str]:
    """Everyone whose UI shows this song.

    A playlist-owned copy is on screen for every collaborator on that playlist,
    not just the person who added it — so an edit has to reach all of them, the
    same way playlists.py fans playlist changes out to _collaborator_ids(). A
    library song is only ever the owner's, so that stays a one-id audience."""
    pl = _playlist_of(db, song)
    if pl is None:
        return [song.owner_id]
    return [c.user_id for c in pl.collaborators] or [song.owner_id]


def _accessible_song(db: Session, song_id: str, user: User) -> Song:
    """The song, if `user` may see and change it.

    Two ways in: it's their own library song, or it's a playlist-owned copy in a
    playlist they collaborate on. The second case is what makes a shared playlist
    actually shared — without it a collaborator 404s on a song someone else added,
    which also breaks the client's refetch of a 'song' event. 404 (not 403) for a
    miss, so the endpoint never confirms a song id the caller can't see."""
    song = db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    if song.owner_id == user.id:
        return song
    pl = _playlist_of(db, song)
    if pl is not None and any(c.user_id == user.id for c in pl.collaborators):
        return song
    raise HTTPException(404, "Song not found")


# ---------------------------------------------------------------------------
# Songs
# ---------------------------------------------------------------------------

@router.get("", response_model=List[SongOut])
def list_songs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    songs = db.query(Song).filter(
        Song.owner_id == current_user.id,
        Song.playlist_id == None
    ).order_by(Song.updated_at.desc()).all()
    return [_song_out(s) for s in songs]


@router.post("", response_model=SongOut, status_code=201)
def create_song(
    body: SongCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    song = Song(
        title=body.title,
        artist=body.artist,
        owner_id=current_user.id,
        key=body.key,
        capo=body.capo,
        tempo=body.tempo,
        body=body.body,
        scroll_speed=body.scroll_speed,
    )
    db.add(song)
    db.flush()  # get song.id

    _sync_tags(db, song, body.tags)
    db.commit()
    db.refresh(song)
    publish([current_user.id], {"type": "songs", "origin": origin})
    return _song_out(song)


@router.get("/{song_id}", response_model=SongOut)
def get_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = _accessible_song(db, song_id, current_user)
    return _song_out(song)


@router.put("/{song_id}", response_model=SongOut)
def update_song(
    song_id: str,
    body: SongUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    song = _accessible_song(db, song_id, current_user)
    if body.title is not None:
        song.title = body.title
    if body.artist is not None:
        song.artist = body.artist
    if body.key is not None:
        song.key = body.key
    if body.capo is not None:
        song.capo = body.capo
    if body.tempo is not None:
        song.tempo = body.tempo
    if body.body is not None:
        song.body = body.body
    if body.scroll_speed is not None:
        song.scroll_speed = body.scroll_speed
    if body.tags is not None:
        _sync_tags(db, song, body.tags)
    song.updated_at = _now()
    db.commit()
    db.refresh(song)
    # A song can also be a playlist-owned copy, so the client syncs it wherever
    # that id lives (library list and/or playlist entries) — and for a shared
    # playlist that means every collaborator's session, not just the editor's.
    publish(_audience(db, song), {"type": "song", "id": song.id, "origin": origin})
    return _song_out(song)


@router.delete("/{song_id}", status_code=204)
def delete_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    song = db.get(Song, song_id)
    if not song or song.owner_id != current_user.id:
        raise HTTPException(404, "Song not found")
    # A playlist-owned copy is still referenced by its playlist entry; dropping
    # the song row first trips the FK and 500s. Clear the entry, and tell the
    # playlist's collaborators — a "songs" signal only refetches the library
    # list, which would leave the song sitting in everyone's playlist view.
    pl = _playlist_of(db, song)
    audience = _audience(db, song)
    if pl is not None:
        db.query(PlaylistEntry).filter(PlaylistEntry.song_id == song.id).delete()
        pl.updated_at = _now()
    db.delete(song)
    db.commit()
    if pl is not None:
        publish(audience, {"type": "playlist", "id": pl.id, "origin": origin})
    else:
        publish(audience, {"type": "songs", "origin": origin})


@router.post("/{song_id}/duplicate", response_model=SongOut, status_code=201)
def duplicate_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    original = db.get(Song, song_id)
    if not original or original.owner_id != current_user.id:
        raise HTTPException(404, "Song not found")

    copy = Song(
        title=f"{original.title} (copy)",
        artist=original.artist,
        owner_id=current_user.id,
        key=original.key,
        capo=original.capo,
        tempo=original.tempo,
        body=original.body,
        scroll_speed=original.scroll_speed,
    )
    db.add(copy)
    db.flush()

    for tag in original.tags:
        db.add(SongTag(song_id=copy.id, tag=tag.tag))
    db.commit()
    db.refresh(copy)
    publish([current_user.id], {"type": "songs", "origin": origin})
    return _song_out(copy)


@router.post("/{song_id}/copy-to-library", response_model=SongOut, status_code=201)
def copy_to_library(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Copy a song (typically a playlist-owned one) into the user's library as
    an independent song. The new copy is not tied to any playlist.

    Anyone who can see the song can take a copy — including a collaborator
    copying a song someone else added to a shared playlist, which is what the
    song view's "Add to library" offers them."""
    original = _accessible_song(db, song_id, current_user)

    copy = Song(
        title=original.title,
        artist=original.artist,
        owner_id=current_user.id,
        key=original.key,
        capo=original.capo,
        tempo=original.tempo,
        body=original.body,
        scroll_speed=original.scroll_speed,
        playlist_id=None,   # lands in the library, independent of any playlist
    )
    db.add(copy)
    db.flush()

    for tag in original.tags:
        db.add(SongTag(song_id=copy.id, tag=tag.tag))
    db.commit()
    db.refresh(copy)
    publish([current_user.id], {"type": "songs", "origin": origin})
    return _song_out(copy)


