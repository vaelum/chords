"""What a signed-in account can make the server's headless browser open.

The import routes take a URL and the server renders it in Chromium. Only
http(s) is fetched: a `file://` URL would read the server's own files
(secrets.json among them), and `data:`, `ftp://`, `chrome://` and the like have
no business in a chord import either.

The browser is stubbed: what is under test is which URLs get as far as it.

Runs standalone (`python tests/test_import_urls.py`) as well as under pytest,
like the other suites here.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import use_temp_data_dir  # noqa: E402

use_temp_data_dir()  # before backend.database is imported

from fastapi.testclient import TestClient  # noqa: E402

from backend import agent, models  # noqa: E402
from backend.auth import create_token  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.main import app  # noqa: E402
from backend.startup import init_db, init_secrets  # noqa: E402

# Every route that hands the submitted URL to the browser.
FETCH_ROUTES = ("/api/import/extract", "/api/import/playlist-scan", "/api/import/auto")

REFUSED = (
    "file:///chords-data/secrets.json",
    "FILE:///etc/passwd",
    "data:text/html,<h1>hi</h1>",
    "ftp://example.com/song.txt",
    "chrome://version",
    "javascript:alert(1)",
    "view-source:https://example.com/",
    "//example.com/no-scheme",
    "example.com/no-scheme",
    "http://",
    "",
)

FETCHED: list[str] = []


async def _fake_fetch(url, *a, **kw):
    FETCHED.append(url)
    # Enough for the stream to end with an error event, without a model call.
    raise RuntimeError("stub browser")


def _token() -> str:
    db = SessionLocal()
    try:
        user = models.User(
            name="Amos", handle="amos", email="amos@example.test",
            password_hash="x", color="av-1", initials="AM",
        )
        db.add(user)
        db.commit()
        return create_token(user.id)
    finally:
        db.close()


def run() -> None:
    init_db()
    init_secrets()
    agent.fetch_rendered_full = _fake_fetch
    api = TestClient(app)
    auth = {"Authorization": f"Bearer {_token()}"}

    for route in FETCH_ROUTES:
        for url in REFUSED:
            r = api.post(route, json={"url": url}, headers=auth)
            assert r.status_code == 400, (route, url, r.status_code, r.text[:200])
            assert r.json()["detail"].startswith("Can't import that URL"), r.json()
    assert FETCHED == [], f"a refused URL reached the browser: {FETCHED}"

    for route in FETCH_ROUTES:
        url = "https://www.example.com/tabs/song"
        r = api.post(route, json={"url": f"  {url} "}, headers=auth)
        assert r.status_code == 200, (route, r.status_code, r.text[:200])
    assert FETCHED == ["https://www.example.com/tabs/song"] * len(FETCH_ROUTES), FETCHED

    # The screenshot route was a second way in, and nothing used it. A POST to
    # a path no route serves falls through to the frontend's static mount,
    # which answers 405; the route itself answered 200 with a PNG.
    r = api.post("/api/import/screenshot", json={"url": "https://www.example.com/"}, headers=auth)
    assert r.status_code == 405, (r.status_code, r.text[:200])

    print(f"import urls: ok ({len(REFUSED)} schemes refused on {len(FETCH_ROUTES)} routes)")


def test_import_urls():
    """pytest entry point."""
    run()


if __name__ == "__main__":
    run()
