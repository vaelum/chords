"""Headless-browser page fetching via Playwright.

Used by the import flow to render JS-heavy chord sites into plain text
before handing the content to the model (see agent.py / llm.py).

Browser behaviour is configurable via env vars:
  CHORDS_BROWSER_CHANNEL   "chrome" (default) uses the system Chrome install,
                           which is far less likely to trip bot checks than
                           the bundled Chromium. Set to "" to force Chromium.
  CHORDS_BROWSER_HEADLESS  "1" (default) / "0" — old headless is heavily
                           fingerprinted; run headful where you can.
  CHORDS_BROWSER_PROFILE_DIR
                           Persistent profile dir (default <DATA_DIR>/browser-profile)
                           so anti-bot clearance cookies survive
                           between requests and restarts.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from typing import Optional

from playwright.async_api import BrowserContext, async_playwright

from .database import DATA_DIR

logger = logging.getLogger("chords.browser")

# --------------------------------------------------------------------------- #
# Browser lifetime and concurrency
# --------------------------------------------------------------------------- #
# The context used to be launched once and never closed, so one import kept a
# Chromium process tree resident for the life of the worker — measured at ~250MB
# still held a month after the last import. Nothing bounded concurrency either:
# every simultaneous import opened another tab, and Chromium spawns a renderer
# process per tab, on a box whose 2 vCPUs are shared with other services.
#
# Two bounds fix that. The idle reaper closes the context when nothing has used
# it for a while (the floor); the semaphore caps simultaneous pages (the
# ceiling). Closing costs a ~1-2s relaunch on the next import, which is noise
# against the 6-30s a fetch already spends on networkidle and challenge waits —
# and the profile is on disk, so anti-bot clearance cookies survive.
_MAX_PAGES = max(1, int(os.environ.get("CHORDS_BROWSER_MAX_PAGES", "2")))
_IDLE_TIMEOUT = float(os.environ.get("CHORDS_BROWSER_IDLE_TIMEOUT", "600"))

_context: Optional[BrowserContext] = None
_lock = asyncio.Lock()
_pw = None
_sem = asyncio.Semaphore(_MAX_PAGES)
_active = 0                              # tabs currently open
_last_used = 0.0                         # monotonic time the last tab closed
_reaper: Optional[asyncio.Task] = None

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

_CHANNEL = os.environ.get("CHORDS_BROWSER_CHANNEL", "chrome")
_HEADLESS = os.environ.get("CHORDS_BROWSER_HEADLESS", "1") not in ("0", "false", "False", "no")
# Deliberately NOT under DATA_DIR. The deploy backup zips the whole data
# directory, and this is a disposable Chromium cache that was making every
# backup roughly four times larger (11MB -> 47MB). A restore loses accumulated
# anti-bot clearance cookies, which simply regenerate.
_PROFILE_DIR = (os.environ.get("CHORDS_BROWSER_PROFILE_DIR")
                or os.path.join(os.path.dirname(DATA_DIR.rstrip("/")) or "/",
                                "chords-browser-profile"))

_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    # Hide the most obvious "I'm automated" tell.
    "--disable-blink-features=AutomationControlled",
]

# Markers that indicate a bot / "are you human" interstitial rather than the
# real page (common anti-bot interstitials and their variants).
_CHALLENGE_TEXT_MARKERS = (
    "performing security verification",
    "checking your browser before accessing",
    "just a moment",
    "attention required",
    "needs to review the security of your connection",
    "enable javascript and cookies to continue",
    "verify you are human",
    "verifying you are human",
)
_CHALLENGE_HTML_MARKERS = (
    "cf-browser-verification",
    "challenge-platform",
    "/cdn-cgi/challenge-platform",
    "__cf_chl",
)


def looks_like_bot_challenge(text: str = "", title: str = "", html: str = "") -> bool:
    """Heuristic: does this look like an anti-bot interstitial?"""
    blob = f"{title}\n{(text or '')[:3000]}".lower()
    if any(m in blob for m in _CHALLENGE_TEXT_MARKERS):
        return True
    h = (html or "")[:8000].lower()
    if any(m in h for m in _CHALLENGE_HTML_MARKERS):
        return True
    return False


async def _launch_context() -> BrowserContext:
    """Launch a persistent context, preferring system Chrome and falling back
    to bundled Chromium if that channel isn't available."""
    global _pw
    if _pw is None:
        _pw = await async_playwright().start()

    common = dict(
        user_data_dir=_PROFILE_DIR,
        headless=_HEADLESS,
        args=_LAUNCH_ARGS,
        user_agent=_UA,
        viewport={"width": 1280, "height": 1600},
        locale="en-US",
        timezone_id="America/New_York",
        extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
    )

    last_err = None
    for channel in ([_CHANNEL] if _CHANNEL else []) + [None]:
        try:
            ctx = await _pw.chromium.launch_persistent_context(channel=channel, **common)
            break
        except Exception as e:  # channel not installed, etc. — try the next option
            last_err = e
            ctx = None
    if ctx is None:
        raise RuntimeError(f"Could not launch browser: {last_err}")

    # Mask the webdriver flag for contexts that still expose it.
    await ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
    )
    return ctx


async def _get_context() -> BrowserContext:
    """Lazily launch a single persistent browser context shared across requests."""
    global _context
    async with _lock:
        if _context is None or not _context.browser or not _context.browser.is_connected():
            _context = await _launch_context()
    return _context


async def _close_context() -> None:
    """Drop the browser process tree AND the Playwright driver.

    Closing only the context leaves the driver — a node process — resident,
    measured at ~129MB. Since the whole point is to give the memory back while
    idle, the driver goes too; `_launch_context` restarts it on demand.
    """
    global _context, _pw
    async with _lock:
        ctx, _context = _context, None
        pw, _pw = _pw, None
    if ctx is not None:
        try:
            await ctx.close()
            logger.info("browser context closed after %.0fs idle", _IDLE_TIMEOUT)
        except Exception:
            logger.debug("closing the browser context failed", exc_info=True)
    if pw is not None:
        try:
            await pw.stop()
            logger.info("playwright driver stopped")
        except Exception:
            logger.debug("stopping the playwright driver failed", exc_info=True)


async def _idle_reaper() -> None:
    """Close the context once nothing has used it for _IDLE_TIMEOUT."""
    # A tenth of the deadline, clamped: never busier than every second, never
    # lazier than every 30s. The floor also keeps this testable with a short
    # timeout; the cost of a check is one comparison.
    interval = min(30.0, max(1.0, _IDLE_TIMEOUT / 10))
    while True:
        await asyncio.sleep(interval)
        # Never reap with tabs open: _active is the authority, not the clock.
        if _context is None or _active > 0:
            continue
        if time.monotonic() - _last_used >= _IDLE_TIMEOUT:
            await _close_context()


def _ensure_reaper() -> None:
    global _reaper
    if _IDLE_TIMEOUT > 0 and (_reaper is None or _reaper.done()):
        _reaper = asyncio.create_task(_idle_reaper())


def busy() -> bool:
    """True when every browser slot is taken, so the next fetch will queue.

    Used by the import streams to tell the user they are waiting rather than
    letting the request look like a hang.
    """
    return _active >= _MAX_PAGES


@contextlib.asynccontextmanager
async def _page_slot():
    """One open tab, bounded by the semaphore and guaranteed to be closed.

    The close is shielded on purpose. Callers wrap these fetches in
    `asyncio.wait_for`, so on timeout the task is cancelled — and a plain
    `await page.close()` inside a finally can itself be cancelled at that
    point, leaking the tab and, far worse, the semaphore slot it holds. Enough
    leaked slots and imports deadlock permanently. Shielding lets the close
    finish in the background while the cancellation propagates normally.
    """
    global _active, _last_used
    async with _sem:
        ctx = await _get_context()
        _ensure_reaper()
        page = await ctx.new_page()
        _active += 1
        try:
            yield page
        finally:
            _active -= 1
            _last_used = time.monotonic()
            try:
                await asyncio.shield(asyncio.wait_for(page.close(), timeout=15))
            except Exception:
                logger.debug("page close failed", exc_info=True)


async def _goto(page, url: str, timeout_ms: int) -> None:
    """Navigate and let JS settle. Raises on navigation failure."""
    await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    try:
        await page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass


async def _read_text(page) -> str:
    try:
        return await page.evaluate("document.body ? document.body.innerText : ''") or ""
    except Exception:
        return ""


async def _await_challenge_clear(page, attempts: int = 4, every_ms: int = 3000) -> str:
    """If the page is showing a bot interstitial, give it time to auto-clear
    (managed challenges resolve themselves once JS runs). Returns latest text."""
    text = await _read_text(page)
    if not looks_like_bot_challenge(text=text):
        return text
    # This loop is a common hidden time sink — log how long we spend waiting.
    t0 = time.perf_counter()
    logger.info("bot challenge detected — waiting up to %.1fs for it to clear",
                attempts * every_ms / 1000)
    for i in range(attempts):
        if not looks_like_bot_challenge(text=text):
            logger.info("challenge cleared after %d wait(s), %.2fs", i, time.perf_counter() - t0)
            return text
        await page.wait_for_timeout(every_ms)
        try:
            await page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        text = await _read_text(page)
    logger.info("challenge still present after %d attempts, %.2fs (giving up)",
                attempts, time.perf_counter() - t0)
    return text


async def fetch_rendered(url: str, timeout_ms: int = 30000) -> str:
    """Open `url` in a headless browser, return body.innerText after JS settles."""
    async with _page_slot() as page:
        await _goto(page, url, timeout_ms)
        return await _await_challenge_clear(page)


async def fetch_screenshot(url: str, timeout_ms: int = 30000) -> bytes:
    """Open `url` and return a PNG screenshot. Best-effort — captures whatever
    the browser rendered even if the page threw errors or loaded only partially."""
    async with _page_slot() as page:
        try:
            await _goto(page, url, timeout_ms)
        except Exception:
            pass  # capture whatever state the browser is in
        return await page.screenshot(full_page=False, type="png")


_LINKS_JS = """
    Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120)
    })).filter(l =>
        l.href &&
        l.text &&
        !l.href.startsWith('javascript:') &&
        !l.href.startsWith('mailto:')
    )
"""


async def fetch_rendered_full(url: str, timeout_ms: int = 30000) -> dict:
    """Open `url` and capture everything the browser saw — best effort.

    Unlike `fetch_rendered`, this never raises on a navigation error: it returns
    whatever the page rendered (even a partial / error / challenge page) so
    callers can show and offer it for download when an import fails. Returns a
    dict with keys: {text, html, title, url, links, loaded, challenge}.
    """
    loaded = True
    t0 = time.perf_counter()
    async with _page_slot() as page:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            logger.info("goto (domcontentloaded) %.2fs %s", time.perf_counter() - t0, url)
            t1 = time.perf_counter()
            try:
                await page.wait_for_load_state("networkidle", timeout=6000)
                logger.info("networkidle reached %.2fs", time.perf_counter() - t1)
            except Exception:
                logger.info("networkidle timed out after %.2fs", time.perf_counter() - t1)
        except Exception as e:
            loaded = False  # capture whatever the browser managed to render
            logger.info("goto failed after %.2fs: %s", time.perf_counter() - t0, type(e).__name__)

        text = await _await_challenge_clear(page)

        async def _safe(coro, default):
            try:
                return await coro
            except Exception:
                return default

        html = await _safe(page.content(), "") or ""
        title = await _safe(page.title(), "") or ""
        links = await _safe(page.evaluate(_LINKS_JS), []) or []
        final_url = page.url or url
        logger.info("fetch_rendered_full done %.2fs total (loaded=%s, %d chars, %d links) %s",
                    time.perf_counter() - t0, loaded, len(text), len(links), url)
        return {
            "text": text,
            "html": html,
            "title": title,
            "url": final_url,
            "links": links,
            "loaded": loaded,
            "challenge": looks_like_bot_challenge(text=text, title=title, html=html),
        }


async def fetch_rendered_with_links(url: str, timeout_ms: int = 30000) -> tuple[str, list[dict]]:
    """Open `url`, return (body.innerText, [{href, text}, …]) after JS settles."""
    async with _page_slot() as page:
        await _goto(page, url, timeout_ms)
        text = await _await_challenge_clear(page)
        try:
            links = await page.evaluate(_LINKS_JS)
        except Exception:
            links = []
        return text, links or []
