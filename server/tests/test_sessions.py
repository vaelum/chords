"""The playlist-session endpoints, exercised through the API.

The rest of this repo's verification is a manual matrix on real devices, which
is right for the scrolling and the feel of it. Two things here are not worth
checking that way, because they are about *identity* rather than appearance and
reproducing them by hand means juggling three logged-in devices:

  * control belongs to a device, not to an account — your phone is a follower of
    your own laptop, and takes over by asking;
  * a session on a playlist you have shared with nobody still reaches you,
    because the fan-out is per connection.

Runs standalone (`python tests/test_sessions.py`) as well as under pytest, like
the other suites here.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import use_temp_data_dir  # noqa: E402

use_temp_data_dir()  # before backend.database is imported

from fastapi.testclient import TestClient  # noqa: E402

from backend import models, session_state  # noqa: E402
from backend.auth import create_token  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.main import app  # noqa: E402
from backend.startup import init_db, init_secrets  # noqa: E402

SONG = {
    "id": "song-1",
    "title": "Wish You Were Here",
    "artist": "Pink Floyd",
    "key": "G",
    "capo": 0,
    "tempo": 60,
    "body": "[G]So, so you think you can tell",
}


def _client():
    init_db()
    init_secrets()
    return TestClient(app)


def _user(handle: str) -> tuple[str, str]:
    """A user row and a token for it. Accounts are created by invite in the app,
    which is a lot of ceremony for a fixture."""
    db = SessionLocal()
    try:
        user = models.User(
            name=handle.title(), handle=handle, email=f"{handle}@example.test",
            password_hash="x", color="av-1", initials=handle[:2].upper(),
        )
        db.add(user)
        db.commit()
        return user.id, create_token(user.id)
    finally:
        db.close()


def _device(token: str, client_id: str) -> dict:
    """One device: the same account, its own client id."""
    return {"Authorization": f"Bearer {token}", "X-Client-Id": client_id}


def run() -> None:
    session_state.clear_all()
    api = _client()
    _uid, token = _user("amos")
    laptop = _device(token, "client-laptop")
    phone = _device(token, "client-phone")

    # A playlist shared with nobody — the your-own-devices case.
    pl = api.post("/api/playlists", json={"name": "Set list"}, headers=laptop).json()
    assert pl["shared"] is False, pl

    # Nothing running yet.
    assert api.get(f"/api/playlists/{pl['id']}/session", headers=phone).status_code == 404
    assert api.get("/api/sessions", headers=phone).json() == []

    # The laptop starts one.
    started = api.post(f"/api/playlists/{pl['id']}/session", json={}, headers=laptop)
    assert started.status_code == 200, started.text
    assert started.json()["controllerClientId"] == "client-laptop"
    assert started.json()["now"] is None

    # The phone finds it without being told which playlist — this is the call a
    # second device makes at load.
    found = api.get("/api/sessions", headers=phone).json()
    assert [s["playlistId"] for s in found] == [pl["id"]], found

    # ...and it is a follower, not a co-driver: same account, different device.
    clash = api.post(f"/api/playlists/{pl['id']}/session", json={}, headers=phone)
    assert clash.status_code == 409, clash.text

    # A song OPENED, not played, is what followers see. This is the whole point:
    # `playing` is false and the song is on screen anyway.
    opened = api.put(
        f"/api/playlists/{pl['id']}/session/now",
        json={"song": SONG, "line": 0, "speed": 1.0, "playing": False},
        headers=laptop,
    )
    assert opened.status_code == 200, opened.text
    seen = api.get(f"/api/playlists/{pl['id']}/session", headers=phone).json()
    assert seen["now"]["playing"] is False
    assert seen["now"]["song"]["title"] == SONG["title"]
    assert seen["now"]["song"]["body"] == SONG["body"]

    # Only the controlling device may drive.
    assert api.post(f"/api/playlists/{pl['id']}/session/tick",
                    json={"line": 4, "playing": True}, headers=phone).status_code == 409
    assert api.delete(f"/api/playlists/{pl['id']}/session", headers=phone).status_code == 409

    # Play, then the drift beacon.
    api.put(f"/api/playlists/{pl['id']}/session/now",
            json={"song": SONG, "line": 0, "speed": 1.5, "playing": True}, headers=laptop)
    ticked = api.post(f"/api/playlists/{pl['id']}/session/tick",
                      json={"line": 12.5, "playing": True}, headers=laptop)
    assert ticked.status_code == 200, ticked.text
    assert ticked.json()["now"]["line"] == 12.5
    assert ticked.json()["now"]["speed"] == 1.5

    # Take over from the phone: control moves, the song on screen does not, so
    # followers do not blink.
    took = api.post(f"/api/playlists/{pl['id']}/session",
                    json={"takeover": True}, headers=phone)
    assert took.status_code == 200, took.text
    assert took.json()["controllerClientId"] == "client-phone"
    assert took.json()["now"]["song"]["title"] == SONG["title"]
    # The laptop is now a follower and may no longer drive.
    assert api.post(f"/api/playlists/{pl['id']}/session/tick",
                    json={"line": 20, "playing": True}, headers=laptop).status_code == 409

    # A second start from the device that already controls is a no-op, not a
    # conflict — a double tap must not lock you out of your own session.
    again = api.post(f"/api/playlists/{pl['id']}/session", json={}, headers=phone)
    assert again.status_code == 200, again.text

    # Someone else's playlist is not visible, session or not.
    _other_uid, other_token = _user("stranger")
    stranger = _device(other_token, "client-stranger")
    assert api.get(f"/api/playlists/{pl['id']}/session", headers=stranger).status_code == 404
    assert api.get("/api/sessions", headers=stranger).json() == []

    # A snapshot is a song, not a file upload.
    huge = dict(SONG, body="x" * (session_state.MAX_SNAPSHOT_CHARS + 1))
    assert api.put(f"/api/playlists/{pl['id']}/session/now",
                   json={"song": huge, "line": 0, "speed": 1, "playing": False},
                   headers=phone).status_code == 409

    # Ending it is the controller's call, and leaves nothing behind.
    assert api.delete(f"/api/playlists/{pl['id']}/session", headers=phone).status_code == 200
    assert api.get(f"/api/playlists/{pl['id']}/session", headers=phone).status_code == 404
    assert api.get("/api/sessions", headers=laptop).json() == []

    # An expired session is gone without anyone ending it.
    api.post(f"/api/playlists/{pl['id']}/session", json={}, headers=laptop)
    state = session_state.get(pl["id"])
    state["last_seen"] -= session_state.TTL_SECONDS + 1
    assert api.get(f"/api/playlists/{pl['id']}/session", headers=laptop).status_code == 404


def test_sessions():
    run()


if __name__ == "__main__":
    run()
    print("sessions: ok")
