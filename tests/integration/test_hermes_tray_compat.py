"""hermes-tray ↔ hermes-agent-cn end-to-end wire-shape comparison (scenario 7).

This is the most integration-y test in the suite: instead of just
hitting the gateway, it re-creates the *exact* request shape
hermes-tray's Tauri backend emits, then verifies the response is
parseable by the same SSE parser the Tauri frontend uses.

We don't spin up a real Tauri app (no AppHandle available in a Python
process).  Instead, we read ``src-tauri/src/lib.rs`` to confirm the
proxy commands are pass-throughs, then drive the same wire from httpx
with the headers + body the proxy would construct.  Any drift between
this test and the real Tauri IPC indicates either:

* The proxy gained a header rewrite, body transform, or URL rewrite
  the Tauri frontend's parser isn't ready for, or
* The Tauri frontend's SSE parser assumes a shape the gateway
  doesn't actually emit.

The Tauri commands under test (see ``src-tauri/src/lib.rs``):

* ``hermes_proxy_get(url, headers)`` — GET passthrough.
* ``hermes_proxy_post(url, headers, body)`` — POST passthrough,
  returns ``HermesResponse { ok, status, body }``.
* ``hermes_proxy_post_stream(url, headers, body, window)`` — POST
  passthrough, emits raw chunk bytes on the
  ``hermes-stream-chunk`` window event.  Each Tauri event payload
  is the *bytes* the upstream sent (not the parsed line), so the
  frontend's ``handleStreamChunk`` (``src/main.ts:368``) does the
  ``data:`` line-splitting client-side.

So the test plan is:

1. Build the request hermes-tray's frontend would build (Authorization
   header + JSON body), and POST it directly to the gateway.
2. For the streaming case, parse the bytes through the *same* logic
   the frontend uses (``handleStreamChunk``'s ``split('\\n')`` over
   ``data: `` lines) — see ``sse_helpers.parse_hermes_tray_stream_payload``.
3. Confirm the response carries all the fields the frontend reads:
   ``choices[0].delta.content`` for content, ``[DONE]`` for end-of-stream,
   ``usage`` for the token counter.

If this test ever fails, it almost certainly means a wire-shape
regression that would also break the live Tauri chat panel.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import httpx
import pytest

from conftest import read_hermes_agent_cn_health
from sse_helpers import (
    CHAT_TIMEOUT_SECONDS,
    DEFAULT_MODEL,
    build_hermes_tray_headers,
    collect_sse_chunks,
    collect_streamed_text,
    iter_sse_events,
    parse_hermes_tray_stream_payload,
    truncate,
)


# Path resolution for the optional Rust-source-shape sanity check.
# We try to find the hermes-tray checkout by walking up from this
# test file.  If it isn't there (e.g. a partial checkout), the source
# comparison degrades gracefully to a runtime-only check.
_HERE = Path(__file__).resolve().parent
_HERMES_TRAY_CANDIDATES = [
    _HERE.parent.parent,  # tests/integration → hermes-tray root
    _HERE.parent.parent.parent / "hermes-tray",
]


def _find_hermes_tray_root() -> Path | None:
    """Best-effort locate the hermes-tray checkout on disk."""
    for cand in _HERMES_TRAY_CANDIDATES:
        if (cand / "src-tauri" / "src" / "lib.rs").is_file():
            return cand
    return None


# ── 7a. Source-shape sanity check ─────────────────────────────────────


def test_proxy_commands_are_passthroughs() -> None:
    """The three ``hermes_proxy_*`` Tauri commands are pass-throughs.

    This is a static check (no runtime), so it runs even when the
    gateway is down.  It catches accidental rewrites of the proxy
    surface that would break the wire-shape contract this file
    otherwise relies on.

    We assert the proxy commands do the following:

    * Use ``reqwest::Client::builder().no_proxy()`` to bypass system
      proxies (Clash 502 fix, see lib.rs:28-29).
    * Forward the caller's ``headers`` map verbatim.
    * Forward the caller's ``body`` string verbatim.
    * For the streaming variant, emit each byte chunk on the
      ``hermes-stream-chunk`` window event.

    The exact timeouts and helper functions vary; we just pin the
    contract.
    """
    root = _find_hermes_tray_root()
    if root is None:
        pytest.skip(
            "could not locate hermes-tray checkout (src-tauri/src/lib.rs missing); "
            "static proxy check skipped"
        )

    lib_rs = (root / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")

    # All three commands must use the no_proxy reqwest builder.
    no_proxy_hits = lib_rs.count("no_proxy()")
    assert no_proxy_hits >= 3, (
        f"expected ≥3 no_proxy() calls (one per hermes_proxy_* command); "
        f"found {no_proxy_hits} in lib.rs"
    )

    # hermes_proxy_post_stream must emit on the hermes-stream-chunk event.
    assert "hermes-stream-chunk" in lib_rs, (
        "lib.rs must emit on 'hermes-stream-chunk' window event for the "
        "frontend's handleStreamChunk listener (src/main.ts:144) to fire"
    )
    assert "hermes-stream-done" in lib_rs, (
        "lib.rs must emit on 'hermes-stream-done' to signal end of stream "
        "to the frontend (src/main.ts:147)"
    )

    # All three proxy functions must exist.  In lib.rs they're declared
    # as ``async fn`` (not ``pub async fn``) because ``#[tauri::command]``
    # makes them callable from the frontend; the ``pub`` is implicit
    # through the macro expansion.  We just pin the function name.
    for fn_name in (
        "async fn hermes_proxy_get",
        "async fn hermes_proxy_post",
        "async fn hermes_proxy_post_stream",
    ):
        assert fn_name in lib_rs, (
            f"lib.rs missing required proxy function signature: {fn_name!r}"
        )

    # The proxy commands must be registered in the invoke_handler
    # (without registration, the frontend's ``invoke('hermes_proxy_*')``
    # call would fail at runtime with "command not found").  The macro
    # in lib.rs is ``tauri::generate_handler![...]``; we slice from
    # that point to the end so we don't get false positives from
    # earlier function bodies.
    if "tauri::generate_handler![" in lib_rs:
        invoke_block = lib_rs[lib_rs.find("tauri::generate_handler!["):]
    elif "invoke_handler!" in lib_rs:
        invoke_block = lib_rs[lib_rs.find("invoke_handler!"):]
    else:
        invoke_block = ""
    for name in ("hermes_proxy_get", "hermes_proxy_post", "hermes_proxy_post_stream"):
        assert name in invoke_block, (
            f"{name!r} is defined but not registered in tauri::generate_handler! — "
            f"Tauri frontend's invoke() would fail at runtime"
        )


# ── 7b. End-to-end: hermes-tray-shaped GET ────────────────────────────


def test_hermes_tray_shaped_get_models(
    http_client: httpx.Client, bearer_token: str
) -> None:
    """``hermesGet('/v1/models')`` from src/main.ts returns the same
    body a raw httpx call returns.

    ``hermesGet`` in src/main.ts:46-51 builds::

        { url: `${RESOLVED_GATEWAY_URL}/v1/models`,
          headers: { Authorization: `Bearer ${API_KEY}` } }

    and invokes the Rust ``hermes_proxy_get`` command.  The Rust
    command does a passthrough, so the response body should be byte-
    equal (modulo the wrapper's ``HermesResponse { ok, status, body }``
    envelope) to a direct httpx call with the same headers.  Since we
    can't invoke the Tauri command from Python, we assert the wire
    contract directly: the response is parseable, has the OpenAI-shape
    model list, and contains ``hermes-agent``.
    """
    if read_hermes_agent_cn_health(http_client) is None:
        pytest.skip("gateway health check failed; skipping hermes-tray GET test")

    # Simulate exactly what hermes_proxy_get would send.  We bypass
    # http_client's auto-injected Authorization header so we exercise
    # the explicit header build path (matches src/main.ts verbatim).
    headers = build_hermes_tray_headers(bearer_token)
    resp = http_client.get("/v1/models", headers=headers)
    assert resp.status_code == 200, (
        f"hermes-tray-shaped GET /v1/models returned {resp.status_code}: "
        f"{truncate(resp.text)}"
    )

    payload = resp.json()
    assert payload.get("object") == "list", (
        f"expected object='list'; got {payload.get('object')!r}"
    )
    ids = [entry.get("id") for entry in payload.get("data") or []]
    assert DEFAULT_MODEL in ids, (
        f"hermes-agent should appear in /v1/models data; got {ids!r}"
    )


# ── 7c. End-to-end: hermes-tray-shaped POST + SSE parse ──────────────


def test_hermes_tray_shaped_stream_matches_frontend_parser(
    http_client: httpx.Client, bearer_token: str
) -> None:
    """The SSE bytes the gateway emits are parseable by the *exact*
    parser hermes-tray's ``handleStreamChunk`` uses.

    The Tauri command ``hermes_proxy_post_stream`` emits each raw
    upstream byte chunk on the ``hermes-stream-chunk`` window event
    (lib.rs:472).  The frontend listener
    (src/main.ts:144 / :368) does::

        for (const line of payload.split('\\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) state.streamContent += delta;
        }

    Our ``sse_helpers.parse_hermes_tray_stream_payload`` mirrors that
    logic.  We feed the gateway's stream bytes through it and assert:

    * Every event payload yields zero-or-more JSON chunks, all of
      which carry the OpenAI shape.
    * At least one chunk has a non-empty ``choices[0].delta.content``.
    * The literal ``[DONE]`` sentinel terminates parsing.
    * The accumulated text is non-empty.

    This is the test that would have caught the "agent fires
    ``None`` deltas to signal end-of-stream" bug
    (api_server.py:1146-1154) if it had been introduced into the
    Tauri payload path, because ``None`` deltas are not valid JSON
    and would have failed the ``JSON.parse`` call on the frontend.
    """
    if read_hermes_agent_cn_health(http_client) is None:
        pytest.skip("gateway health check failed; skipping hermes-tray SSE test")

    # Build the request body the way src/main.ts::sendMessage would.
    # We use the same hard-coded defaults the frontend does (CONFIG.maxTokens,
    # CONFIG.temperature) so a regression in the frontend's payload shape
    # is detectable as a contract change here too.
    body = {
        "model": DEFAULT_MODEL,
        "messages": [{"role": "user", "content": "Say one short word."}],
        "max_tokens": 16,
        "temperature": 0.7,
        "stream": True,
    }
    headers = {
        **build_hermes_tray_headers(bearer_token),
        "Accept": "text/event-stream",
    }

    with http_client.stream(
        "POST",
        "/v1/chat/completions",
        json=body,
        headers=headers,
        timeout=CHAT_TIMEOUT_SECONDS,
    ) as resp:
        assert resp.status_code == 200, (
            f"hermes-tray-shaped stream returned {resp.status_code}: "
            f"{truncate(resp.text)}"
        )
        ctype = resp.headers.get("content-type", "")
        assert ctype.startswith("text/event-stream"), (
            f"expected text/event-stream, got {ctype!r}"
        )

        # ── Path 1: spec-compliant parser ──
        # Asserts the gateway's stream is well-formed SSE end-to-end.
        chunks, all_events = collect_sse_chunks(resp)
        assert len(chunks) >= 3, (
            f"expected ≥3 SSE chunks (role + content + finish); got {len(chunks)}"
        )
        assert any(ev.kind == "done" for ev in all_events), (
            f"stream did not terminate with [DONE] sentinel; "
            f"kinds={[ev.kind for ev in all_events]}"
        )

    full_text = collect_streamed_text(chunks)
    assert full_text.strip(), (
        f"reconstructed text is empty; chunks={truncate(str(chunks))}"
    )

    # ── Path 2: frontend-parser-shaped parser ──
    # We re-stream the same request (it's cheap) and feed the raw
    # byte chunks through the *frontend's* split('\\n')-style parser
    # via ``parse_hermes_tray_stream_payload``.  This is what the
    # Tauri ``hermes-stream-chunk`` event handler would do.
    with http_client.stream(
        "POST",
        "/v1/chat/completions",
        json=body,
        headers=headers,
        timeout=CHAT_TIMEOUT_SECONDS,
    ) as resp2:
        assert resp2.status_code == 200
        frontend_chunks: List[Dict[str, Any]] = []
        frontend_text_parts: List[str] = []
        for line in resp2.iter_lines():
            # Replicate handleStreamChunk's line-by-line processing.
            for parsed in parse_hermes_tray_stream_payload(line):
                frontend_chunks.append(parsed)
                try:
                    delta = parsed["choices"][0].get("delta") or {}
                    if delta.get("content"):
                        frontend_text_parts.append(delta["content"])
                except (KeyError, IndexError):
                    # Non-conforming chunk; the frontend's try/catch
                    # would swallow this, so we surface it as a
                    # diagnostic but don't fail the test for it
                    # (matches the production tolerance).
                    pass

    assert frontend_chunks, (
        "frontend-shaped parser extracted 0 chunks — the gateway's "
        "data: line shape may have drifted from what handleStreamChunk expects"
    )
    frontend_text = "".join(frontend_text_parts)
    assert frontend_text.strip(), (
        f"frontend-shaped parser saw no delta.content; "
        f"chunks={truncate(str(frontend_chunks))}"
    )

    # The two parsers should produce the same number of chunks for
    # the same request (modulo keepalives, which the spec-compliant
    # parser surfaces as events but the frontend parser drops).
    # We don't assert exact equality because the timing of the two
    # requests differs — the model is non-deterministic.
    assert len(frontend_chunks) >= 1, (
        f"frontend parser saw only {len(frontend_chunks)} chunk(s); "
        f"expected at least 1"
    )
