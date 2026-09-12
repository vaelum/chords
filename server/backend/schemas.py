from __future__ import annotations
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, field_validator, field_serializer
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )


def _ms(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    return int(dt.timestamp() * 1000)


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class UserOut(_Base):
    id: str
    name: str
    handle: str
    email: str
    color: str
    initials: str
    is_admin: bool
    created_at: datetime

    @field_serializer("created_at")
    def _created_at(self, v: datetime) -> int:
        return _ms(v)


class UserCreate(_Base):
    name: str
    handle: str
    email: str
    password: str
    color: str = "av-1"
    initials: str = "??"


class UserUpdate(_Base):
    name: Optional[str] = None
    handle: Optional[str] = None
    email: Optional[str] = None
    color: Optional[str] = None
    initials: Optional[str] = None


class PasswordChange(_Base):
    current_password: str
    new_password: str


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class LoginRequest(_Base):
    handle: str   # handle or email
    password: str


class TokenResponse(_Base):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------
# NB: email is a plain str (not EmailStr) because email-validator isn't a
# project dependency — matches UserOut/UserCreate which also use str.

class InviteCreate(_Base):
    email: Optional[str] = None          # optional: locks the invite to this email
    expires_in_days: Optional[int] = 7   # 0 / None = never time-expires


class InviteOut(_Base):
    id: str
    token: str
    url: str
    email: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    used_at: Optional[datetime] = None
    used_by_handle: Optional[str] = None
    status: str  # "active" | "used" | "expired"

    @field_serializer("created_at", "expires_at", "used_at")
    def _ts(self, v: datetime | None) -> int | None:
        return _ms(v)


class InviteInfo(_Base):
    """Public view returned when someone opens an invite link."""
    valid: bool
    email: Optional[str] = None
    reason: Optional[str] = None


class AcceptInviteRequest(_Base):
    name: str
    handle: str
    password: str
    email: Optional[str] = None
    color: Optional[str] = None


# ---------------------------------------------------------------------------
# Song
# ---------------------------------------------------------------------------

class SongCreate(_Base):
    title: str
    artist: str = "Unknown"
    key: str = "C"
    capo: int = 0
    tempo: int = 90
    body: str = ""
    scroll_speed: float = 1.0
    tags: List[str] = []


class SongUpdate(_Base):
    title: Optional[str] = None
    artist: Optional[str] = None
    key: Optional[str] = None
    capo: Optional[int] = None
    tempo: Optional[int] = None
    body: Optional[str] = None
    scroll_speed: Optional[float] = None
    tags: Optional[List[str]] = None


class SongOut(_Base):
    id: str
    title: str
    artist: str
    owner_id: str
    key: str
    capo: int
    tempo: int
    body: str
    scroll_speed: float = 1.0
    playlist_id: Optional[str]
    updated_at: datetime
    tags: List[str] = []

    @field_validator("tags", mode="before")
    @classmethod
    def _coerce_tags(cls, v: Any) -> List[str]:
        if isinstance(v, list):
            return [
                item.tag if hasattr(item, "tag") else item
                for item in v
            ]
        return v

    @field_serializer("updated_at")
    def _updated_at(self, v: datetime) -> int:
        return _ms(v)


# ---------------------------------------------------------------------------
# Playlist
# ---------------------------------------------------------------------------

class PlaylistCreate(_Base):
    name: str
    gradient: str = "gradient-1"


class PlaylistUpdate(_Base):
    name: Optional[str] = None
    gradient: Optional[str] = None


class PlaylistEntryOut(_Base):
    song_id: str
    position: int = 0
    song: Optional[SongOut] = None   # the playlist-owned copy of this song


class PlaylistOut(_Base):
    id: str
    name: str
    gradient: str
    owner_id: str
    shared: bool
    public_token: Optional[str] = None   # read-only share link token; null = disabled
    updated_at: datetime
    collaborators: List[str] = []
    entries: List[PlaylistEntryOut] = []

    @field_validator("collaborators", mode="before")
    @classmethod
    def _coerce_collabs(cls, v: Any) -> List[str]:
        if isinstance(v, list):
            return [
                item.user_id if hasattr(item, "user_id") else item
                for item in v
            ]
        return v

    @field_serializer("updated_at")
    def _updated_at(self, v: datetime) -> int:
        return _ms(v)


# --- Public (read-only share link) view -------------------------------------
# Trimmed shapes returned by the unauthenticated /public endpoints — no owner,
# collaborator, or ownership ids are exposed.

class PublicSongOut(_Base):
    id: str
    title: str
    artist: str
    key: str
    capo: int
    tempo: int
    body: str
    scroll_speed: float = 1.0
    tags: List[str] = []

    @field_validator("tags", mode="before")
    @classmethod
    def _coerce_tags(cls, v: Any) -> List[str]:
        if isinstance(v, list):
            return [item.tag if hasattr(item, "tag") else item for item in v]
        return v


class PublicPlaylistOut(_Base):
    name: str
    gradient: str
    songs: List[PublicSongOut] = []


class AddToPlaylistRequest(_Base):
    # Playlists always own a hard copy of each song. Provide exactly one of:
    song_id: Optional[str] = None      # copy an existing owned song into the playlist
    song: Optional[SongCreate] = None  # OR create a brand-new playlist-owned song from this payload


class CollaboratorsUpdate(_Base):
    user_ids: List[str]


class ReorderPlaylistRequest(_Base):
    song_ids: List[str]   # song ids in the desired order


# ---------------------------------------------------------------------------
# Import / export — self-contained JSON files
# ---------------------------------------------------------------------------

class PortableSong(_Base):
    """A song as it travels in an export file (no ids, no ownership)."""
    title: str
    artist: str = "Unknown"
    key: str = "C"
    capo: int = 0
    tempo: int = 90
    body: str = ""
    scroll_speed: float = 1.0
    tags: List[str] = []


class PortablePlaylist(_Base):
    name: str
    gradient: str = "gradient-1"


class TransferBundle(_Base):
    """The shape of an exported (and importable) .json file."""
    format: str = "chords-export"
    version: int = 1
    kind: str                                   # "songs" | "playlist"
    exported_at: Optional[int] = None           # epoch ms, set on export
    playlist: Optional[PortablePlaylist] = None  # present when kind == "playlist"
    songs: List[PortableSong] = []


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------

class InboxItemOut(_Base):
    id: str
    from_user_id: str
    to_user_id: str
    kind: str
    song_snapshot: Optional[Any] = None   # parsed JSON
    playlist_name: Optional[str] = None
    song_count: Optional[int] = None
    match_song_id: Optional[str] = None
    unread: bool
    note: Optional[str] = None
    created_at: datetime

    @field_validator("song_snapshot", mode="before")
    @classmethod
    def _parse_snapshot(cls, v: Any) -> Any:
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except Exception:
                return v
        return v

    @field_serializer("created_at")
    def _created_at(self, v: datetime) -> int:
        return _ms(v)


class ShareSongRequest(_Base):
    song_id: str
    user_ids: List[str]
    note: Optional[str] = None


class SharePlaylistRequest(_Base):
    playlist_id: str
    user_ids: List[str]
    note: Optional[str] = None
    mode: str = "copy"   # 'copy' (send a copy) | 'shared' (invite to collaborate)
