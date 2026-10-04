"""The backend's calls to the fetcher, the container the headless browser runs in.

The fetcher app (backend/fetcher.py) is served in-process through an httpx
transport, and the browser behind it is stubbed: what is under test is the
round trip, and that the fetcher refuses what the backend would.

Runs standalone (`python tests/test_fetcher.py`) as well as under pytest, like
the other suites here.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import SERVER_DIR  # noqa: E402,F401  (path setup)

import httpx  # noqa: E402

from backend import fetcher, fetching, web_fetch  # noqa: E402

PAGE = {
    "text": "[G]So, so you think you can tell", "html": "<pre>…</pre>",
    "title": "Wish You Were Here", "url": "https://www.example.com/tabs/wywh",
    "links": [{"href": "https://www.example.com/", "text": "home"}],
    "loaded": True, "challenge": False,
}
OPENED: list[str] = []


async def _page(url, *a, **kw):
    OPENED.append(url)
    return {**PAGE, "url": url}


async def _hangs(url, *a, **kw):
    await asyncio.sleep(10)


async def _crashes(url, *a, **kw):
    raise RuntimeError("Target page, context or browser has been closed")


async def _refused(coro, expect: str) -> None:
    try:
        await coro
    except RuntimeError as e:
        assert expect in str(e), str(e)
    else:
        raise AssertionError(f"expected an error with {expect!r}")


async def run() -> None:
    fetching.FETCHER_URL = "http://chords-fetcher:8001"
    fetching._transport = httpx.ASGITransport(app=fetcher.app)

    web_fetch.fetch_rendered_full = _page
    got = await fetching.fetch_rendered_full("https://www.example.com/tabs/wywh")
    assert got == PAGE, got
    assert OPENED == ["https://www.example.com/tabs/wywh"], OPENED

    # The fetcher checks the scheme itself, whoever calls it.
    await _refused(fetching.fetch_rendered_full("file:///chords-data/secrets.json"),
                   "fetcher answered 400")
    assert OPENED == ["https://www.example.com/tabs/wywh"], OPENED

    web_fetch.fetch_rendered_full = _crashes
    await _refused(fetching.fetch_rendered_full("https://www.example.com/"),
                   "fetcher answered 502: RuntimeError: Target page")

    fetcher._DEADLINE = 0.2
    web_fetch.fetch_rendered_full = _hangs
    await _refused(fetching.fetch_rendered_full("https://www.example.com/"),
                   "fetcher answered 504")

    web_fetch.busy = lambda: True
    assert await fetching.browser_busy() is True
    web_fetch.busy = lambda: False
    assert await fetching.browser_busy() is False

    # A fetcher that cannot be reached is not "busy": that only words a progress line.
    def _down(request):
        raise httpx.ConnectError("connection refused")
    fetching._transport = httpx.MockTransport(_down)
    assert await fetching.browser_busy() is False

    print("fetcher: ok")


def test_fetcher():
    """pytest entry point."""
    asyncio.run(run())


if __name__ == "__main__":
    asyncio.run(run())
