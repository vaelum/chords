"""Import flow.

  - stream_search(query): uses the Claude Code agent + its WebSearch tool to
    find candidate chord/tab URLs.
  - stream_extract(url): uses Playwright (Python) to render the page, then
    hands the rendered text to Claude (no tools) to parse into chords format.

Both stream NDJSON-friendly events:
  {"type": "progress", "message": "…"}
  {"type": "result",   "data": {…}}
  {"type": "error",    "message": "…"}
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, AsyncIterator

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    ToolUseBlock,
    query,
)

from .web_fetch import fetch_rendered_full, looks_like_bot_challenge

logger = logging.getLogger("chords.import")

_CHALLENGE_MSG = (
    "The site blocked the importer with a bot check. "
    "The easiest fix is the Chords Importer browser extension — it scrapes the "
    "page in your own browser (your session and cookies), so it usually sails "
    "straight past these checks. Otherwise, open the page in your browser, copy "
    "the chords, and use the “Text or image” tab to paste them — or try a "
    "different source."
)

# Cap the page text we pass to Claude so we don't blow up the prompt.
_MAX_PAGE_CHARS = 60_000
_MAX_PLAYLIST_LINKS = 300
# Cap the raw HTML we ship back to the client for the "download loaded page"
# affordance shown on import failures.
_MAX_HTML_CHARS = 1_500_000

# Wall-clock budgets. Without these, a stalled LLM call (rate-limit backoff,
# network stall) or a hung headless-browser op leaves the NDJSON stream open
# forever and the client spinner never resolves — the "hangs during parsing"
# failure mode, especially in playlist imports that run many parses in a row.
_AGENT_TIMEOUT = 90.0     # one LLM run: a single parse / page-type detection
_SEARCH_TIMEOUT = 150.0   # web search runs multiple turns + WebSearch calls
_FETCH_TIMEOUT = 60.0     # headless render (goto + networkidle + challenge wait)


def _page_payload(cap: dict) -> dict:
    """Build the `page` field attached to import errors so the client can show
    and download exactly what the headless browser saw."""
    return {
        "url": cap.get("url", ""),
        "title": cap.get("title", ""),
        "text": (cap.get("text") or "")[:_MAX_PAGE_CHARS],
        "html": (cap.get("html") or "")[:_MAX_HTML_CHARS],
        "loaded": cap.get("loaded", True),
    }


def _options(tools: list[str] | None = None, max_turns: int = 8) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        allowed_tools=tools or [],
        permission_mode="bypassPermissions",
        max_turns=max_turns,
        system_prompt=(
            "You parse guitar chord/tab content. "
            "Reply ONLY with the JSON the user asked for, inside a ```json fenced block. "
            "No prose before or after the JSON block."
        ),
    )


def _tool_progress(block: ToolUseBlock) -> str | None:
    name = block.name
    inp = block.input or {}
    if name == "WebSearch":
        return f"Searching the web: {inp.get('query', '')}"
    if name == "WebFetch":
        url = inp.get("url", "")
        if len(url) > 90:
            url = url[:87] + "…"
        return f"Fetching {url}"
    return None


def _extract_json(text: str) -> Any:
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    obj_or_arr = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if obj_or_arr:
        return json.loads(obj_or_arr.group(1))
    raise ValueError(f"No JSON in agent response. First 400 chars: {text[:400]!r}")


async def _stream_agent(
    prompt: str, options: ClaudeAgentOptions, timeout: float = _AGENT_TIMEOUT
) -> AsyncIterator[dict]:
    """Run the agent, yielding progress events and one '_parsed' event with
    the JSON pulled from the last text block.

    `timeout` is an overall wall-clock budget for the LLM run. Without it a
    stalled CLI subprocess would hang the NDJSON stream (and the client) forever
    instead of failing the import cleanly."""
    final_text = ""
    composing_announced = False
    try:
        async with asyncio.timeout(timeout):
            async for msg in query(prompt=prompt, options=options):
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, ToolUseBlock):
                            line = _tool_progress(block)
                            if line:
                                yield {"type": "progress", "message": line}
                        elif isinstance(block, TextBlock) and block.text.strip():
                            final_text = block.text
                            if not composing_announced:
                                yield {"type": "progress", "message": "Claude is writing out the result…"}
                                composing_announced = True
        if not final_text:
            raise RuntimeError("Agent returned no text")
        yield {"type": "_parsed", "data": _extract_json(final_text)}
    except TimeoutError:
        logger.warning("agent stream timed out after %.0fs", timeout)
        yield {
            "type": "error",
            "message": (
                f"Parsing timed out after {int(timeout)}s — the source may be slow "
                "or rate-limited. Try again, or paste the chords in the Text tab."
            ),
        }
    except Exception as e:
        logger.exception("agent stream failed")
        yield {"type": "error", "message": f"{type(e).__name__}: {e}"}


# --- Search ----------------------------------------------------------------

_SEARCH_PROMPT = """\
Use the WebSearch tool to find guitar chord / tab pages for: {query}

Find 4-8 different versions / sources from guitar chord and tab sites — \
we render pages with a headless browser, so JavaScript sites are fine.

Return ONLY a JSON array inside a ```json fenced block. Each item:
{{
  "title": "<song title>",
  "artist": "<artist>",
  "source": "<short label e.g. the site name>",
  "url": "<direct URL to the chord page>",
  "key": "<detected key like G or Am, or null>",
  "snippet": "<one-line description, e.g. 'Acoustic, capo 2'>"
}}

Do NOT open the pages with WebFetch — search results alone are enough."""


async def stream_search(query_text: str) -> AsyncIterator[dict]:
    yield {"type": "progress", "message": f"Searching for “{query_text}”…"}
    opts = _options(tools=["WebSearch"], max_turns=12)
    async for evt in _stream_agent(_SEARCH_PROMPT.format(query=query_text), opts, timeout=_SEARCH_TIMEOUT):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, list):
                yield {"type": "error", "message": "Agent did not return a JSON array"}
                return
            yield {"type": "progress", "message": f"Found {len(data)} versions"}
            yield {"type": "result", "data": {"candidates": data}}
        else:
            yield evt


# --- Extract ---------------------------------------------------------------

_EXTRACT_PROMPT = """\
Below is the rendered text content of a guitar chord/tab page. Parse it into a song.

Source URL: {url}

--- PAGE CONTENT START ---
{text}
--- PAGE CONTENT END ---

Return ONLY a JSON object inside a ```json fenced block:
{{
  "title": "<song title>",
  "artist": "<artist name>",
  "key": "<key like G or Am, default C>",
  "capo": <0-11>,
  "tempo": <BPM int, default 90>,
  "tags": ["<style tag>", ...],
  "body": "<song body in chords format, see below>",
}}

CHORDS BODY FORMAT:
  - Plain text, no HTML or markdown.
  - {{Section}} on its own line for verse/chorus/bridge labels. Examples:
      {{Verse 1}}
      {{Chorus}}
      {{Bridge}}
  - [Chord] in square brackets, placed IMMEDIATELY before the syllable it lands on:
      [G]Wonder how [D]long can a [Em]minute really [C]take
  - Blank line between sections.
  - If a line is chords-only (instrumental), still use [Chord] notation \
    (without lyric text after).

If the page content has chord names on one line and lyrics directly below \
(monospace alignment), combine them: place each chord in brackets before the \
syllable that sits beneath it in the source.

If the page doesn't actually contain a chord chart, return body="" and tags=[]."""


# --- Auto-detect: playlist or single song ------------------------------------

_AUTO_DETECT_PROMPT = """\
Below is the rendered text and anchor links of a web page. Your job is to decide
whether this is:
  (A) a PLAYLIST / COLLECTION — a page listing multiple different songs, each
      linking to its own chord/tab page, OR
  (B) a SINGLE SONG chord/tab page — showing chords and lyrics for one song.

Source URL: {url}

--- PAGE TEXT ---
{text}
--- END PAGE TEXT ---

--- ALL LINKS ON PAGE ({link_count} total) ---
{links}
--- END LINKS ---

Respond with ONLY a JSON object inside a ```json fenced block.

If PLAYLIST / COLLECTION:
{{
  "kind": "playlist",
  "songs": [
    {{"title": "<song title>", "artist": "<artist or empty string>", "url": "<verbatim href from LINKS>"}}
  ]
}}
Rules for playlist:
- Only include songs that have a direct link in the LINKS section — the url must
  appear verbatim there.
- Exclude navigation, login, ads, and generic category/artist overview links.
- Return an empty songs list if no individual song links are found.

If SINGLE SONG:
{{
  "kind": "song",
  "title": "<song title>",
  "artist": "<artist name>",
  "key": "<key e.g. G or Am, default C>",
  "capo": <0–11>,
  "tempo": <BPM int, default 90>,
  "tags": ["<style tag>"],
  "body": "<full song body in chords format — see below>",
}}

CHORDS BODY FORMAT (single song only):
  - {{Section}} on its own line for verse/chorus/bridge labels.
  - [Chord] in square brackets immediately before the syllable it lands on:
      [G]Won-der how [D]long can a [Em]min-ute real-ly [C]take
  - Blank line between sections.
  - If the page has chords on one line and lyrics directly below (monospace
    alignment), merge them: place each [Chord] before the syllable beneath it.
  - If the page has no chord content, return body="" and tags=[]."""


async def stream_auto_import(url: str) -> AsyncIterator[dict]:
    """Detect whether `url` is a playlist or a single song, then act accordingly.

    Events:
      progress → informational message
      result   → {"kind": "playlist", "songs": [...]} or {"kind": "song", ...song fields}
      error    → {"message": "..."}
    """
    yield {"type": "progress", "message": "Opening headless browser…"}
    try:
        yield {"type": "progress", "message": f"Loading {url}"}
        cap = await asyncio.wait_for(fetch_rendered_full(url), timeout=_FETCH_TIMEOUT)
    except Exception as e:
        logger.exception("page fetch failed")
        yield {"type": "error", "message": f"Could not load page: {e}"}
        return

    text = cap["text"]
    links = cap["links"]
    if cap.get("challenge"):
        yield {"type": "error", "message": _CHALLENGE_MSG, "page": _page_payload(cap)}
        return
    if not text or len(text.strip()) < 20:
        yield {
            "type": "error",
            "message": "Page returned no readable content",
            "page": _page_payload(cap),
        }
        return

    page_text = text[:_MAX_PAGE_CHARS]
    capped_links = links[:_MAX_PLAYLIST_LINKS]
    links_text = "\n".join(f"{l['text']!r} → {l['href']}" for l in capped_links)
    yield {
        "type": "progress",
        "message": f"Got {len(text)} chars, {len(links)} links — detecting page type",
    }

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(
        _AUTO_DETECT_PROMPT.format(
            url=url,
            text=page_text,
            links=links_text,
            link_count=len(links),
        ),
        opts,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            kind = data.get("kind")
            if kind == "playlist":
                songs = data.get("songs") or []
                yield {"type": "progress", "message": f"Playlist detected — {len(songs)} songs found"}
                yield {"type": "result", "data": {"kind": "playlist", "songs": songs}}
            elif kind == "song":
                if not (data.get("body") or "").strip():
                    yield {"type": "error", "message": "No chords or lyrics were found on the page.", "page": _page_payload(cap)}
                else:
                    yield {"type": "progress", "message": "Single song detected — extracted chords"}
                    yield {"type": "result", "data": data}
            else:
                yield {"type": "error", "message": "Could not determine page type", "page": _page_payload(cap)}
        else:
            yield evt


# --- Playlist scan -----------------------------------------------------------

_PLAYLIST_SCAN_PROMPT = """\
Below is the text content and all anchor links from a webpage that may contain \
a playlist or collection of songs with chord / tab links.

Source URL: {url}

--- PAGE TEXT ---
{text}
--- END PAGE TEXT ---

--- LINKS FOUND ON PAGE ({link_count} total) ---
{links}
--- END LINKS ---

Your task: identify every song entry in this collection and map it to its link.

Return ONLY a JSON array inside a ```json fenced block. Each element:
{{
  "title": "<song title>",
  "artist": "<artist name, or empty string if unknown>",
  "url": "<the direct URL to this specific song's chord/tab page>"
}}

Rules:
- Only include real songs (exclude navigation, login, ads, generic category links).
- The url MUST appear verbatim in the LINKS section above — do not invent or \
  construct URLs.
- Prefer links that go directly to a single song page, not a search or artist overview.
- If no song links can be found, return an empty array []."""


async def stream_scan_playlist(url: str) -> AsyncIterator[dict]:
    yield {"type": "progress", "message": "Opening headless browser…"}
    try:
        yield {"type": "progress", "message": f"Loading {url}"}
        cap = await asyncio.wait_for(fetch_rendered_full(url), timeout=_FETCH_TIMEOUT)
    except Exception as e:
        logger.exception("page fetch failed")
        yield {"type": "error", "message": f"Could not load page: {e}"}
        return

    text = cap["text"]
    links = cap["links"]
    if cap.get("challenge"):
        yield {"type": "error", "message": _CHALLENGE_MSG, "page": _page_payload(cap)}
        return
    if not text or len(text.strip()) < 20:
        yield {
            "type": "error",
            "message": "Page returned no readable content",
            "page": _page_payload(cap),
        }
        return

    page_text = text[:_MAX_PAGE_CHARS]
    capped_links = links[:_MAX_PLAYLIST_LINKS]
    links_text = "\n".join(
        f"{l['text']!r} → {l['href']}"
        for l in capped_links
    )
    yield {
        "type": "progress",
        "message": f"Got {len(text)} chars, {len(links)} links; asking Claude to identify songs",
    }

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(
        _PLAYLIST_SCAN_PROMPT.format(
            url=url,
            text=page_text,
            links=links_text,
            link_count=len(links),
        ),
        opts,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, list):
                yield {"type": "error", "message": "Agent did not return a JSON array"}
                return
            yield {"type": "progress", "message": f"Found {len(data)} songs"}
            yield {"type": "result", "data": {"songs": data}}
        else:
            yield evt


async def stream_scan_text(
    text: str, links: list[dict] | None = None, source_url: str = ""
) -> AsyncIterator[dict]:
    """Identify playlist song links from page text + anchor links scraped on the
    client (e.g. by the browser extension) — no server-side fetch, so this gets
    past the bot check on the index page the same way the user's browser already did.

    Mirrors `stream_scan_playlist` but takes the page content directly instead of
    rendering the URL with Playwright."""
    text = (text or "").strip()
    links = links or []
    if len(text) < 20 and not links:
        yield {"type": "error", "message": "Not enough page content to scan."}
        return

    page_text = text[:_MAX_PAGE_CHARS]
    capped_links = links[:_MAX_PLAYLIST_LINKS]
    links_text = "\n".join(
        f"{(l.get('text') or '')!r} → {l.get('href') or ''}" for l in capped_links
    )
    yield {"type": "progress", "message": f"Scanning {len(capped_links)} links for songs…"}

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(
        _PLAYLIST_SCAN_PROMPT.format(
            url=source_url or "(scraped page)",
            text=page_text,
            links=links_text,
            link_count=len(capped_links),
        ),
        opts,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, list):
                yield {"type": "error", "message": "Agent did not return a JSON array"}
                return
            yield {"type": "progress", "message": f"Found {len(data)} songs"}
            yield {"type": "result", "data": {"songs": data}}
        else:
            yield evt


async def stream_auto_text(
    text: str, links: list[dict] | None = None, source_url: str = ""
) -> AsyncIterator[dict]:
    """Auto-detect playlist vs single song from page content scraped on the
    client (browser extension) — no server fetch, so it works past bot checks.

    Mirrors `stream_auto_import` but takes the rendered text + anchor links
    directly. Emits the same result shape:
      {"kind": "playlist", "songs": [...]} | {"kind": "song", ...song fields}
    """
    text = (text or "").strip()
    links = links or []
    if len(text) < 20 and not links:
        yield {"type": "error", "message": "Not enough page content to import."}
        return

    page_text = text[:_MAX_PAGE_CHARS]
    capped_links = links[:_MAX_PLAYLIST_LINKS]
    links_text = "\n".join(
        f"{(l.get('text') or '')!r} → {l.get('href') or ''}" for l in capped_links
    )
    yield {"type": "progress", "message": "Detecting page type…"}

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(
        _AUTO_DETECT_PROMPT.format(
            url=source_url or "(scraped page)",
            text=page_text,
            links=links_text,
            link_count=len(capped_links),
        ),
        opts,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            kind = data.get("kind")
            if kind == "playlist":
                songs = data.get("songs") or []
                yield {"type": "progress", "message": f"Playlist detected — {len(songs)} songs"}
                yield {"type": "result", "data": {"kind": "playlist", "songs": songs}}
            elif kind == "song":
                if not (data.get("body") or "").strip():
                    yield {"type": "error", "message": "No chords or lyrics were found on the page."}
                else:
                    yield {"type": "progress", "message": "Single song detected — extracted chords"}
                    yield {"type": "result", "data": data}
            else:
                yield {"type": "error", "message": "Could not determine page type"}
        else:
            yield evt


async def stream_extract(url: str) -> AsyncIterator[dict]:
    yield {"type": "progress", "message": f"Opening headless browser…"}
    try:
        yield {"type": "progress", "message": f"Loading {url}"}
        cap = await asyncio.wait_for(fetch_rendered_full(url), timeout=_FETCH_TIMEOUT)
    except Exception as e:
        logger.exception("page fetch failed")
        yield {"type": "error", "message": f"Could not load page: {e}"}
        return

    text = cap["text"]
    if cap.get("challenge"):
        yield {"type": "error", "message": _CHALLENGE_MSG, "page": _page_payload(cap)}
        return
    if not text or len(text.strip()) < 50:
        yield {
            "type": "error",
            "message": "Page returned no readable content",
            "page": _page_payload(cap),
        }
        return

    if len(text) > _MAX_PAGE_CHARS:
        text = text[:_MAX_PAGE_CHARS]
        yield {"type": "progress", "message": f"Page truncated to {_MAX_PAGE_CHARS} chars"}
    else:
        yield {"type": "progress", "message": f"Got {len(text)} chars; asking Claude to parse"}

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(_EXTRACT_PROMPT.format(url=url, text=text), opts):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "Agent did not return a JSON object", "page": _page_payload(cap)}
                return
            if not (data.get("body") or "").strip():
                yield {
                    "type": "error",
                    "message": "No chords or lyrics were found on the page.",
                    "page": _page_payload(cap),
                }
                return
            yield {"type": "result", "data": data}
        else:
            yield evt


_IMAGE_PROMPT = """\
The attached image is a photo or screenshot of a guitar chord sheet / tab. \
Read the chords and lyrics from it and parse them into a song.

Return ONLY a JSON object inside a ```json fenced block:
{
  "title": "<song title, or empty string if unknown>",
  "artist": "<artist name, or empty string if unknown>",
  "key": "<key like G or Am, default C>",
  "capo": <0-11>,
  "tempo": <BPM int, default 90>,
  "tags": [],
  "body": "<song body in chords format, see below>"
}

CHORDS BODY FORMAT:
  - Plain text, no HTML or markdown.
  - {Section} on its own line for verse/chorus/bridge labels.
  - [Chord] in square brackets immediately before the syllable it lands on:
      [G]Won-der how [D]long can a [Em]min-ute real-ly [C]take
  - Blank line between sections.
  - If chords are written on a line above the lyrics, merge them: place each
    [Chord] before the syllable beneath it.
  - If there are no chords/lyrics in the image, return body=""."""


async def stream_extract_image(image_b64: str, media_type: str = "image/png") -> AsyncIterator[dict]:
    """Parse chords from an uploaded image (a photo/screenshot of a chord
    sheet) using Claude's vision — no browser fetch."""
    if not image_b64:
        yield {"type": "error", "message": "No image was provided."}
        return
    if media_type not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
        media_type = "image/png"
    yield {"type": "progress", "message": "Loading the image…"}
    yield {"type": "progress", "message": "Claude is reading the chords from the image…"}

    # The SDK accepts an async iterable of input messages (streaming input
    # mode); that's how we attach an image content block alongside the prompt.
    async def _input():
        yield {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": _IMAGE_PROMPT},
                ],
            },
            "parent_tool_use_id": None,
            "session_id": "default",
        }

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(_input(), opts):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "Agent did not return a JSON object"}
                return
            if not (data.get("body") or "").strip():
                yield {"type": "error", "message": "No chords or lyrics could be read from the image."}
                return
            yield {"type": "result", "data": data}
        else:
            yield evt


async def stream_extract_text(text: str, source_url: str = "") -> AsyncIterator[dict]:
    """Parse chords from text the user pasted in by hand — no browser fetch.
    Useful when a site blocks the headless browser."""
    text = (text or "").strip()
    if len(text) < 20:
        yield {"type": "error", "message": "Please paste a bit more text to parse."}
        return
    if len(text) > _MAX_PAGE_CHARS:
        text = text[:_MAX_PAGE_CHARS]
    yield {"type": "progress", "message": "Reading the pasted text…"}
    yield {"type": "progress", "message": "Claude is finding the chords, key and sections…"}

    opts = _options(tools=[], max_turns=2)
    async for evt in _stream_agent(
        _EXTRACT_PROMPT.format(url=source_url or "(pasted text)", text=text), opts
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "Agent did not return a JSON object"}
                return
            if not (data.get("body") or "").strip():
                yield {"type": "error", "message": "No chords or lyrics were found in the pasted text."}
                return
            yield {"type": "result", "data": data}
        else:
            yield evt
