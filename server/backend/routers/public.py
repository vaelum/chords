"""Unauthenticated, read-only endpoints reached via a playlist's public share
link. Anyone with the token can view the playlist and its songs; nothing here
mutates, and no owner/collaborator identity is exposed."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Playlist
from ..schemas import PublicPlaylistOut, PublicSongOut

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/playlists/{token}", response_model=PublicPlaylistOut)
def get_public_playlist(token: str, db: Session = Depends(get_db)):
    pl = db.query(Playlist).filter(Playlist.public_token == token).first()
    if not pl:
        raise HTTPException(404, "This shared playlist link is not available.")
    songs = [PublicSongOut.model_validate(e.song) for e in pl.entries if e.song]
    return PublicPlaylistOut(name=pl.name, gradient=pl.gradient, songs=songs)
