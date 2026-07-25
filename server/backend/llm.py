"""OpenRouter client for the import pipeline.

Every AI step in the importer is one chat completion against OpenRouter's
OpenAI-compatible endpoint. Calls are streamed so a long parse keeps the NDJSON
progress stream alive instead of going silent for a minute.

MODEL ROLES
-----------
The importer does four different jobs, and the cheapest model that does each job
well is not the same one — so each job picks its model by *role*:

  search  find candidate chord/tab URLs for a free-text query. OpenRouter's
          `web` plugin does the actual searching and the model only reshapes the
          results into JSON, so this wants a fast, cheap model.
  scan    map a playlist/collection page to song links, and decide whether a page
          is a playlist or a single song. Long input (page text + up to 300
          links), trivial output — cheap and long-context is what matters.
  parse   turn page text / pasted text into the chords format. This is the one
          that needs real instruction-following: merging a chords-above-lyrics
          layout into inline [C]brackets is the quality-critical step.
  vision  read a photo or screenshot of a chord sheet. Same as parse, plus OCR.

Defaults (July 2026 OpenRouter pricing, USD per million tokens):

  role    model                          in     out    ≈ per call
  search  google/gemini-2.5-flash-lite   0.10   0.40   $0.006  (Exa search $0.005 dominates)
  scan    google/gemini-2.5-flash-lite   0.10   0.40   $0.002
  parse   google/gemini-3.1-flash-lite   0.25   1.50   $0.006
  vision  google/gemini-3.1-flash-lite   0.25   1.50   $0.003

Both defaults are 1M-context, support strict structured outputs, and are among
the cheapest models that are actually dependable at this work. Override any of
them without touching code:

  CHORDS_MODEL_SEARCH / _SCAN / _PARSE / _VISION            model slug
  CHORDS_MODEL_SEARCH_REASONING / …                         off | low | medium | high
  CHORDS_SEARCH_ENGINE      exa (default) | parallel | native | perplexity | firecrawl
  CHORDS_SEARCH_RESULTS     results per search (default 8)

Cheaper still if you want to trade some accuracy: `qwen/qwen3.5-flash-02-23`
($0.065/$0.26, 1M context, vision) works for every role. For better parses:
`google/gemini-3-flash-preview` ($0.50/$3.00) or `openai/gpt-5-mini`
($0.25/$2.00). Every call logs its actual cost, so you can compare for real.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import os
import time
from typing import Any, AsyncIterator

import httpx

from .secrets_store import get_openrouter_key

logger = logging.getLogger("chords.llm")

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Sent as attribution headers; they show up on the OpenRouter activity page and
# cost nothing.
_REFERER = "https://chordsfor.me"
_TITLE = "chords"

_KEY_MISSING_MSG = (
    "No OpenRouter API key is configured, so AI import is unavailable. "
    "Set one with: python butler.py server key --openrouter-key <key> "
    "(or put OPENROUTER_API_KEY in the environment)."
)


class LLMError(RuntimeError):
    """An OpenRouter call could not be completed."""


@dataclasses.dataclass(frozen=True)
class Role:
    """The model configuration for one kind of import work."""

    name: str
    model: str
    reasoning: str      # off | low | medium | high
    max_tokens: int


# Per-role defaults — see the module docstring for why each is what it is.
_ROLES: dict[str, Role] = {
    # Search: the server tool does the searching; the model just needs to pick a
    # good query and reshape results. Reasoning off keeps it snappy.
    "search": Role("search", "google/gemini-2.5-flash-lite", "off", 4_000),
    # Scan: a 300-link playlist page can produce a big JSON array, hence the
    # generous output cap.
    "scan": Role("scan", "google/gemini-2.5-flash-lite", "off", 16_000),
    # Parse / vision: the quality-critical roles. A little thinking measurably
    # improves chord-to-syllable alignment, so reasoning is on at "low".
    "parse": Role("parse", "google/gemini-3.1-flash-lite", "low", 8_000),
    "vision": Role("vision", "google/gemini-3.1-flash-lite", "low", 8_000),
}

_SEARCH_ENGINE = os.environ.get("CHORDS_SEARCH_ENGINE") or "exa"
_SEARCH_RESULTS = int(os.environ.get("CHORDS_SEARCH_RESULTS") or 8)


def get_role(name: str) -> Role:
    """Role config with env overrides applied (read live, so a restart is all it
    takes to switch models)."""
    base = _ROLES[name]
    env = name.upper()
    return dataclasses.replace(
        base,
        model=os.environ.get(f"CHORDS_MODEL_{env}") or base.model,
        reasoning=(os.environ.get(f"CHORDS_MODEL_{env}_REASONING") or base.reasoning).lower(),
    )


def is_configured() -> bool:
    return bool(get_openrouter_key())


def _content(prompt: str, image_b64: str = "", media_type: str = "image/png") -> Any:
    """User-message content: plain text, or text + image for the vision role."""
    if not image_b64:
        return prompt
    return [
        {"type": "image_url",
         "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
        {"type": "text", "text": prompt},
    ]


def _body(
    role: Role,
    prompt: str,
    *,
    system: str,
    schema: dict | None,
    image_b64: str,
    media_type: str,
    web: bool,
) -> dict:
    body: dict[str, Any] = {
        "model": role.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _content(prompt, image_b64, media_type)},
        ],
        "max_tokens": role.max_tokens,
        "temperature": 0,
        "stream": True,
        # Ask for cost/token accounting in the final chunk so every call can be
        # logged with what it actually cost.
        "usage": {"include": True},
    }

    if role.reasoning == "off":
        body["reasoning"] = {"enabled": False}
    elif role.reasoning in ("low", "medium", "high"):
        # `exclude` keeps the thinking out of the response body — we only want
        # the JSON, and reasoning tokens are billed either way.
        body["reasoning"] = {"effort": role.reasoning, "exclude": True}

    if schema is not None:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "result", "strict": True, "schema": schema},
        }
        # Only route to providers that actually enforce the schema.
        body["provider"] = {"require_parameters": True}

    if web:
        # OpenRouter's docs push the `openrouter:web_search` server tool over
        # this plugin, but the server tool is beta and unusable here: with a
        # strict `response_format` attached it fails with
        # `404 Server tool request failed` every time, and several parameter
        # combinations 500 even without one. The plugin is marked deprecated yet
        # works reliably, structured outputs included, at the same price — so it
        # stays until the server tool stabilises.
        #
        # The plugin searches exactly once, using the last user message as the
        # query — so callers must keep that message a bare search query and put
        # their formatting instructions in the system prompt.
        body["plugins"] = [{
            "id": "web",
            # Pin the engine: left on "auto", Google models use native grounding
            # at roughly 7x Exa's $0.005 per search.
            "engine": _SEARCH_ENGINE,
            "max_results": _SEARCH_RESULTS,
            # The stock prompt tells the model to cite with markdown links,
            # which fights with "reply with JSON only".
            "search_prompt": (
                "Here are web search results for the query. Use them as the only "
                "source of URLs in your answer:"
            ),
        }]

    return body


def _log_usage(role: Role, usage: dict | None, elapsed: float, web: bool) -> None:
    u = usage or {}
    cost = u.get("cost")
    logger.info(
        "llm role=%s model=%s%s in=%s out=%s cost=%s %.2fs",
        role.name, role.model, " +search" if web else "",
        u.get("prompt_tokens", "?"), u.get("completion_tokens", "?"),
        f"${cost:.5f}" if isinstance(cost, (int, float)) else "?",
        elapsed,
    )


async def stream_completion(
    prompt: str,
    *,
    role_name: str,
    system: str,
    schema: dict | None = None,
    image_b64: str = "",
    media_type: str = "image/png",
    web: bool = False,
    timeout: float = 90.0,
) -> AsyncIterator[dict]:
    """Run one completion, yielding progress events and finally the model text:

        {"type": "progress", "message": "…"}
        {"type": "_text",    "text": "…"}

    Raises LLMError if the key is missing or OpenRouter rejects the request.
    """
    key = get_openrouter_key()
    if not key:
        raise LLMError(_KEY_MISSING_MSG)

    role = get_role(role_name)
    body = _body(role, prompt, system=system, schema=schema,
                 image_b64=image_b64, media_type=media_type, web=web)

    if web:
        # The plugin runs the search before the model produces a single token,
        # so say so up front rather than waiting for the stream to open.
        yield {"type": "progress", "message": "Searching the web…"}

    async for evt in _run(role, body, key, timeout, web):
        yield evt


async def _run(
    role: Role, body: dict, key: str, timeout: float, web: bool
) -> AsyncIterator[dict]:
    """Issue the request, retrying once without `response_format` if the chosen
    provider rejects the schema (support varies by endpoint and can change)."""
    try:
        async for evt in _stream_once(role, body, key, timeout, web):
            yield evt
        return
    except LLMError as e:
        retryable = "response_format" in body and _is_schema_rejection(str(e))
        if not retryable:
            raise
        logger.warning("schema rejected by %s (%s) — retrying without it", role.model, e)

    plain = {k: v for k, v in body.items() if k not in ("response_format", "provider")}
    async for evt in _stream_once(role, plain, key, timeout, web):
        yield evt


def _is_schema_rejection(message: str) -> bool:
    m = message.lower()
    return ("400" in m or "422" in m or "404" in m) and (
        "response_format" in m or "schema" in m or "json_schema" in m
        or "no endpoints found" in m
    )


async def _stream_once(
    role: Role, body: dict, key: str, timeout: float, web: bool
) -> AsyncIterator[dict]:
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": _REFERER,
        "X-Title": _TITLE,
    }
    text_parts: list[str] = []
    usage: dict | None = None
    announced_thinking = False
    announced_writing = False
    t0 = time.perf_counter()

    limits = httpx.Timeout(timeout, connect=15.0, read=timeout)
    try:
        async with httpx.AsyncClient(timeout=limits) as client:
            async with client.stream("POST", API_URL, headers=headers, json=body) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode("utf-8", "replace")[:600]
                    raise LLMError(f"OpenRouter returned {resp.status_code}: {detail}")

                async for line in resp.aiter_lines():
                    line = line.strip()
                    # Blank separators and ": OPENROUTER PROCESSING" keep-alives.
                    if not line or line.startswith(":"):
                        continue
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue

                    if chunk.get("error"):
                        raise LLMError(f"OpenRouter error: {chunk['error']}")
                    if chunk.get("usage"):
                        usage = chunk["usage"]

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}

                    if not announced_thinking and delta.get("reasoning"):
                        announced_thinking = True
                        yield {"type": "progress", "message": "Working through the page…"}

                    piece = delta.get("content")
                    if piece:
                        if not announced_writing:
                            announced_writing = True
                            yield {"type": "progress", "message": "Writing out the result…"}
                        text_parts.append(piece)
    except httpx.HTTPError as e:
        raise LLMError(f"OpenRouter request failed: {type(e).__name__}: {e}") from e

    _log_usage(role, usage, time.perf_counter() - t0, web)

    text = "".join(text_parts).strip()
    if not text:
        raise LLMError(f"{role.model} returned an empty response")
    yield {"type": "_text", "text": text}
