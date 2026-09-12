#!/usr/bin/env python3
"""Browser lifetime and concurrency tests for backend.web_fetch.

These cover the two bounds added to the headless-browser layer: the semaphore
that caps simultaneous tabs, and the guarantee that a tab is closed (and its
slot released) even when the caller's `asyncio.wait_for` cancels the fetch.

That last one is the important case. The import flows call every fetch through
`asyncio.wait_for(..., timeout=_FETCH_TIMEOUT)`, so a slow page is cancelled
mid-await. If the cleanup `await page.close()` is itself cancelled, the tab
leaks AND the semaphore slot leaks — and enough leaked slots deadlock imports
permanently, which is far worse than the original unbounded behaviour.

Playwright and the DB layer are stubbed: what is under test is the asyncio
lifetime logic, not Chromium. That also means this suite runs anywhere.

    python butler.py server test        # or: python server/tests/test_browser.py
"""

import asyncio
import os
import sys
import tempfile
import types

from conftest import SERVER_DIR  # noqa: F401  (path setup)

# Must be set before web_fetch is imported: it reads these at import time.
os.environ["CHORDS_BROWSER_MAX_PAGES"] = "2"
os.environ["CHORDS_BROWSER_IDLE_TIMEOUT"] = "1"

# --- stub the heavy imports --------------------------------------------------
_pw = types.ModuleType("playwright")
_pwa = types.ModuleType("playwright.async_api")


class BrowserContext:  # only used as a type annotation in web_fetch
    pass


_pwa.BrowserContext = BrowserContext
_pwa.async_playwright = lambda: None
sys.modules.setdefault("playwright", _pw)
sys.modules.setdefault("playwright.async_api", _pwa)

_db = types.ModuleType("backend.database")
_db.DATA_DIR = tempfile.mkdtemp(prefix="chords-browser-test-")
sys.modules.setdefault("backend.database", _db)

from backend import web_fetch  # noqa: E402

FAILURES: list[str] = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# --- fakes -------------------------------------------------------------------

class FakePage:
    def __init__(self):
        self.closed = False

    async def close(self):
        # Closing is not instantaneous; that delay is exactly what makes the
        # cancellation case interesting.
        await asyncio.sleep(0.05)
        self.closed = True


class FakeContext:
    def __init__(self):
        self.pages: list[FakePage] = []
        self.closed = False

    async def new_page(self):
        p = FakePage()
        self.pages.append(p)
        return p

    async def close(self):
        self.closed = True


async def run() -> int:
    ctx = FakeContext()

    async def fake_get_context():
        # The reaper inspects the module global, so the fake must set it too.
        web_fetch._context = ctx
        return ctx

    web_fetch._get_context = fake_get_context
    # No reaper for cases [1]-[5]: it would race the assertions. Case [6]
    # restores the real one and tests it directly.
    _real_ensure_reaper = web_fetch._ensure_reaper
    web_fetch._ensure_reaper = lambda: None

    print("\n[1] a normal fetch closes its tab and releases its slot")
    async with web_fetch._page_slot() as page:
        check("tab is open while in use", web_fetch._active == 1, web_fetch._active)
    await asyncio.sleep(0.15)
    check("tab closed on exit", page.closed)
    check("active count back to zero", web_fetch._active == 0, web_fetch._active)

    print("\n[2] a CANCELLED fetch still closes its tab and releases its slot")
    held: list[FakePage] = []

    async def hang():
        async with web_fetch._page_slot() as p:
            held.append(p)
            await asyncio.sleep(10)          # never completes

    try:
        await asyncio.wait_for(hang(), timeout=0.2)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass
    await asyncio.sleep(0.4)                 # let the shielded close finish
    check("tab was created", len(held) == 1, len(held))
    check("tab closed despite cancellation", held and held[0].closed)
    check("active count back to zero", web_fetch._active == 0, web_fetch._active)

    print("\n[2b] a SECOND cancellation during cleanup must not abort the close")
    # This is the case that actually discriminates. Under `wait_for` a single
    # cancellation is fine: the cancelled task is awaited to completion, so even
    # an unshielded close finishes. The tab only leaks if another cancellation
    # lands while the close is still in flight - which is what happens when a
    # whole task tree is torn down (client disconnect, shutdown).
    held2: list[FakePage] = []

    async def hang2():
        async with web_fetch._page_slot() as p:
            held2.append(p)
            await asyncio.sleep(10)

    t = asyncio.create_task(hang2())
    await asyncio.sleep(0.05)          # let it take a slot
    t.cancel()                         # first cancel -> enters the finally
    await asyncio.sleep(0.01)          # close() is now in flight
    t.cancel()                         # second cancel lands mid-cleanup
    try:
        await t
    except asyncio.CancelledError:
        pass
    await asyncio.sleep(0.4)
    check("tab closed despite a second cancellation", held2 and held2[0].closed)
    check("active count back to zero", web_fetch._active == 0, web_fetch._active)

    print("\n[3] the slot was not leaked - the bound is still fully available")
    acquired = []

    async def grab(i):
        async with web_fetch._page_slot():
            acquired.append(i)
            await asyncio.sleep(0.05)

    await asyncio.wait_for(asyncio.gather(*(grab(i) for i in range(2))), timeout=2.0)
    check("both slots still usable after a cancellation", len(acquired) == 2, len(acquired))

    print("\n[4] concurrency is bounded by CHORDS_BROWSER_MAX_PAGES")
    peak = 0

    async def worker():
        nonlocal peak
        async with web_fetch._page_slot():
            peak = max(peak, web_fetch._active)
            await asyncio.sleep(0.1)

    await asyncio.gather(*(worker() for _ in range(6)))
    check("never exceeded 2 concurrent tabs", peak <= 2, f"peak={peak}")
    check("all tabs closed afterwards", all(p.closed for p in ctx.pages),
          sum(1 for p in ctx.pages if not p.closed))

    print("\n[5] busy() reports saturation so callers can say 'queued'")
    gate = asyncio.Event()

    async def hold():
        async with web_fetch._page_slot():
            await gate.wait()

    holders = [asyncio.create_task(hold()) for _ in range(2)]
    await asyncio.sleep(0.1)
    check("busy() true when every slot is taken", web_fetch.busy() is True)
    gate.set()
    await asyncio.gather(*holders)
    await asyncio.sleep(0.15)
    check("busy() false once slots free up", web_fetch.busy() is False)

    print("\n[6] the idle reaper closes the context when nothing is using it")
    # This is the actual memory fix, so exercise the real reaper rather than the
    # stub used above. CHORDS_BROWSER_IDLE_TIMEOUT is 1s in this suite.
    web_fetch._ensure_reaper = _real_ensure_reaper
    ctx.closed = False
    web_fetch._context = ctx
    async with web_fetch._page_slot():
        pass
    await asyncio.sleep(0.2)
    check("context still open immediately after use", not ctx.closed)
    await asyncio.sleep(3.0)                  # idle 1s + check interval 1s + slack
    check("context closed once idle", ctx.closed)
    check("module global cleared", web_fetch._context is None, web_fetch._context)
    if web_fetch._reaper:
        web_fetch._reaper.cancel()

    print()
    if FAILURES:
        print(f"*** {len(FAILURES)} FAILED: " + "; ".join(FAILURES))
        return 1
    print("ALL BROWSER CHECKS PASSED")
    return 0


def test_browser():
    """pytest entry point."""
    assert asyncio.run(run()) == 0, FAILURES


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
