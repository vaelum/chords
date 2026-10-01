"""Session sync under a connection that drops, delays and reorders.

`test_sessions.py` checks who may drive a session. This suite checks that what a
follower is told is enough to end up exactly where the leader is, when some of
it arrives late, out of order, or not at all. It drives the REST API the way the
leader's client does and records every event the server publishes, so a test can
choose the interleaving a flaky network would produce.

The contract it holds the server to (planning: p-129695, "full-tick"):

  * every change to a session bumps `version`, ticks included, so a follower can
    throw away anything older than what it holds;
  * a tick names the song it was measured on and carries the leader's speed,
    and the server refuses one for a song that is no longer current;
  * the leader numbers its writes (`seq`), and a write older than one the server
    has already applied is refused (412) rather than rolling the session back;
  * the `session-tick` event carries the whole position: song, version, speed,
    line, playing, and the line's age;
  * the snapshot carries `age`, the seconds since its line was measured, so a
    follower joining mid-song does not start behind;
  * a session that expires is announced, so followers leave it.

Runs standalone (`python tests/test_session_sync.py`) as well as under pytest.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import use_temp_data_dir  # noqa: E402

use_temp_data_dir()  # before backend.database is imported

from fastapi.testclient import TestClient  # noqa: E402

from backend import events, models, session_state  # noqa: E402
from backend.auth import create_token  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.main import app  # noqa: E402
from backend.routers import sessions as sessions_router  # noqa: E402
from backend.startup import init_db, init_secrets  # noqa: E402


def _song(n: int) -> dict:
    return {"id": f"song-{n}", "title": f"Song {n}", "artist": "", "key": "G",
            "capo": 0, "tempo": 90, "body": f"[G]song {n}"}


class _Clock:
    """Stands in for `time` inside session_state, so ages and expiry are exact."""

    def __init__(self) -> None:
        self.now = 1_000_000.0

    def time(self) -> float:
        return self.now


class _Recorder:
    """Every event the sessions router publishes, in publish order."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def __call__(self, user_ids, event: dict) -> None:
        self.events.append(dict(event))

    def of(self, kind: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == kind]


class _Rig:
    """A leader device and a follower device on one account, one playlist, and a
    running session."""

    def __init__(self) -> None:
        session_state.clear_all()
        init_db()
        init_secrets()
        self.api = TestClient(app)
        self.clock = _Clock()
        self.rec = _Recorder()
        self._saved = (session_state.time, sessions_router.publish)
        session_state.time = self.clock
        sessions_router.publish = self.rec
        token = self._user()
        self.leader = {"Authorization": f"Bearer {token}", "X-Client-Id": "leader"}
        self.follower = {"Authorization": f"Bearer {token}", "X-Client-Id": "follower"}
        self.pl = self.api.post("/api/playlists", json={"name": "Set"}, headers=self.leader).json()["id"]
        self.base = f"/api/playlists/{self.pl}/session"
        assert self.api.post(self.base, json={}, headers=self.leader).status_code == 200
        self.seq = 0

    def close(self) -> None:
        session_state.time, sessions_router.publish = self._saved
        session_state.clear_all()

    _n = 0

    def _user(self) -> str:
        _Rig._n += 1
        handle = f"sync{_Rig._n}"
        db = SessionLocal()
        try:
            user = models.User(name=handle, handle=handle, email=f"{handle}@example.test",
                               password_hash="x", color="av-1", initials="SY")
            db.add(user)
            db.commit()
            return create_token(user.id)
        finally:
            db.close()

    def next_seq(self) -> int:
        self.seq += 1
        return self.seq

    def open(self, song: dict, *, line=0.0, speed=1.0, playing=False, seq=None):
        return self.api.put(f"{self.base}/now", headers=self.leader, json={
            "song": song, "line": line, "speed": speed, "playing": playing,
            "seq": self.next_seq() if seq is None else seq})

    def tick(self, song_id: str, line: float, *, speed=1.0, playing=True, seq=None):
        return self.api.post(f"{self.base}/tick", headers=self.leader, json={
            "songId": song_id, "line": line, "speed": speed, "playing": playing,
            "seq": self.next_seq() if seq is None else seq})

    def snapshot(self) -> dict:
        r = self.api.get(self.base, headers=self.follower)
        assert r.status_code == 200, r.text
        return r.json()


def _with_rig(fn):
    def run():
        rig = _Rig()
        try:
            fn(rig)
        finally:
            rig.close()
    run.__name__ = fn.__name__
    return run


# --------------------------------------------------------------------------- #
# the leader's writes, arriving in the wrong order
# --------------------------------------------------------------------------- #

@_with_rig
def test_tick_for_the_previous_song_is_refused(rig: _Rig):
    """The 10 s beacon measured on song 1 lands after song 2's PUT (the PUT is
    debounced, the tick is not). It must not move song 2's line."""
    rig.open(_song(1), playing=True)
    stale_seq = rig.next_seq()               # the tick was numbered first...
    assert rig.open(_song(2), playing=True).status_code == 200
    late = rig.tick("song-1", 40.0, seq=stale_seq)   # ...and arrived last
    # 412, not 409: 409 tells a leader it lost control and should re-fetch.
    assert late.status_code == 412, late.text
    now = rig.snapshot()["now"]
    assert now["song"]["id"] == "song-2"
    assert now["line"] == 0.0, now


@_with_rig
def test_older_write_does_not_roll_back_a_newer_one(rig: _Rig):
    """Two beacons for the same song, delivered by the threadpool out of order."""
    rig.open(_song(1), playing=True)
    first, second = rig.next_seq(), rig.next_seq()
    assert rig.tick("song-1", 12.0, seq=second).status_code == 200
    assert rig.tick("song-1", 10.0, seq=first).status_code == 412
    assert rig.snapshot()["now"]["line"] == 12.0


@_with_rig
def test_every_change_bumps_the_version(rig: _Rig):
    """A follower orders a GET against a tick by version; a tick that left the
    version alone would be indistinguishable from the snapshot before it."""
    rig.open(_song(1), playing=True)
    before = rig.snapshot()["version"]
    rig.tick("song-1", 5.0)
    assert rig.snapshot()["version"] > before


# --------------------------------------------------------------------------- #
# what a follower is told
# --------------------------------------------------------------------------- #

@_with_rig
def test_tick_event_carries_the_whole_position(rig: _Rig):
    rig.open(_song(1), playing=True, speed=1.0)
    rig.clock.now += 3
    rig.tick("song-1", 7.5, speed=1.5)
    evt = rig.rec.of("session-tick")[-1]
    snap = rig.snapshot()
    assert evt["songId"] == "song-1", evt
    assert evt["version"] == snap["version"], (evt, snap["version"])
    assert evt["speed"] == 1.5, evt
    assert evt["line"] == 7.5 and evt["playing"] is True, evt
    assert evt["age"] == 0, evt


@_with_rig
def test_speed_change_reaches_the_snapshot(rig: _Rig):
    """A follower that joins after the leader sped up must run at the new pace."""
    rig.open(_song(1), playing=True, speed=1.0)
    rig.tick("song-1", 4.0, speed=2.0)
    assert rig.snapshot()["now"]["speed"] == 2.0


@_with_rig
def test_snapshot_says_how_old_its_line_is(rig: _Rig):
    """Joining mid-song: the line was measured at the last beacon, up to 10 s
    ago. `age` is server time minus that moment, so no clock skew enters."""
    rig.open(_song(1), playing=True)
    rig.tick("song-1", 20.0)
    rig.clock.now += 8
    now = rig.snapshot()["now"]
    assert now["age"] == 8.0, now


# --------------------------------------------------------------------------- #
# a follower that was not listening
# --------------------------------------------------------------------------- #

@_with_rig
def test_a_missed_song_change_is_recovered_from_the_snapshot(rig: _Rig):
    """Events are not buffered for a device that is disconnected, so a follower
    that comes back has only the snapshot. It must hold everything the missed
    events said, with a version above anything the follower held before."""
    rig.open(_song(1), playing=True)
    held = rig.snapshot()
    missed_from = len(rig.rec.events)
    # --- the follower's connection is down from here ---
    rig.open(_song(2), playing=False, speed=1.25)
    rig.open(_song(2), playing=True, speed=1.25)
    rig.tick("song-2", 9.0, speed=1.5)
    missed = rig.rec.events[missed_from:]
    # --- and back ---
    snap = rig.snapshot()
    assert snap["version"] > held["version"]
    assert snap["now"]["song"]["id"] == "song-2"
    assert snap["now"]["speed"] == 1.5
    assert snap["now"]["line"] == 9.0
    last = missed[-1]
    assert last["type"] == "session-tick" and last.get("version") == snap["version"], last


def test_events_are_not_buffered_for_a_disconnected_device():
    """Why the follower must re-fetch on EVERY reconnect: whatever was published
    while it had no open stream is gone. The server's half of the bargain is the
    `hello` frame on reconnect; the client's is acting on it unconditionally."""

    async def scenario():
        async with events.subscribe("u-drop") as q:
            events.publish(["u-drop"], {"type": "session", "id": "pl"})
            await asyncio.sleep(0)
            assert (await asyncio.wait_for(q.get(), 1))["type"] == "session"
        events.publish(["u-drop"], {"type": "session", "id": "pl", "missed": True})
        async with events.subscribe("u-drop") as q:
            await asyncio.sleep(0)
            assert q.empty()

    asyncio.run(scenario())


# --------------------------------------------------------------------------- #
# a session that ends without anyone ending it
# --------------------------------------------------------------------------- #

@_with_rig
def test_expiry_is_announced(rig: _Rig):
    rig.open(_song(1), playing=False)
    before = len(rig.rec.of("session"))
    rig.clock.now += session_state.TTL_SECONDS + 1
    session_state.sweep_expired()
    announced = rig.rec.of("session")[before:]
    assert any(e.get("id") == rig.pl for e in announced), announced
    assert rig.api.get(rig.base, headers=rig.follower).status_code == 404


TESTS = [
    test_tick_for_the_previous_song_is_refused,
    test_older_write_does_not_roll_back_a_newer_one,
    test_every_change_bumps_the_version,
    test_tick_event_carries_the_whole_position,
    test_speed_change_reaches_the_snapshot,
    test_snapshot_says_how_old_its_line_is,
    test_a_missed_song_change_is_recovered_from_the_snapshot,
    test_events_are_not_buffered_for_a_disconnected_device,
    test_expiry_is_announced,
]


if __name__ == "__main__":
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  ok    {t.__name__}")
        except Exception as err:  # noqa: BLE001 - report every failure, then exit 1
            failed += 1
            print(f"  FAIL  {t.__name__}: {type(err).__name__}: {err}")
    print(f"session sync: {len(TESTS) - failed}/{len(TESTS)} passed")
    sys.exit(1 if failed else 0)
