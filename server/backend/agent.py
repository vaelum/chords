"""Import flow, backed by OpenRouter (see `llm.py` for model choices).

  - stream_search(query): uses OpenRouter's web-search server tool to find
    candidate chord/tab URLs.
  - stream_extract(url): uses Playwright (Python) to render the page, then hands
    the rendered text to the model to parse into chords format.
  - stream_auto_import / stream_scan_playlist: decide whether a page is a single
    song or a collection, and map a collection to its song links.
  - stream_extract_image / stream_extract_text / *_text variants: parse content
    the client supplies directly (uploaded image, pasted text, or a page the
    browser extension scraped past a bot check).

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

from .llm import LLMError, stream_completion
from .web_fetch import fetch_rendered_full

logger = logging.getLogger("chords.import")

_CHALLENGE_MSG = (
    "The site blocked the importer with a bot check. "
    "The easiest fix is the Chords Importer browser extension — it scrapes the "
    "page in your own browser (your session and cookies), so it usually sails "
    "straight past these checks. Otherwise, open the page in your browser, copy "
    "the chords, and use the “Text or image” tab to paste them — or try a "
    "different source."
)

# Cap the page text we pass to the model so we don't blow up the prompt.
_MAX_PAGE_CHARS = 60_000
_MAX_PLAYLIST_LINKS = 300
# Cap the raw HTML we ship back to the client for the "download loaded page"
# affordance shown on import failures.
_MAX_HTML_CHARS = 1_500_000

# Wall-clock budgets. Without these, a stalled LLM call (rate-limit backoff,
# network stall) or a hung headless-browser op leaves the NDJSON stream open
# forever and the client spinner never resolves — the "hangs during parsing"
# failure mode, especially in playlist imports that run many parses in a row.
_LLM_TIMEOUT = 90.0       # one model run: a single parse / page-type detection
_SEARCH_TIMEOUT = 150.0   # web search runs several searches before answering
_FETCH_TIMEOUT = 60.0     # headless render (goto + networkidle + challenge wait)

_SYSTEM = (
    "You parse guitar chord/tab content. "
    "Reply ONLY with the JSON object the user asked for. "
    "No prose, no explanation, before or after it."
)


# --- Response schemas --------------------------------------------------------
# Sent as strict `response_format` json_schema so the model can't wander off
# format. Strict mode requires every property to be listed in `required` and
# `additionalProperties: false`, so "unknown" is expressed as an empty string
# rather than null or an omitted key — which is what the clients already treat
# as absent.

_SONG_PROPERTIES = {
    "title": {"type": "string", "description": "Song title, or empty if unknown"},
    "artist": {"type": "string", "description": "Artist name, or empty if unknown"},
    "key": {"type": "string", "description": "Musical key such as G or Am; C if unknown"},
    "capo": {"type": "integer", "description": "Capo fret 0-11; 0 if none"},
    "tempo": {"type": "integer", "description": "Tempo in BPM; 90 if unknown"},
    "tags": {"type": "array", "items": {"type": "string"},
             "description": "Style tags, e.g. acoustic, worship"},
    "body": {"type": "string",
             "description": "Song body in chords format; empty if the source has no chart"},
}
_SONG_KEYS = list(_SONG_PROPERTIES)

_SONG_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": _SONG_PROPERTIES,
    "required": _SONG_KEYS,
}

_PLAYLIST_ITEM = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "artist": {"type": "string", "description": "Artist, or empty if unknown"},
        "url": {"type": "string", "description": "Verbatim href from the links list"},
    },
    "required": ["title", "artist", "url"],
}

_PLAYLIST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"songs": {"type": "array", "items": _PLAYLIST_ITEM}},
    "required": ["songs"],
}

# Auto-detect returns one of two shapes. Strict mode has no unions, so both
# branches share one object: `kind` selects which half is meaningful and the
# other half comes back empty.
_AUTO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "kind": {"type": "string", "enum": ["playlist", "song"]},
        "songs": {"type": "array", "items": _PLAYLIST_ITEM,
                  "description": "Playlist entries; empty when kind is song"},
        **_SONG_PROPERTIES,
    },
    "required": ["kind", "songs", *_SONG_KEYS],
}

_CANDIDATES_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "artist": {"type": "string"},
                    "source": {"type": "string", "description": "Short label, e.g. the site name"},
                    "url": {"type": "string", "description": "Direct URL to the chord page"},
                    "key": {"type": "string", "description": "Detected key, or empty if unknown"},
                    "snippet": {"type": "string",
                                "description": "One-line description, e.g. 'Acoustic, capo 2'"},
                },
                "required": ["title", "artist", "source", "url", "key", "snippet"],
            },
        }
    },
    "required": ["candidates"],
}


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


def _extract_json(text: str) -> Any:
    """Pull JSON out of the model's reply.

    Structured outputs mean this is normally just `json.loads`, but a provider
    that ignored the schema (or a fallback run without one) may still wrap the
    JSON in a fenced block or add a stray sentence — so stay tolerant."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    obj_or_arr = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if obj_or_arr:
        return json.loads(obj_or_arr.group(1))
    raise ValueError(f"No JSON in model response. First 400 chars: {text[:400]!r}")


def _song_fields(data: dict) -> dict:
    """Just the song half of a response, with sane fallbacks for a model that
    left a field blank."""
    return {
        "title": data.get("title") or "",
        "artist": data.get("artist") or "",
        "key": data.get("key") or "C",
        "capo": data.get("capo") or 0,
        "tempo": data.get("tempo") or 90,
        "tags": data.get("tags") or [],
        "body": data.get("body") or "",
    }


async def _run(
    prompt: str,
    *,
    role: str,
    system: str = _SYSTEM,
    schema: dict | None = None,
    image_b64: str = "",
    media_type: str = "image/png",
    web: bool = False,
    timeout: float = _LLM_TIMEOUT,
) -> AsyncIterator[dict]:
    """Run one model call, yielding progress events and one '_parsed' event with
    the JSON it returned.

    `timeout` is an overall wall-clock budget. Without it a stalled request would
    hang the NDJSON stream (and the client) forever instead of failing the import
    cleanly."""
    try:
        async with asyncio.timeout(timeout):
            text = ""
            async for evt in stream_completion(
                prompt,
                role_name=role,
                system=system,
                schema=schema,
                image_b64=image_b64,
                media_type=media_type,
                web=web,
                timeout=timeout,
            ):
                if evt["type"] == "_text":
                    text = evt["text"]
                else:
                    yield evt
        yield {"type": "_parsed", "data": _extract_json(text)}
    except TimeoutError:
        logger.warning("model call timed out after %.0fs", timeout)
        yield {
            "type": "error",
            "message": (
                f"Parsing timed out after {int(timeout)}s — the source may be slow "
                "or rate-limited. Try again, or paste the chords in the Text tab."
            ),
        }
    except LLMError as e:
        logger.error("model call failed: %s", e)
        yield {"type": "error", "message": str(e)}
    except Exception as e:
        logger.exception("model call failed")
        yield {"type": "error", "message": f"{type(e).__name__}: {e}"}


# --- Search ----------------------------------------------------------------

# The web plugin uses the user message verbatim as its search query, so the user
# message stays a bare query and every instruction lives in the system prompt.
_SEARCH_SYSTEM = """\
You are given web search results for a guitar chord / tab query. Pick out the \
pages that are actual chord or tab charts for the song and describe them.

Reply ONLY with a JSON object — no prose before or after it:
{"candidates": [...]}

Each candidate:
{
  "title": "<song title>",
  "artist": "<artist>",
  "source": "<short label e.g. the site name>",
  "url": "<direct URL to the chord page>",
  "key": "<detected key like G or Am, or an empty string>",
  "snippet": "<one-line description, e.g. 'Acoustic, capo 2'>"
}

Rules:
- Every url MUST be one of the URLs in the search results — never invent or
  construct one.
- List up to 8 different versions / sources; fewer if the results don't have
  that many. Prefer guitar chord and tab sites.
- JavaScript-heavy sites are fine — we render pages with a headless browser.
- Skip search pages, artist overviews, videos and forum threads.
- Return an empty candidates list if the results contain no chord pages."""


async def stream_search(query_text: str) -> AsyncIterator[dict]:
    yield {"type": "progress", "message": f"Searching for “{query_text}”…"}
    async for evt in _run(
        f"{query_text} guitar chords tab",
        role="search",
        system=_SEARCH_SYSTEM,
        schema=_CANDIDATES_SCHEMA,
        web=True,
        timeout=_SEARCH_TIMEOUT,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            candidates = data.get("candidates") if isinstance(data, dict) else data
            if not isinstance(candidates, list):
                yield {"type": "error", "message": "The model did not return a candidate list"}
                return
            yield {"type": "progress", "message": f"Found {len(candidates)} versions"}
            yield {"type": "result", "data": {"candidates": candidates}}
        else:
            yield evt


# --- Extract ---------------------------------------------------------------

_EXTRACT_PROMPT = """\
Below is the rendered text content of a guitar chord/tab page. Parse it into a song.

Source URL: {url}

--- PAGE CONTENT START ---
{text}
--- PAGE CONTENT END ---

Return a JSON object:
{{
  "title": "<song title>",
  "artist": "<artist name>",
  "key": "<key like G or Am, default C>",
  "capo": <0-11>,
  "tempo": <BPM int, default 90>,
  "tags": ["<style tag>", ...],
  "body": "<song body in chords format, see below>"
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

Return a JSON object with EVERY field below. Set "kind" to whichever the page
is, fill in that half, and leave the other half empty ("songs": [] for a single
song; empty strings / 0 / [] for the song fields on a playlist).

{{
  "kind": "playlist" | "song",
  "songs": [
    {{"title": "<song title>", "artist": "<artist or empty string>", "url": "<verbatim href from LINKS>"}}
  ],
  "title": "<song title>",
  "artist": "<artist name>",
  "key": "<key e.g. G or Am, default C>",
  "capo": <0–11>,
  "tempo": <BPM int, default 90>,
  "tags": ["<style tag>"],
  "body": "<full song body in chords format — see below>"
}}

Rules for a playlist:
- Only include songs that have a direct link in the LINKS section — the url must
  appear verbatim there.
- Exclude navigation, login, ads, and generic category/artist overview links.
- Return an empty songs list if no individual song links are found.

CHORDS BODY FORMAT (single song only):
  - {{Section}} on its own line for verse/chorus/bridge labels.
  - [Chord] in square brackets immediately before the syllable it lands on:
      [G]Won-der how [D]long can a [Em]min-ute real-ly [C]take
  - Blank line between sections.
  - If the page has chords on one line and lyrics directly below (monospace
    alignment), merge them: place each [Chord] before the syllable beneath it.
  - If the page has no chord content, return body="" and tags=[]."""


async def _emit_auto(data: dict, cap: dict | None = None) -> AsyncIterator[dict]:
    """Turn an auto-detect response into client events. `cap` (the captured page)
    is attached to errors when the page came from our own headless browser."""
    page = {"page": _page_payload(cap)} if cap else {}
    kind = data.get("kind")
    if kind == "playlist":
        songs = data.get("songs") or []
        yield {"type": "progress", "message": f"Playlist detected — {len(songs)} songs found"}
        yield {"type": "result", "data": {"kind": "playlist", "songs": songs}}
    elif kind == "song":
        song = _song_fields(data)
        if not song["body"].strip():
            yield {"type": "error", "message": "No chords or lyrics were found on the page.", **page}
        else:
            yield {"type": "progress", "message": "Single song detected — extracted chords"}
            yield {"type": "result", "data": {"kind": "song", **song}}
    else:
        yield {"type": "error", "message": "Could not determine page type", **page}


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

    async for evt in _run(
        _AUTO_DETECT_PROMPT.format(
            url=url,
            text=page_text,
            links=links_text,
            link_count=len(links),
        ),
        role="parse",
        schema=_AUTO_SCHEMA,
    ):
        if evt["type"] == "_parsed":
            async for out in _emit_auto(evt["data"], cap):
                yield out
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

Return a JSON object: {{"songs": [...]}}, where each element is:
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
- If no song links can be found, return an empty songs list."""


async def _emit_songs(evt: dict) -> AsyncIterator[dict]:
    """Shared handling of a `{"songs": [...]}` response."""
    data = evt["data"]
    songs = data.get("songs") if isinstance(data, dict) else data
    if not isinstance(songs, list):
        yield {"type": "error", "message": "The model did not return a song list"}
        return
    yield {"type": "progress", "message": f"Found {len(songs)} songs"}
    yield {"type": "result", "data": {"songs": songs}}


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
        "message": f"Got {len(text)} chars, {len(links)} links; identifying songs",
    }

    async for evt in _run(
        _PLAYLIST_SCAN_PROMPT.format(
            url=url,
            text=page_text,
            links=links_text,
            link_count=len(links),
        ),
        role="scan",
        schema=_PLAYLIST_SCHEMA,
    ):
        if evt["type"] == "_parsed":
            async for out in _emit_songs(evt):
                yield out
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

    async for evt in _run(
        _PLAYLIST_SCAN_PROMPT.format(
            url=source_url or "(scraped page)",
            text=page_text,
            links=links_text,
            link_count=len(capped_links),
        ),
        role="scan",
        schema=_PLAYLIST_SCHEMA,
    ):
        if evt["type"] == "_parsed":
            async for out in _emit_songs(evt):
                yield out
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

    async for evt in _run(
        _AUTO_DETECT_PROMPT.format(
            url=source_url or "(scraped page)",
            text=page_text,
            links=links_text,
            link_count=len(capped_links),
        ),
        role="parse",
        schema=_AUTO_SCHEMA,
    ):
        if evt["type"] == "_parsed":
            async for out in _emit_auto(evt["data"]):
                yield out
        else:
            yield evt


async def stream_extract(url: str) -> AsyncIterator[dict]:
    yield {"type": "progress", "message": "Opening headless browser…"}
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
        yield {"type": "progress", "message": f"Got {len(text)} chars; parsing the chords"}

    async for evt in _run(
        _EXTRACT_PROMPT.format(url=url, text=text), role="parse", schema=_SONG_SCHEMA
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "The model did not return a song object",
                       "page": _page_payload(cap)}
                return
            song = _song_fields(data)
            if not song["body"].strip():
                yield {
                    "type": "error",
                    "message": "No chords or lyrics were found on the page.",
                    "page": _page_payload(cap),
                }
                return
            yield {"type": "result", "data": song}
        else:
            yield evt


_IMAGE_PROMPT = """\
The attached image is a photo or screenshot of a guitar chord sheet / tab. \
Read the chords and lyrics from it and parse them into a song.

Return a JSON object:
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
    """Parse chords from an uploaded image (a photo/screenshot of a chord sheet)
    using a vision model — no browser fetch."""
    if not image_b64:
        yield {"type": "error", "message": "No image was provided."}
        return
    if media_type not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
        media_type = "image/png"
    yield {"type": "progress", "message": "Loading the image…"}
    yield {"type": "progress", "message": "Reading the chords from the image…"}

    async for evt in _run(
        _IMAGE_PROMPT,
        role="vision",
        schema=_SONG_SCHEMA,
        image_b64=image_b64,
        media_type=media_type,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "The model did not return a song object"}
                return
            song = _song_fields(data)
            if not song["body"].strip():
                yield {"type": "error", "message": "No chords or lyrics could be read from the image."}
                return
            yield {"type": "result", "data": song}
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
    yield {"type": "progress", "message": "Finding the chords, key and sections…"}

    async for evt in _run(
        _EXTRACT_PROMPT.format(url=source_url or "(pasted text)", text=text),
        role="parse",
        schema=_SONG_SCHEMA,
    ):
        if evt["type"] == "_parsed":
            data = evt["data"]
            if not isinstance(data, dict):
                yield {"type": "error", "message": "The model did not return a song object"}
                return
            song = _song_fields(data)
            if not song["body"].strip():
                yield {"type": "error", "message": "No chords or lyrics were found in the pasted text."}
                return
            yield {"type": "result", "data": song}
        else:
            yield evt
