#!/usr/bin/env python3
"""Offline tests for the import pipeline.

Runs the real `backend.agent` / `backend.llm` code against a stub HTTP server
that speaks OpenRouter's SSE dialect, so it exercises request shaping, streaming,
schema handling, retries and error paths without spending a cent.

    python butler.py server test          # or: python server/tests/test_pipeline.py

For checks against the real API see test_live.py.
"""

import asyncio
import json
import pathlib
import sys

from conftest import use_temp_data_dir  # noqa: E402  (path setup)

TMP = use_temp_data_dir()

from backend import secrets_store  # noqa: E402

secrets_store.set_openrouter_key("sk-or-test-1234567890")

from backend import agent, llm  # noqa: E402

REQUESTS: list[dict] = []      # bodies the stub received
MODE = {"v": "song"}           # what the stub should reply with

SONG = {"title": "Test Song", "artist": "Nobody", "key": "G", "capo": 2,
        "tempo": 88, "tags": ["acoustic"], "body": "{Verse 1}\n[G]Hello [D]world"}


# --- stub OpenRouter ---------------------------------------------------------

def _sse(*chunks: dict) -> bytes:
    out = b""
    for c in chunks:
        out += b"data: " + json.dumps(c).encode() + b"\n\n"
    # A keep-alive comment and the terminator, exactly as OpenRouter sends them.
    return out + b": OPENROUTER PROCESSING\n\n" + b"data: [DONE]\n\n"


def _delta(content=None, **kw) -> dict:
    d = dict(kw)
    if content is not None:
        d["content"] = content
    return {"choices": [{"delta": d}]}


async def _handle(reader, writer):
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = await reader.read(4096)
        if not chunk:
            return
        head += chunk
    headers, _, rest = head.partition(b"\r\n\r\n")
    length = 0
    for line in headers.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":")[1])
    while len(rest) < length:
        rest += await reader.read(length - len(rest))
    REQUESTS.append({"body": json.loads(rest), "headers": headers.decode()})
    body = REQUESTS[-1]["body"]

    def fail(code: str, payload: bytes):
        writer.write(f"HTTP/1.1 {code}\r\nContent-Type: application/json\r\n"
                     f"Content-Length: {len(payload)}\r\n\r\n".encode() + payload)

    mode = MODE["v"]
    if mode == "http_error":
        fail("429 Too Many Requests", b'{"error":{"message":"boom"}}')
        await writer.drain(); writer.close(); return
    if mode == "schema_reject" and "response_format" in body:
        fail("400 Bad Request",
             b'{"error":{"message":"response_format json_schema is not supported"}}')
        await writer.drain(); writer.close(); return

    if mode == "search":
        chunks = [_delta(reasoning="hmm"), _delta(json.dumps({"candidates": [
            {"title": "Test Song", "artist": "Nobody", "source": "example.com",
             "url": "https://example.com/song", "key": "G", "snippet": "Acoustic"}]}))]
    elif mode == "playlist":
        chunks = [_delta(json.dumps({"songs": [
            {"title": "A", "artist": "X", "url": "https://e.com/a"},
            {"title": "B", "artist": "Y", "url": "https://e.com/b"}]}))]
    elif mode == "auto_song":
        chunks = [_delta(json.dumps({"kind": "song", "songs": [], **SONG}))]
    elif mode == "auto_playlist":
        chunks = [_delta(json.dumps({"kind": "playlist", "songs": [
            {"title": "A", "artist": "X", "url": "https://e.com/a"}],
            **{**SONG, "body": "", "title": "", "artist": ""}}))]
    elif mode == "fenced":  # provider ignored the schema and wrapped the JSON
        chunks = [_delta("Sure!\n```json\n" + json.dumps(SONG) + "\n```")]
    elif mode == "empty_body":
        chunks = [_delta(json.dumps({**SONG, "body": ""}))]
    else:  # a song, streamed in pieces
        s = json.dumps(SONG)
        chunks = [_delta(s[i:i + 40]) for i in range(0, len(s), 40)]

    chunks.append({"choices": [{"delta": {}, "finish_reason": "stop"}],
                   "usage": {"prompt_tokens": 1234, "completion_tokens": 56, "cost": 0.00031}})
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                 b"Cache-Control: no-cache\r\nConnection: close\r\n\r\n")
    writer.write(_sse(*chunks))
    await writer.drain()
    writer.close()


# --- helpers -----------------------------------------------------------------

FAILURES: list[str] = []


def check(name: str, cond, extra="") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        FAILURES.append(name)
        if extra:
            print(f"        {extra}")


async def collect(stream) -> list[dict]:
    return [e async for e in stream]


def result_of(events: list[dict]):
    r = [e for e in events if e["type"] == "result"]
    return r[0]["data"] if r else None


def errors_of(events: list[dict]) -> list[str]:
    return [e["message"] for e in events if e["type"] == "error"]


# --- the tests ---------------------------------------------------------------

async def run() -> int:
    server = await asyncio.start_server(_handle, "127.0.0.1", 0)
    llm.API_URL = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}/api/v1/chat/completions"

    print("\n[1] stream_extract_text — streamed song JSON")
    MODE["v"] = "song"; REQUESTS.clear()
    ev = await collect(agent.stream_extract_text("chords here\n[G]hello world, plenty of text"))
    data = result_of(ev)
    check("result event carries the parsed song", data and data["title"] == "Test Song", ev)
    check("chunks reassembled into valid JSON", data and data["capo"] == 2, data)
    check("progress announces writing",
          any("Writing out" in e.get("message", "") for e in ev), ev)
    body = REQUESTS[0]["body"]
    check("parse role -> gemini-3.1-flash-lite", body["model"] == "google/gemini-3.1-flash-lite",
          body["model"])
    check("strict json_schema sent", body["response_format"]["json_schema"]["strict"] is True)
    check("require_parameters set", body["provider"]["require_parameters"] is True)
    check("reasoning low + excluded", body["reasoning"] == {"effort": "low", "exclude": True},
          body.get("reasoning"))
    check("usage accounting requested", body["usage"] == {"include": True})
    check("streaming enabled", body["stream"] is True)
    check("auth header sent", "sk-or-test" in REQUESTS[0]["headers"])

    print("\n[2] stream_search — web plugin + candidates")
    MODE["v"] = "search"; REQUESTS.clear()
    ev = await collect(agent.stream_search("test song"))
    data = result_of(ev)
    check("candidates returned", data and len(data["candidates"]) == 1, ev)
    check("'Searching the web…' progress emitted",
          any(e.get("message") == "Searching the web…" for e in ev), ev)
    body = REQUESTS[0]["body"]
    check("search role -> gemini-2.5-flash-lite", body["model"] == "google/gemini-2.5-flash-lite",
          body["model"])
    # The server tool 404s whenever a strict schema is attached; the plugin does
    # not. Guard against a regression back to `tools`.
    check("web plugin used, NOT the openrouter:web_search server tool",
          "tools" not in body and body["plugins"][0]["id"] == "web", body.get("tools"))
    check("engine pinned to exa (native grounding costs ~7x)",
          body["plugins"][0]["engine"] == "exa", body["plugins"][0])
    check("max_results applied", body["plugins"][0]["max_results"] == 8, body["plugins"][0])
    check("custom search_prompt drops the markdown-citation instruction",
          "markdown" not in body["plugins"][0]["search_prompt"].lower())
    # The plugin searches with the user message verbatim, so it must stay a bare
    # query — instructions belong in the system prompt.
    user_msg = body["messages"][1]["content"]
    check("user message is a bare search query", user_msg == "test song guitar chords tab", user_msg)
    check("format instructions live in the system prompt",
          "candidates" in body["messages"][0]["content"], body["messages"][0]["content"][:80])
    check("reasoning disabled for search", body["reasoning"] == {"enabled": False},
          body.get("reasoning"))

    print("\n[3] stream_scan_text — playlist links")
    MODE["v"] = "playlist"; REQUESTS.clear()
    ev = await collect(agent.stream_scan_text(
        "a page", [{"text": "A", "href": "https://e.com/a"}], "https://e.com"))
    data = result_of(ev)
    check("two songs returned", data and len(data["songs"]) == 2, ev)
    check("scan role -> gemini-2.5-flash-lite",
          REQUESTS[0]["body"]["model"] == "google/gemini-2.5-flash-lite")

    print("\n[4] stream_auto_text — both branches of the union schema")
    MODE["v"] = "auto_song"; REQUESTS.clear()
    ev = await collect(agent.stream_auto_text("page text long enough to pass", [], "https://e.com/x"))
    data = result_of(ev)
    check("song branch: kind + body", data and data["kind"] == "song"
          and data["body"].startswith("{Verse 1}"), ev)
    MODE["v"] = "auto_playlist"; REQUESTS.clear()
    ev = await collect(agent.stream_auto_text("page text long enough to pass", [], "https://e.com/x"))
    data = result_of(ev)
    check("playlist branch: kind + songs", data and data["kind"] == "playlist"
          and len(data["songs"]) == 1, ev)

    print("\n[5] stream_extract_image — vision role, image attached")
    MODE["v"] = "song"; REQUESTS.clear()
    ev = await collect(agent.stream_extract_image("aGVsbG8=", "image/jpeg"))
    check("song parsed from image", (result_of(ev) or {}).get("artist") == "Nobody", ev)
    content = REQUESTS[0]["body"]["messages"][1]["content"]
    check("image sent as a data URI",
          content[0]["image_url"]["url"] == "data:image/jpeg;base64,aGVsbG8=", content[0])
    check("vision role model", REQUESTS[0]["body"]["model"] == "google/gemini-3.1-flash-lite")

    print("\n[6] fenced JSON fallback (provider ignored the schema)")
    MODE["v"] = "fenced"; REQUESTS.clear()
    ev = await collect(agent.stream_extract_text("some pasted chords text here"))
    check("fenced JSON still parsed", (result_of(ev) or {}).get("title") == "Test Song", ev)

    print("\n[7] schema rejected -> retry without response_format")
    MODE["v"] = "schema_reject"; REQUESTS.clear()
    ev = await collect(agent.stream_extract_text("some pasted chords text here"))
    check("succeeded on retry", result_of(ev) is not None, ev)
    check("exactly two requests made", len(REQUESTS) == 2, len(REQUESTS))
    check("retry dropped response_format and provider",
          len(REQUESTS) == 2 and "response_format" not in REQUESTS[1]["body"]
          and "provider" not in REQUESTS[1]["body"])

    print("\n[8] failure paths surface as error events, never a crash")
    MODE["v"] = "http_error"; REQUESTS.clear()
    ev = await collect(agent.stream_extract_text("some pasted chords text here"))
    errs = errors_of(ev)
    check("HTTP error reported", errs and "429" in errs[0], ev)
    MODE["v"] = "empty_body"
    ev = await collect(agent.stream_extract_text("some pasted chords text here"))
    errs = errors_of(ev)
    check("empty body -> 'No chords or lyrics'", errs and "No chords" in errs[0], ev)
    ev = await collect(agent.stream_extract_text("short"))
    check("too-short input rejected before any call", errors_of(ev), ev)

    print("\n[9] key handling")
    secrets_store.set_openrouter_key("")
    ev = await collect(agent.stream_extract_text("some pasted chords text here"))
    errs = errors_of(ev)
    check("missing key -> actionable error", errs and "butler.py server key" in errs[0], ev)
    secrets_store.set_openrouter_key("sk-or-test-1234567890")
    import os
    os.environ["OPENROUTER_API_KEY"] = "sk-or-from-env"
    check("env key wins over secrets.json", secrets_store.get_openrouter_key() == "sk-or-from-env")
    os.environ["OPENROUTER_API_KEY"] = "   "
    check("blank env falls back to the file",
          secrets_store.get_openrouter_key() == "sk-or-test-1234567890")
    del os.environ["OPENROUTER_API_KEY"]
    f = pathlib.Path(TMP) / "secrets.json"
    check("secrets.json is 0600", oct(f.stat().st_mode)[-3:] == "600", oct(f.stat().st_mode))
    check("jwt/admin secrets preserved alongside the key",
          set(json.loads(f.read_text())) >= {"jwt_secret", "admin_passcode", "openrouter_api_key"})

    print("\n[10] env model overrides")
    os.environ["CHORDS_MODEL_PARSE"] = "qwen/qwen3.5-flash-02-23"
    os.environ["CHORDS_MODEL_PARSE_REASONING"] = "off"
    MODE["v"] = "song"; REQUESTS.clear()
    await collect(agent.stream_extract_text("some pasted chords text here"))
    check("model override applied",
          REQUESTS[0]["body"]["model"] == "qwen/qwen3.5-flash-02-23", REQUESTS[0]["body"]["model"])
    check("reasoning override applied", REQUESTS[0]["body"]["reasoning"] == {"enabled": False})
    del os.environ["CHORDS_MODEL_PARSE"], os.environ["CHORDS_MODEL_PARSE_REASONING"]

    server.close()
    print()
    if FAILURES:
        print(f"*** {len(FAILURES)} FAILED: " + "; ".join(FAILURES))
        return 1
    print("ALL OFFLINE CHECKS PASSED")
    return 0


def test_pipeline():
    """pytest entry point."""
    assert asyncio.run(run()) == 0, FAILURES


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
