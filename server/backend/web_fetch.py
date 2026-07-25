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
import logging
import os
import time
from typing import Optional

from playwright.async_api import BrowserContext, async_playwright

from .database import DATA_DIR

logger = logging.getLogger("chords.browser")

_context: Optional[BrowserContext] = None
_lock = asyncio.Lock()
_pw = None

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

_CHANNEL = os.environ.get("CHORDS_BROWSER_CHANNEL", "chrome")
_HEADLESS = os.environ.get("CHORDS_BROWSER_HEADLESS", "1") not in ("0", "false", "False", "no")
_PROFILE_DIR = os.environ.get("CHORDS_BROWSER_PROFILE_DIR") or os.path.join(DATA_DIR, "browser-profile")

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


async def _open_page(url: str, timeout_ms: int = 30000):
    """Open `url` in a new page of the shared context after JS settles.
    The caller owns the returned page and must close it."""
    ctx = await _get_context()
    page = await ctx.new_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    try:
        await page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    return page


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
    page = await _open_page(url, timeout_ms)
    try:
        return await _await_challenge_clear(page)
    finally:
        await page.close()


async def fetch_screenshot(url: str, timeout_ms: int = 30000) -> bytes:
    """Open `url` and return a PNG screenshot. Best-effort — captures whatever
    the browser rendered even if the page threw errors or loaded only partially."""
    ctx = await _get_context()
    page = await ctx.new_page()
    try:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            try:
                await page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:
                pass
        except Exception:
            pass  # capture whatever state the browser is in
        return await page.screenshot(full_page=False, type="png")
    finally:
        await page.close()


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
    ctx = await _get_context()
    page = await ctx.new_page()
    loaded = True
    t0 = time.perf_counter()
    try:
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
    finally:
        await page.close()


async def fetch_rendered_with_links(url: str, timeout_ms: int = 30000) -> tuple[str, list[dict]]:
    """Open `url`, return (body.innerText, [{href, text}, …]) after JS settles."""
    page = await _open_page(url, timeout_ms)
    try:
        text = await _await_challenge_clear(page)
        try:
            links = await page.evaluate(_LINKS_JS)
        except Exception:
            links = []
        return text, links or []
    finally:
        await page.close()
