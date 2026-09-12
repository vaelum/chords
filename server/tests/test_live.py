#!/usr/bin/env python3
"""Live tests against the real OpenRouter API.

These spend real credit — about $0.01 for a full run, the web search being most
of it. They exist because the offline stub in test_pipeline.py cannot catch what
actually broke in production: OpenRouter accepting a request shape in principle
but rejecting it in practice (the `openrouter:web_search` server tool returns
`404 Server tool request failed` whenever a strict `response_format` is attached,
which no stub would have told us).

The API key is looked up in this order:
  1. $OPENROUTER_API_KEY
  2. <repo>/.secrets            — a bare key, or OPENROUTER_API_KEY=... lines
  3. ~/.chords/secrets.json
With no key, every test skips rather than fails.

    python butler.py server test --live
    python butler.py server test --live --only search,vision
    python server/tests/test_live.py --only parse
"""

import argparse
import asyncio
import base64
import json
import pathlib
import sys
import time

from conftest import find_api_key, use_temp_data_dir  # noqa: E402  (path setup)

FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"

# Real chord-sheet text, chords on their own line above the lyrics — the layout
# the parse role has to merge into inline [C] brackets.
CHORD_TEXT = """\
Country Roads - John Denver
Key of G, capo 2

[Verse 1]
G                     Em
Almost heaven, West Virginia
D                      C            G
Blue Ridge Mountains, Shenandoah River

[Chorus]
G               D              Em
Country roads, take me home
             C            G
To the place I belong
"""

PLAYLIST_TEXT = """\
Worship Set — Sunday Morning

1. Amazing Grace — John Newton
2. How Great Thou Art — Stuart Hine
3. Blessed Assurance — Fanny Crosby

Browse all songs · Log in · Contact us
"""

PLAYLIST_LINKS = [
    {"text": "Amazing Grace", "href": "https://example.com/song/amazing-grace"},
    {"text": "How Great Thou Art", "href": "https://example.com/song/how-great-thou-art"},
    {"text": "Blessed Assurance", "href": "https://example.com/song/blessed-assurance"},
    {"text": "Browse all songs", "href": "https://example.com/songs"},
    {"text": "Log in", "href": "https://example.com/login"},
]

FAILURES: list[str] = []
COSTS: list[float] = []


def check(name: str, cond, extra="") -> bool:
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        FAILURES.append(name)
        if extra:
            print(f"        {str(extra)[:400]}")
    return bool(cond)


async def collect(stream) -> list[dict]:
    return [e async for e in stream]


def report(events: list[dict]) -> tuple[dict | None, list[str]]:
    """(result data, error messages) — and echo progress so a slow run shows life."""
    for e in events:
        if e["type"] == "progress":
            print(f"        · {e['message'][:90]}")
    results = [e["data"] for e in events if e["type"] == "result"]
    return (results[0] if results else None,
            [e["message"] for e in events if e["type"] == "error"])


# --- the tests ---------------------------------------------------------------

async def t_catalog():
    """The models we default to still exist and still advertise what we rely on."""
    import httpx
    from backend import llm

    async with httpx.AsyncClient(timeout=30) as c:
        catalog = {m["id"]: m for m in (await c.get("https://openrouter.ai/api/v1/models")).json()["data"]}
    for name in ("search", "scan", "parse", "vision"):
        role = llm.get_role(name)
        m = catalog.get(role.model)
        if not check(f"{name}: model {role.model} exists on OpenRouter", m):
            continue
        params = m.get("supported_parameters", [])
        check(f"{name}: supports structured outputs", "structured_outputs" in params, params)
        if name == "vision":
            check(f"{name}: accepts image input",
                  "image" in m.get("architecture", {}).get("input_modalities", []),
                  m.get("architecture"))


async def t_parse():
    """Page/pasted text -> a song, with chords merged into the lyric line."""
    from backend import agent

    data, errs = report(await collect(agent.stream_extract_text(CHORD_TEXT, "https://example.com/cr")))
    if not check("no error events", not errs, errs):
        return
    if not check("returned a song", data is not None):
        return
    check("title found", "country road" in (data.get("title") or "").lower(), data.get("title"))
    body = data.get("body") or ""
    check("body uses [Chord] brackets", "[G]" in body, body[:200])
    check("body kept the lyrics", "heaven" in body.lower(), body[:200])
    check("chords merged inline, not left on their own line",
          not any(l.strip() in ("G", "D", "Em", "C") for l in body.splitlines()), body[:300])
    check("section headers use {Section}", "{" in body and "}" in body, body[:200])
    check("key detected", (data.get("key") or "").strip(), data.get("key"))
    check("capo is an int", isinstance(data.get("capo"), int), type(data.get("capo")))
    check("tempo is an int", isinstance(data.get("tempo"), int), type(data.get("tempo")))
    check("tags is a list", isinstance(data.get("tags"), list), type(data.get("tags")))


async def t_scan():
    """A collection page -> songs mapped to links that appear verbatim in the input."""
    from backend import agent

    data, errs = report(await collect(
        agent.stream_scan_text(PLAYLIST_TEXT, PLAYLIST_LINKS, "https://example.com/set")))
    if not check("no error events", not errs, errs):
        return
    if not check("returned a song list", data and isinstance(data.get("songs"), list)):
        return
    songs = data["songs"]
    check("found the 3 songs", len(songs) == 3, songs)
    hrefs = {l["href"] for l in PLAYLIST_LINKS}
    check("every url is verbatim from the input links",
          all(s.get("url") in hrefs for s in songs), [s.get("url") for s in songs])
    check("nav/login links excluded",
          not any(s.get("url", "").endswith(("/login", "/songs")) for s in songs), songs)


async def t_auto():
    """Page-type detection, both branches."""
    from backend import agent

    data, errs = report(await collect(agent.stream_auto_text(CHORD_TEXT, [], "https://example.com/cr")))
    check("song page: no errors", not errs, errs)
    check("song page: kind == song", (data or {}).get("kind") == "song", data)
    check("song page: body parsed", "[" in ((data or {}).get("body") or ""), (data or {}).get("body", "")[:150])

    data, errs = report(await collect(
        agent.stream_auto_text(PLAYLIST_TEXT, PLAYLIST_LINKS, "https://example.com/set")))
    check("collection page: no errors", not errs, errs)
    check("collection page: kind == playlist", (data or {}).get("kind") == "playlist", data)
    check("collection page: songs listed", len((data or {}).get("songs") or []) >= 2, data)


async def t_search():
    """The path that 404'd in production: web search + a strict response schema."""
    from backend import agent

    data, errs = report(await collect(agent.stream_search("Wonderwall Oasis")))
    if not check("no error events (this is the 404 regression)", not errs, errs):
        return
    if not check("returned candidates", data and isinstance(data.get("candidates"), list)):
        return
    cands = data["candidates"]
    check("found at least 2 versions", len(cands) >= 2, len(cands))
    check("every candidate has an http(s) url",
          cands and all((c.get("url") or "").startswith("http") for c in cands),
          [c.get("url") for c in cands])
    check("every candidate has a title", all((c.get("title") or "").strip() for c in cands), cands)
    check("urls are distinct", len({c.get("url") for c in cands}) == len(cands),
          [c.get("url") for c in cands])
    check("looks like the right song",
          any("wonderwall" in json.dumps(c).lower() for c in cands), cands[:2])


async def t_vision():
    """A photo/screenshot of a chord sheet -> a song."""
    from backend import agent

    png = (FIXTURES / "chordsheet.png").read_bytes()
    data, errs = report(await collect(
        agent.stream_extract_image(base64.b64encode(png).decode(), "image/png")))
    if not check("no error events", not errs, errs):
        return
    if not check("returned a song", data is not None):
        return
    body = data.get("body") or ""
    check("title read from the image",
          "country road" in (data.get("title") or "").lower(), data.get("title"))
    check("lyrics read from the image", "heaven" in body.lower(), body[:200])
    check("chords read and bracketed", "[G]" in body, body[:200])


TESTS = {
    "catalog": t_catalog, "parse": t_parse, "scan": t_scan,
    "auto": t_auto, "search": t_search, "vision": t_vision,
}


async def run(only: list[str] | None = None) -> int:
    key = find_api_key()
    if not key:
        print("SKIP: no OpenRouter API key found.\n"
              "      Put one in <repo>/.secrets, or set $OPENROUTER_API_KEY,\n"
              "      or run: python butler.py server key --local")
        return 0

    use_temp_data_dir()          # never touch a real ~/.chords
    import os
    os.environ["OPENROUTER_API_KEY"] = key

    try:
        import httpx  # noqa: F401
    except ImportError:
        print("SKIP: httpx is not installed — pip install -r server/backend/requirements.txt")
        return 0

    from backend import llm
    for name in ("search", "scan", "parse", "vision"):
        r = llm.get_role(name)
        print(f"  role {name:<7} -> {r.model}  (reasoning={r.reasoning})")

    selected = [n for n in TESTS if not only or n in only]
    print(f"\nRunning live tests against OpenRouter: {', '.join(selected)}")
    for name in selected:
        print(f"\n[{name}]")
        t0 = time.perf_counter()
        try:
            await TESTS[name]()
        except Exception as e:
            check(f"{name} raised {type(e).__name__}", False, e)
        print(f"        ({time.perf_counter() - t0:.1f}s)")

    print()
    if FAILURES:
        print(f"*** {len(FAILURES)} FAILED: " + "; ".join(FAILURES))
        return 1
    print("ALL LIVE CHECKS PASSED")
    return 0


def test_live():
    """pytest entry point — skips when no key is configured."""
    if not find_api_key():
        import pytest
        pytest.skip("no OpenRouter API key")
    assert asyncio.run(run()) == 0, FAILURES


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--only", help="comma-separated subset: " + ", ".join(TESTS))
    a = p.parse_args()
    sys.exit(asyncio.run(run(a.only.split(",") if a.only else None)))
