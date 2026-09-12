import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Boolean, Text, DateTime, ForeignKey, Float,
)
from sqlalchemy.orm import relationship
from .database import Base


def _now():
    return datetime.now(timezone.utc)


def new_id():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=new_id)
    name = Column(String, nullable=False)
    handle = Column(String, nullable=False, unique=True)  # @handle, without @
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    color = Column(String, default="av-1")       # av-1 … av-8
    initials = Column(String, default="??")
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    songs = relationship("Song", back_populates="owner", foreign_keys="Song.owner_id")
    playlists_owned = relationship("Playlist", back_populates="owner")


class Song(Base):
    __tablename__ = "songs"

    id = Column(String, primary_key=True, default=new_id)
    title = Column(String, nullable=False)
    artist = Column(String, nullable=False, default="Unknown")
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    key = Column(String, nullable=False, default="C")
    capo = Column(Integer, default=0)
    tempo = Column(Integer, default=90)
    body = Column(Text, default="")
    scroll_speed = Column(Float, default=1.0)
    playlist_id = Column(String, ForeignKey("playlists.id"), nullable=True)
    
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    created_at = Column(DateTime(timezone=True), default=_now)

    owner = relationship("User", back_populates="songs", foreign_keys=[owner_id])
    tags = relationship("SongTag", back_populates="song", cascade="all, delete-orphan")
    playlist = relationship("Playlist", foreign_keys=[playlist_id])


class SongTag(Base):
    __tablename__ = "song_tags"

    song_id = Column(String, ForeignKey("songs.id"), primary_key=True)
    tag = Column(String, primary_key=True)

    song = relationship("Song", back_populates="tags")


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(String, primary_key=True, default=new_id)
    name = Column(String, nullable=False)
    gradient = Column(String, default="gradient-1")
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    shared = Column(Boolean, default=False)
    # Unguessable token for a read-only public share link; null = link disabled.
    public_token = Column(String, nullable=True, unique=True, index=True)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
    created_at = Column(DateTime(timezone=True), default=_now)

    owner = relationship("User", back_populates="playlists_owned")
    entries = relationship(
        "PlaylistEntry", back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="PlaylistEntry.position",
    )
    collaborators = relationship(
        "PlaylistCollaborator", back_populates="playlist",
        cascade="all, delete-orphan",
    )


class PlaylistCollaborator(Base):
    __tablename__ = "playlist_collaborators"

    playlist_id = Column(String, ForeignKey("playlists.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), primary_key=True)

    playlist = relationship("Playlist", back_populates="collaborators")
    user = relationship("User")


class PlaylistEntry(Base):
    __tablename__ = "playlist_entries"

    playlist_id = Column(String, ForeignKey("playlists.id"), primary_key=True)
    song_id = Column(String, ForeignKey("songs.id"), primary_key=True)
    position = Column(Integer, default=0)

    playlist = relationship("Playlist", back_populates="entries")
    song = relationship("Song")


class InboxItem(Base):
    __tablename__ = "inbox_items"

    id = Column(String, primary_key=True, default=new_id)
    from_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    to_user_id = Column(String, ForeignKey("users.id"), nullable=False)
    kind = Column(String, nullable=False)          # 'song' | 'playlist' | 'playlist-invite'
    song_snapshot = Column(Text, nullable=True)    # JSON blob (single song)
    playlist_name = Column(String, nullable=True)
    playlist_snapshot = Column(Text, nullable=True)  # JSON list of song blobs (copy share)
    playlist_id = Column(String, ForeignKey("playlists.id"), nullable=True)  # collaborate invite target
    song_count = Column(Integer, nullable=True)
    match_song_id = Column(String, nullable=True)  # existing song in recipient's library
    unread = Column(Boolean, default=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    from_user = relationship("User", foreign_keys=[from_user_id])
    to_user = relationship("User", foreign_keys=[to_user_id])


class Invite(Base):
    """A single-use invitation link that lets someone create an account."""
    __tablename__ = "invites"

    id = Column(String, primary_key=True, default=new_id)
    token = Column(String, nullable=False, unique=True, index=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    # Optional email the invite is addressed to (pre-fills the sign-up form).
    email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by = Column(String, ForeignKey("users.id"), nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
    redeemer = relationship("User", foreign_keys=[used_by])
