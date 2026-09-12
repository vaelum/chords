import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InboxItem, Song, SongTag, Playlist, PlaylistCollaborator, PlaylistEntry, User
from ..schemas import InboxItemOut, ShareSongRequest, SharePlaylistRequest
from ..auth import get_current_user, get_client_id
from ..events import publish

router = APIRouter(prefix="/inbox", tags=["inbox"])


def _now():
    return datetime.now(timezone.utc)


def _item_out(item: InboxItem) -> InboxItemOut:
    return InboxItemOut.model_validate(item)


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------

@router.get("", response_model=List[InboxItemOut])
def list_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = (
        db.query(InboxItem)
        .filter(InboxItem.to_user_id == current_user.id)
        .order_by(InboxItem.created_at.desc())
        .all()
    )
    return [_item_out(i) for i in items]


@router.put("/{item_id}/read", response_model=InboxItemOut)
def mark_read(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    item = db.get(InboxItem, item_id)
    if not item or item.to_user_id != current_user.id:
        raise HTTPException(404, "Item not found")
    item.unread = False
    db.commit()
    db.refresh(item)
    publish([current_user.id], {"type": "inbox", "origin": origin})
    return _item_out(item)


@router.put("/read-all", status_code=204)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    db.query(InboxItem).filter(
        InboxItem.to_user_id == current_user.id,
        InboxItem.unread == True,
    ).update({"unread": False})
    db.commit()
    publish([current_user.id], {"type": "inbox", "origin": origin})


@router.delete("/{item_id}", status_code=204)
def dismiss(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    item = db.get(InboxItem, item_id)
    if not item or item.to_user_id != current_user.id:
        raise HTTPException(404, "Item not found")
    db.delete(item)
    db.commit()
    publish([current_user.id], {"type": "inbox", "origin": origin})


# ---------------------------------------------------------------------------
# Accept / conflict resolution for song items
# ---------------------------------------------------------------------------

@router.post("/{item_id}/accept", status_code=201)
def accept_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Accept a song or playlist share — adds it to the recipient's library."""
    item = db.get(InboxItem, item_id)
    if not item or item.to_user_id != current_user.id:
        raise HTTPException(404, "Item not found")

    if item.kind == "song":
        snap = json.loads(item.song_snapshot or "{}")
        song = Song(
            title=snap.get("title", "Untitled"),
            artist=snap.get("artist", "Unknown"),
            owner_id=current_user.id,
            key=snap.get("key", "C"),
            capo=snap.get("capo", 0),
            tempo=snap.get("tempo", 90),
            body=snap.get("body", ""),
        )
        db.add(song)
        db.flush()
        for tag in snap.get("tags", []):
            db.add(SongTag(song_id=song.id, tag=tag))
        db.delete(item)
        db.commit()
        # Other sessions: library gained a song, inbox lost an item.
        publish([current_user.id], {"type": "songs", "origin": origin})
        publish([current_user.id], {"type": "inbox", "origin": origin})
        return {"songId": song.id}

    elif item.kind == "playlist":
        # The recipient gets their own independent copy of the playlist, with
        # its own hard copies of every song.
        songs_snap = json.loads(item.playlist_snapshot or "[]")
        pl = Playlist(
            name=item.playlist_name or "Shared playlist",
            gradient="gradient-5",
            owner_id=current_user.id,
            shared=False,
        )
        db.add(pl)
        db.flush()
        db.add(PlaylistCollaborator(playlist_id=pl.id, user_id=current_user.id))
        for i, snap in enumerate(songs_snap):
            song = Song(
                title=snap.get("title", "Untitled"),
                artist=snap.get("artist", "Unknown"),
                owner_id=current_user.id,
                key=snap.get("key", "C"),
                capo=snap.get("capo", 0),
                tempo=snap.get("tempo", 90),
                body=snap.get("body", ""),
                playlist_id=pl.id,
            )
            db.add(song)
            db.flush()
            for tag in snap.get("tags", []):
                db.add(SongTag(song_id=song.id, tag=tag))
            db.add(PlaylistEntry(playlist_id=pl.id, song_id=song.id, position=i))
        db.delete(item)
        db.commit()
        # Other sessions: gained a playlist, inbox lost an item.
        publish([current_user.id], {"type": "playlists", "origin": origin})
        publish([current_user.id], {"type": "inbox", "origin": origin})
        return {"playlistId": pl.id}

    elif item.kind == "playlist-invite":
        # Join the existing shared playlist live as a collaborator.
        pl = db.get(Playlist, item.playlist_id) if item.playlist_id else None
        if not pl:
            db.delete(item)
            db.commit()
            raise HTTPException(404, "Playlist no longer exists")
        already = db.query(PlaylistCollaborator).filter(
            PlaylistCollaborator.playlist_id == pl.id,
            PlaylistCollaborator.user_id == current_user.id,
        ).first()
        if not already:
            db.add(PlaylistCollaborator(playlist_id=pl.id, user_id=current_user.id))
        pl.shared = True
        db.delete(item)
        db.commit()
        # Existing members see the new collaborator appear; the joiner's other
        # sessions gain the playlist (origin tab already added it locally).
        publish([c.user_id for c in pl.collaborators], {"type": "playlists", "origin": origin})
        publish([current_user.id], {"type": "inbox", "origin": origin})
        return {"playlistId": pl.id}

    raise HTTPException(400, "Unknown inbox item kind")


@router.post("/{item_id}/replace", status_code=200)
def replace_with_incoming(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    origin: Optional[str] = Depends(get_client_id),
):
    """Replace a song with the incoming snapshot."""
    item = db.get(InboxItem, item_id)
    if not item or item.to_user_id != current_user.id or item.kind != "song":
        raise HTTPException(404, "Item not found")
    if not item.match_song_id:
        raise HTTPException(400, "No matching song to replace")

    song = db.get(Song, item.match_song_id)
    if not song or song.owner_id != current_user.id:
        raise HTTPException(404, "Song not found")

    snap = json.loads(item.song_snapshot or "{}")

    song.key = snap.get("key", "C")
    song.capo = snap.get("capo", 0)
    song.tempo = snap.get("tempo", 90)
    song.body = snap.get("body", "")

    song.updated_at = _now()
    db.delete(item)
    db.commit()
    # Other sessions: the song changed, inbox lost an item.
    publish([current_user.id], {"type": "song", "id": song.id, "origin": origin})
    publish([current_user.id], {"type": "inbox", "origin": origin})
    return {"songId": song.id}


@router.post("/share-song", status_code=201)
def share_song(
    body: ShareSongRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.get(Song, body.song_id)
    if not song or song.owner_id != current_user.id:
        raise HTTPException(404, "Song not found")

    snap = {
        "title": song.title,
        "artist": song.artist,
        "key": song.key,
        "capo": song.capo,
        "tempo": song.tempo,
        "body": song.body,
        "tags": [t.tag for t in song.tags],
    }

    created = []
    for uid in body.user_ids:
        recipient = db.get(User, uid)
        if not recipient or recipient.id == current_user.id:
            continue
        existing = db.query(Song).filter(
            Song.owner_id == uid, Song.title == song.title, Song.artist == song.artist
        ).first()
        item = InboxItem(
            from_user_id=current_user.id,
            to_user_id=uid,
            kind="song",
            song_snapshot=json.dumps(snap),
            match_song_id=existing.id if existing else None,
            note=body.note,
        )
        db.add(item)
        created.append(uid)

    db.commit()
    publish(created, {"type": "inbox"})
    return {"shared_to": created}


@router.post("/share-playlist", status_code=201)
def share_playlist(
    body: SharePlaylistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pl = db.get(Playlist, body.playlist_id)
    if not pl or pl.owner_id != current_user.id:
        raise HTTPException(404, "Playlist not found")

    shared_mode = body.mode == "shared"

    # For a "copy" share, snapshot every song so it's a self-contained
    # point-in-time copy. A "shared" (collaborate) invite needs no snapshot —
    # accepting joins the live playlist.
    songs_snap = []
    if not shared_mode:
        for entry in pl.entries:
            s = entry.song or db.get(Song, entry.song_id)
            if not s:
                continue
            songs_snap.append({
                "title": s.title,
                "artist": s.artist,
                "key": s.key,
                "capo": s.capo,
                "tempo": s.tempo,
                "body": s.body,
                "tags": [t.tag for t in s.tags],
            })

    created = []
    for uid in body.user_ids:
        recipient = db.get(User, uid)
        if not recipient or recipient.id == current_user.id:
            continue
        if shared_mode:
            # Skip people who are already collaborators.
            if any(c.user_id == uid for c in pl.collaborators):
                continue
            item = InboxItem(
                from_user_id=current_user.id,
                to_user_id=uid,
                kind="playlist-invite",
                playlist_name=pl.name,
                playlist_id=pl.id,
                song_count=len(pl.entries),
                note=body.note,
            )
        else:
            item = InboxItem(
                from_user_id=current_user.id,
                to_user_id=uid,
                kind="playlist",
                playlist_name=pl.name,
                playlist_snapshot=json.dumps(songs_snap),
                song_count=len(songs_snap),
                note=body.note,
            )
        db.add(item)
        created.append(uid)

    db.commit()
    publish(created, {"type": "inbox"})
    return {"shared_to": created}
