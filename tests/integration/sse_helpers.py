"""Shared helpers for hermes-tray integration tests.

These utilities are imported by the various ``test_*.py`` modules.  Keeping
them out of ``conftest.py`` means the conftest stays focused on pytest
fixtures, and the helpers are easy to import on their own (e.g. for ad-hoc
``python -i`` debugging during a triage session).

Why we don't use ``httpx-sse`` even though it's in requirements.txt:
    hermes-agent-cn emits non-standard ``event: hermes.tool.progress``
    lines interleaved with the standard ``data: {json}`` lines.  The
    stock SSE parser drops the event lines and would lose the tool
    lifecycle signal hermes-tray's frontend (src/main.ts) keys off.
    Rolling our own minimal parser lets us assert the exact wire shape
    the proxy chain (``hermes_proxy_post_stream`` → reqwest → aiohttp
    SSE) carries end-to-end, including the tool-progress side channel.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterator, List, Optional, Tuple

import httpx


# ── Constants ──────────────────────────────────────────────────────────

#: How long a single chat-completions call (streaming or not) is allowed
#: to take before we assume the agent is wedged.  Generous on purpose —
#: the gateway's first call after startup pays the model load cost
#: (≈20s on this machine with the 14B ollama model).
CHAT_TIMEOUT_SECONDS = 180.0

#: How long to wait between streaming chunks before declaring the
#: stream stuck.  Shorter than CHAT_TIMEOUT_SECONDS because once data
#: starts flowing, the model is loaded and tokens should arrive in
#: well under 30s apiece.
STREAM_CHUNK_TIMEOUT_SECONDS = 60.0

#: The advertised model id (matches what /v1/models reports).  hermes-tray
#: hard-codes this default in src/main.ts:CONFIG.defaultModel.
DEFAULT_MODEL = "hermes-agent"


# ── SSE parsing ────────────────────────────────────────────────────────


class SSEEvent:
    """A single Server-Sent Event, parsed from the raw stream bytes.

    The SSE protocol says an event is one or more ``field: value`` lines
    followed by a blank line.  hermes-agent-cn only emits three field
    types:

    * ``data: {...}`` — the OpenAI-shaped chunk payload, one JSON object
      per line.  Multiple ``data:`` lines per event are allowed by spec
      but the gateway never does this, so we concatenate with ``\n`` to
      match the standard SSE behavior.
    * ``event: hermes.tool.progress`` — a custom event for tool lifecycle
      signals.  Always paired with a ``data:`` line carrying the JSON
      payload (see api_server.py::_write_sse_chat_completion).
    * ``: keepalive`` — comment line sent every 30s on idle streams.
      We surface these as ``SSEEvent(kind="keepalive")`` so callers can
      distinguish them from real data without parsing twice.

    Attributes:
        event:   The value of the ``event:`` field, or ``""`` for the
                 default (anonymous) event.
        data:    The concatenated ``data:`` payload (string).  For
                 ``[DONE]`` sentinels this is the literal string
                 ``"[DONE]"`` and the caller should treat it as EOF.
        raw:     The original line text, kept for diagnostic output.
    """

    __slots__ = ("event", "data", "raw", "kind")

    def __init__(self, event: str, data: str, raw: str = "", kind: str = "data") -> None:
        self.event = event
        self.data = data
        self.raw = raw
        self.kind = kind  # "data" | "keepalive" | "done"

    def __repr__(self) -> str:  # pragma: no cover - debug aid only
        if self.kind == "keepalive":
            return "SSEEvent(kind=keepalive)"
        if self.kind == "done":
            return "SSEEvent(kind=done)"
        return f"SSEEvent(event={self.event!r}, data={self.data[:80]!r})"


def iter_sse_events(response: httpx.Response) -> Iterator[SSEEvent]:
    """Yield ``SSEEvent`` objects from a streaming ``httpx.Response``.

    The implementation is line-based and intentionally tolerant:

    * ``\\r\\n`` and ``\\n`` line endings both work (some proxies mix).
    * Trailing whitespace on ``data:`` lines is stripped (the gateway
      never adds any, but hermes-tray's Tauri event payload could
      acquire trailing newlines during a Windows console round-trip).
    * Comment lines (starting with ``:``) become ``SSEEvent(kind="keepalive")``
      so callers can assert the keepalive loop is alive without
      breaking on a non-JSON payload.
    * The literal ``[DONE]`` sentinel (a common SSE convention OpenAI
      popularized) terminates the iteration when encountered, mirroring
      what the official openai-python SDK does.

    Why we don't decode the response at the top:
        ``response.iter_lines()`` decodes each chunk as it arrives,
        which is what we want for streaming.  Doing
        ``response.text.split("\\\\n\\\\n")`` would buffer the whole body
        and defeat the purpose of streaming.
    """
    data_buf: List[str] = []
    event_buf: str = ""

    def _flush() -> Optional[SSEEvent]:
        nonlocal data_buf, event_buf
        if not data_buf and not event_buf:
            return None
        data_str = "\n".join(data_buf)
        ev = SSEEvent(event=event_buf, data=data_str)
        data_buf = []
        event_buf = ""
        return ev

    for line in response.iter_lines():
        # httpx strips the line terminator for us; tolerate stray CR.
        line = line.rstrip("\r")

        # Blank line = end of one event.
        if line == "":
            flushed = _flush()
            if flushed is not None:
                if flushed.data == "[DONE]":
                    flushed.kind = "done"
                    yield flushed
                    return
                yield flushed
            continue

        # Comment line (keepalive).
        if line.startswith(":"):
            yield SSEEvent(event="", data="", raw=line, kind="keepalive")
            continue

        if line.startswith("event:"):
            event_buf = line[len("event:"):].strip()
            continue

        if line.startswith("data:"):
            # Strip the prefix and a single leading space (SSE spec).
            payload = line[len("data:"):]
            if payload.startswith(" "):
                payload = payload[1:]
            data_buf.append(payload)
            continue

        # Unknown field — ignore per SSE spec, but keep the raw line for
        # diagnostics.  We don't yield anything; the parser's job is to
        # surface the well-known fields, not enforce compliance.
        continue

    # Stream ended without a trailing blank line — flush whatever's left.
    flushed = _flush()
    if flushed is not None:
        if flushed.data == "[DONE]":
            flushed.kind = "done"
        yield flushed


def collect_sse_chunks(response: httpx.Response) -> Tuple[List[Dict[str, Any]], List[SSEEvent]]:
    """Parse every SSE event in ``response`` and return ``(data_chunks, all_events)``.

    ``data_chunks`` is a list of dicts — the JSON-decoded payloads of
    every event whose ``data:`` field started with ``{`` and parsed
    cleanly.  Events that aren't JSON (``[DONE]``, keepalives, malformed
    payloads) are skipped here but still appear in ``all_events`` so
    the caller can assert on the full stream shape.
    """
    chunks: List[Dict[str, Any]] = []
    all_events: List[SSEEvent] = []
    for ev in iter_sse_events(response):
        all_events.append(ev)
        if ev.kind == "keepalive":
            continue
        if ev.kind == "done":
            continue
        if not ev.data:
            continue
        try:
            chunks.append(json.loads(ev.data))
        except json.JSONDecodeError:
            # Tolerate non-JSON data lines so a future custom event the
            # gateway starts emitting doesn't break the parser.
            continue
    return chunks, all_events


# ── High-level chat helpers ────────────────────────────────────────────


def post_chat_completion(
    client: httpx.Client,
    messages: List[Dict[str, str]],
    *,
    model: str = DEFAULT_MODEL,
    stream: bool = False,
    max_tokens: int = 64,
    temperature: float = 0.0,
    extra_body: Optional[Dict[str, Any]] = None,
) -> httpx.Response:
    """POST /v1/chat/completions with the OpenAI-style envelope.

    Centralizes the URL, content-type, and shape so the test bodies
    stay focused on what's under test rather than the envelope.
    ``max_tokens`` defaults to a small value to keep CI fast — the
    hermes-agent-cn 14B model spends most of its wall time on the
    first call after startup (≈20s for cold load), and the tests only
    need a few tokens to prove the wire works.
    """
    body: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if extra_body:
        body.update(extra_body)
    # We use ``json=`` so httpx sets Content-Type and serializes
    # correctly; this is what the hermes-tray frontend does in spirit
    # (JSON.stringify(body) → POST), so it mirrors production wire shape.
    return client.post("/v1/chat/completions", json=body)


def collect_streamed_text(
    chunks: List[Dict[str, Any]],
) -> str:
    """Concatenate ``choices[0].delta.content`` fields across ``chunks``.

    Mirrors what hermes-tray's frontend does in
    ``src/main.ts::handleStreamChunk``: walks each chunk, pulls the
    delta content if present, joins.  Skips the role-only chunk
    (delta has no ``content`` key) and the terminal chunk
    (delta is empty).
    """
    parts: List[str] = []
    for ch in chunks:
        try:
            choice = ch["choices"][0]
        except (KeyError, IndexError):
            continue
        delta = choice.get("delta") or {}
        content = delta.get("content")
        if content:
            parts.append(content)
    return "".join(parts)


# ── hermes-tray wire-format helpers ────────────────────────────────────


def build_hermes_tray_headers(bearer_token: str) -> Dict[str, str]:
    """Return the headers hermes-tray's frontend attaches to every call.

    The shape is hard-coded in ``src/main.ts::hermesGet`` /
    ``hermesPostStream``: a single ``Authorization: Bearer <key>`` plus
    whatever httpx/reqwest adds by default.  Keeping this in a helper
    means tests asserting the proxy chain can use the same dict the
    real Tauri app sends, so a regression in the frontend's header
    shape is caught by the suite rather than at runtime.
    """
    return {"Authorization": f"Bearer {bearer_token}"}


def parse_hermes_tray_stream_payload(
    event_payload: str,
) -> List[Dict[str, Any]]:
    """Replicate the SSE parsing in ``src/main.ts::handleStreamChunk``.

    The Tauri command ``hermes_proxy_post_stream`` emits one event per
    byte chunk (see src-tauri/src/lib.rs:472), so a single Tauri event
    payload may contain a partial SSE event (e.g. just
    ``"data: {...}\\n\\"``) or multiple complete events glued together
    (when the underlying TCP buffer flushes fast).  The frontend's
    parser handles both by ``split('\\n')``-ing and looking for
    ``data: `` prefixes — we mirror that logic here so a future change
    in the frontend's parser (e.g. handling ``event: hermes.tool.progress``)
    shows up as a failing test before it breaks the live UI.
    """
    parsed: List[Dict[str, Any]] = []
    for line in event_payload.split("\n"):
        if not line.startswith("data: "):
            continue
        data = line[len("data: "):]
        if data == "[DONE]":
            continue
        try:
            parsed.append(json.loads(data))
        except json.JSONDecodeError:
            continue
    return parsed


# ── Diagnostics ────────────────────────────────────────────────────────


def truncate(text: str, limit: int = 200) -> str:
    """Clip a string for diagnostic output without losing the head/tail."""
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-(limit // 2):]
    return f"{head}...{tail}"


def now_ms() -> int:
    """Monotonic clock in milliseconds, for diagnostic timing prints."""
    return int(time.monotonic() * 1000)
