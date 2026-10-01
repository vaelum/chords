#!/usr/bin/env python3
"""A leader and a follower in two headless browsers, the follower's connection
cut and restored.

The other two session suites each model half of the system:
test_session_sync.py the server, session-sync.sim.js the follower's logic on a
fake network. This one runs the real thing end to end — the backend under
uvicorn, the built frontend, the leader driven through its own controls — and
breaks the one connection that matters, the follower's, in the ways it really
breaks:

  * `network drop` — the follower's connections are reset and new ones refused,
    as when a phone loses Wi-Fi. The client sees a network error and believes it
    was offline.
  * `server restart` — the event stream ends cleanly and every request answers
    502 for the outage, as when the server is redeployed behind Caddy. The
    client sees HTTP errors, and does not believe it was offline.

While the follower is cut off, the leader opens the next song, plays it, and
speeds up. Once the connection is back, the follower must show the leader's
song and be within TOLERANCE lines of it within a few seconds.

The follower talks to the backend through a small HTTP proxy in this process
(one request per connection, `Connection: close`), which is what lets a test
end an event stream cleanly, reset it, or answer 502 at a moment it chooses.
The leader talks to the backend directly.

Needs Playwright's Chromium (`playwright install chromium`). Slow — about two
minutes — so it runs under `python butler.py server test --e2e` only.

    python server/tests/test_session_e2e.py [scenario …]
"""

import asyncio
import os
import socket
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import use_temp_data_dir  # noqa: E402

use_temp_data_dir()  # before backend.database is imported

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from backend import models  # noqa: E402
from backend.auth import create_token  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.main import app  # noqa: E402
from backend.startup import init_db, init_secrets  # noqa: E402

# How far apart the two screens may be, in lines. The follower corrects beyond
# DRIFT_LINES (1.5); the rest is measuring two pages one after the other.
TOLERANCE = 2.0
# Stored scroll speed: 2.0 is "4.0x" on the bar, a line a second — fast enough
# that a lost update shows within the test's patience.
SPEED = 2.0
OUTAGE_S = 30
SETTLE_S = 3          # after the event stream is back, before the checks start
CHECK_S = 16          # how long the checks run
VIEWPORT = {"width": 800, "height": 900}

# The fractional line at the reading anchor, measured the way both views do.
LINE_JS = """() => {
  const sc = document.querySelector('.sv-scroll');
  const ct = sc && sc.querySelector('.sv-content');
  if (!ct || !ct.children.length) return null;
  const top = sc.getBoundingClientRect().top;
  const y = sc.scrollTop + sc.clientHeight * 0.35;
  let prev = null;
  for (let k = 0; k < ct.children.length; k++) {
    const t = ct.children[k].getBoundingClientRect().top - top + sc.scrollTop;
    if (t > y) return k === 0 ? 0 : (k - 1) + (y - prev) / (t - prev);
    prev = t;
  }
  return ct.children.length - 1;
}"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# --------------------------------------------------------------------------- #
# the backend
# --------------------------------------------------------------------------- #

class Backend:
    def __init__(self) -> None:
        init_db()
        init_secrets()
        self.port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        cfg = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        self.server = uvicorn.Server(cfg)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 20
        while not self.server.started:
            if time.time() > deadline:
                raise RuntimeError("uvicorn did not start")
            time.sleep(0.05)
        return self

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=10)


# --------------------------------------------------------------------------- #
# the follower's proxy
# --------------------------------------------------------------------------- #

class Proxy:
    """An HTTP/1.1 proxy that handles one request per connection.

    Modes, for new connections: `pass`, `refuse` (reset at once: a network
    error), `502` (answer Bad Gateway). `cut(how)` ends the event streams open
    now: `clean` finishes the chunked response properly, `reset` aborts it."""

    def __init__(self, upstream_port: int) -> None:
        self.upstream_port = upstream_port
        self.port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.mode = "pass"
        # relay task → how it is to end ("clean" or "reset"), set by cut()
        self.streams: dict[asyncio.Task, dict] = {}
        self.opened = 0       # event streams relayed so far
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        fut = asyncio.run_coroutine_threadsafe(
            asyncio.start_server(self._handle, "127.0.0.1", self.port), self.loop)
        self._server = fut.result(10)
        return self

    def __exit__(self, *exc):
        async def shutdown():
            self._server.close()
            tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        asyncio.run_coroutine_threadsafe(shutdown(), self.loop).result(10)
        self.loop.call_soon_threadsafe(self.loop.stop)

    def set_mode(self, mode: str) -> None:
        self.mode = mode

    def wait_for_stream(self, since: int, timeout: float = 30) -> None:
        """Until the follower has opened an event stream after `since` — its
        reconnect backs off up to 15 s, and the checks are about what happens
        once it is back, not about how soon it retries."""
        deadline = time.time() + timeout
        while self.opened <= since:
            if time.time() > deadline:
                raise TimeoutError("the follower did not reopen its event stream")
            time.sleep(0.2)

    def cut(self, how: str) -> None:
        asyncio.run_coroutine_threadsafe(self._cut(how), self.loop).result(10)

    async def _cut(self, how: str) -> None:
        # Only the relay is cancelled; the connection's handler finishes the
        # response. Cancelling the handler itself would let asyncio close the
        # connection before a clean ending could be written.
        for relay, end in list(self.streams.items()):
            end["how"] = how
            relay.cancel()

    async def _handle(self, reader, writer):
        if self.mode == "refuse":
            writer.transport.abort()
            return
        try:
            head = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, ConnectionError):
            writer.close()
            return
        if self.mode == "502":
            writer.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n"
                         b"Connection: close\r\n\r\n")
            await writer.drain()
            writer.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        request_line, headers = lines[0], [h for h in lines[1:] if h]
        length = 0
        kept = []
        for h in headers:
            name = h.split(":", 1)[0].strip().lower()
            if name == "content-length":
                length = int(h.split(":", 1)[1])
            if name in ("connection", "keep-alive"):
                continue
            kept.append(h)
        body = await reader.readexactly(length) if length else b""
        up_r, up_w = await asyncio.open_connection("127.0.0.1", self.upstream_port)
        up_w.write(("\r\n".join([request_line, *kept, "Connection: close"]) + "\r\n\r\n")
                   .encode("latin-1") + body)
        await up_w.drain()
        resp_head = await up_r.readuntil(b"\r\n\r\n")
        rlines = [h for h in resp_head.decode("latin-1").split("\r\n") if h]
        chunked = any(h.lower().startswith("transfer-encoding:") and "chunked" in h.lower()
                      for h in rlines)
        rkept = [h for h in rlines if h.split(":", 1)[0].strip().lower() not in ("connection", "keep-alive")]
        writer.write(("\r\n".join([*rkept, "Connection: close"]) + "\r\n\r\n").encode("latin-1"))
        await writer.drain()
        if chunked:
            self.opened += 1
            relay = asyncio.create_task(self._relay_chunks(up_r, writer))
            end = {"how": None}
            self.streams[relay] = end
            try:
                await relay
            except asyncio.CancelledError:
                if end["how"] is None:
                    raise
            finally:
                self.streams.pop(relay, None)
            if end["how"] == "clean":
                writer.write(b"0\r\n\r\n")
                try:
                    await writer.drain()
                except ConnectionError:
                    pass
            elif end["how"] == "reset":
                writer.transport.abort()
                up_w.close()
                return
        else:
            while data := await up_r.read(65536):
                writer.write(data)
                await writer.drain()
        writer.close()
        up_w.close()

    @staticmethod
    async def _relay_chunks(up_r, writer):
        """Chunk by chunk, each written whole, so a clean cut can follow any of
        them with the terminating chunk."""
        while True:
            size_line = await up_r.readuntil(b"\r\n")
            size = int(size_line.split(b";")[0], 16)
            data = await up_r.readexactly(size + 2)
            writer.write(size_line + data)
            await writer.drain()
            if size == 0:
                return


# --------------------------------------------------------------------------- #
# the data
# --------------------------------------------------------------------------- #

def _song_body(name: str) -> str:
    return "\n".join(f"[G]{name} line {i} [C]la la [D]la" for i in range(400))


def _setup_playlist(backend: Backend, tag: str) -> tuple[str, str]:
    """A user of its own and a playlist with two songs. Returns (token, name)."""
    db = SessionLocal()
    try:
        user = models.User(name=f"Lead {tag}", handle=f"lead{tag}", email=f"lead{tag}@example.test",
                           password_hash="x", color="av-1", initials="LD")
        db.add(user)
        db.commit()
        token = create_token(user.id)
    finally:
        db.close()
    h = {"Authorization": f"Bearer {token}"}
    name = f"Set {tag}"
    with httpx.Client(base_url=backend.url, headers=h) as api:
        pl = api.post("/api/playlists", json={"name": name}).raise_for_status().json()
        for title in ("Song A", "Song B"):
            api.post(f"/api/playlists/{pl['id']}/songs", json={"song": {
                "title": title, "artist": "Test", "body": _song_body(title),
                "scrollSpeed": SPEED, "tempo": 90,
            }}).raise_for_status()
    return token, name


# --------------------------------------------------------------------------- #
# the two devices
# --------------------------------------------------------------------------- #

def _device(browser, url: str, token: str):
    ctx = browser.new_context(viewport=VIEWPORT)
    ctx.add_init_script(
        f"try {{ localStorage.setItem('chords_token', {token!r});"
        f" localStorage.setItem('chords.scrollDensity', '0'); }} catch (e) {{}}")
    page = ctx.new_page()
    page.goto(url + "/")
    return ctx, page


def _open_playlist(page, name: str) -> None:
    page.get_by_role("button", name="Playlists").first.click()
    page.get_by_text(name, exact=True).first.click()


def _open_song(page, title: str) -> None:
    page.locator(".pl-song-row", has_text=title).first.click()
    page.locator(".sv-scroll .sv-content").first.wait_for()


def _play(page) -> None:
    page.get_by_role("button", name="Play autoscroll").click()


def _line(page):
    return page.evaluate(LINE_JS)


def _follower_title(page) -> str:
    return page.locator(".stage-title").first.inner_text()


def _check(leader, follower, song: str, seconds: float, errors: list, seen: list) -> None:
    end = time.time() + seconds
    while time.time() < end and len(errors) < 3:
        want, got = _line(leader), _line(follower)
        seen[:] = [want, got]
        title = _follower_title(follower)
        if title != song:
            errors.append(f"follower shows {title!r}, leader is on {song!r}")
        elif want is None or got is None:
            errors.append(f"no line to measure (leader {want}, follower {got})")
        elif abs(want - got) > TOLERANCE:
            errors.append(f"follower at line {got:.2f}, leader at {want:.2f}")
        time.sleep(1)


def _session(browser, backend, proxy, tag):
    token, name = _setup_playlist(backend, tag)
    lctx, leader = _device(browser, backend.url, token)
    _open_playlist(leader, name)
    leader.get_by_role("button", name="Start session").click()
    fctx, follower = _device(browser, proxy.url, token)
    _open_playlist(follower, name)
    follower.get_by_role("button", name="Follow your other device").click()
    _open_song(leader, "Song A")
    follower.locator(".stage-scroll .sv-content").wait_for()
    _play(leader)
    return lctx, leader, fctx, follower


# --------------------------------------------------------------------------- #
# scenarios
# --------------------------------------------------------------------------- #

def steady(browser, backend, proxy, tag, seen):
    """Nothing goes wrong: the baseline, and the check that the harness itself
    measures two agreeing screens as agreeing."""
    lctx, leader, fctx, follower = _session(browser, backend, proxy, tag)
    errors: list = []
    try:
        time.sleep(SETTLE_S + 4)
        _check(leader, follower, "Song A", CHECK_S, errors, seen)
    finally:
        lctx.close()
        fctx.close()
    return errors


def _outage(cut_how: str, mode: str):
    def scenario(browser, backend, proxy, tag, seen):
        lctx, leader, fctx, follower = _session(browser, backend, proxy, tag)
        errors: list = []
        try:
            time.sleep(8)
            proxy.set_mode(mode)
            proxy.cut(cut_how)
            # While the follower is cut off: the next song, played, then faster.
            leader.get_by_role("button", name="Stop autoscroll").click()
            leader.get_by_role("button", name="Back").first.click()
            _open_song(leader, "Song B")
            _play(leader)
            time.sleep(5)
            for _ in range(10):
                leader.get_by_role("button", name="Faster").click()
            time.sleep(max(0, OUTAGE_S - 8))
            before = proxy.opened
            proxy.set_mode("pass")
            proxy.wait_for_stream(before)
            time.sleep(SETTLE_S)
            _check(leader, follower, "Song B", CHECK_S, errors, seen)
        finally:
            proxy.set_mode("pass")
            lctx.close()
            fctx.close()
        return errors
    return scenario


SCENARIOS = {
    "steady": steady,
    "network drop": _outage("reset", "refuse"),
    "server restart": _outage("clean", "502"),
}


def run(names=None) -> int:
    names = names or list(SCENARIOS)
    failed = 0
    with Backend() as backend, Proxy(backend.port) as proxy, sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            for i, name in enumerate(names):
                started = time.time()
                seen: list = []
                try:
                    errors = SCENARIOS[name](browser, backend, proxy, f"{os.getpid()}x{i}", seen)
                except Exception as err:  # noqa: BLE001 - a broken scenario is a failure, not a crash
                    errors = [f"{type(err).__name__}: {err}"]
                took = time.time() - started
                if errors:
                    failed += 1
                    print(f"  FAIL  {name} ({took:.0f}s): {errors[0]}")
                else:
                    last = (f"; last seen: leader {seen[0]:.1f}, follower {seen[1]:.1f}"
                            if len(seen) == 2 and None not in seen else "")
                    print(f"  ok    {name} ({took:.0f}s{last})")
        finally:
            browser.close()
    print(f"session e2e: {len(names) - failed}/{len(names)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:] or None))
