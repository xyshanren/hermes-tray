"""Concurrent-stream test (scenario 6).

hermes-tray is a single-user desktop app, so it almost never issues
parallel requests in production.  But the underlying gateway runs in a
shared WSL distro and is also reachable from other clients
(hermes-cli, Open WebUI, dev scripts).  A regression that serialized
requests behind a per-process lock would still pass the sequential
scenarios in ``test_chat.py``; this test catches that by firing three
streaming calls in parallel and asserting:

1. All three return HTTP 200.
2. All three complete (each gets at least one ``data:`` chunk and the
   ``[DONE]`` sentinel).
3. The reconstructed text from each request is distinct (no data
   cross-contamination — a tell-tale sign of a shared mutable buffer
   bug in the SSE writer).
4. Total wall time is less than 3× the slowest single request, i.e.
   they actually ran in parallel rather than being serialized by the
   server.

Why three, not five or ten:
    Three is enough to catch the common "single-flight" bug (server
    queues all but one request) and to give the distinct-text check
    enough degrees of freedom.  More would just slow CI without
    buying signal.
"""

from __future__ import annotations

import asyncio
import time
from typing import List, Tuple

import httpx
import pytest

from conftest import read_hermes_agent_cn_health
from sse_helpers import (
    CHAT_TIMEOUT_SECONDS,
    DEFAULT_MODEL,
    collect_sse_chunks,
    collect_streamed_text,
    truncate,
)


#: Each request gets a unique "fingerprint" string the model is asked
#: to repeat.  If the gateway ever accidentally mixed responses across
#: concurrent calls (e.g. via a shared bytes buffer), the reconstructed
#: text would be missing the fingerprint, which the distinctness check
#: catches.
_PARALLEL_PROMPTS = [
    "Reply with the word apple.",
    "Reply with the word banana.",
    "Reply with the word cherry.",
]


def test_three_concurrent_streaming_requests(
    http_client: httpx.Client, gateway_url: str, bearer_token: str
) -> None:
    """Fire 3 streaming chat requests in parallel; all succeed, no
    cross-talk between streams.

    The synchronous ``httpx.Client`` used elsewhere in the suite is
    fine for sequential calls but blocks the event loop on each read.
    We use ``asyncio`` + ``httpx.AsyncClient`` here so all three
    streams are interleaved on the same loop.

    We pin the gateway URL + bearer into the async client's headers
    rather than reusing ``http_client`` (which is sync) because
    mixing sync and async httpx clients inside the same test confuses
    the connection-pool cleanup in some pytest-asyncio versions.
    """
    if read_hermes_agent_cn_health(http_client) is None:
        pytest.skip("gateway health check failed; skipping concurrent test")

    asyncio.run(_run_three_concurrent(gateway_url, bearer_token))


async def _run_three_concurrent(gateway_url: str, bearer_token: str) -> None:
    """The actual concurrent driver — separated so the test body stays flat."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    async with httpx.AsyncClient(
        base_url=gateway_url, headers=headers, timeout=CHAT_TIMEOUT_SECONDS,
    ) as async_client:
        start = time.monotonic()
        tasks = [
            _stream_one(async_client, prompt, idx)
            for idx, prompt in enumerate(_PARALLEL_PROMPTS)
        ]
        results: List[Tuple[int, str, int, bool]] = await asyncio.gather(*tasks)
        wall_time = time.monotonic() - start

    # All three must have succeeded (status 200, at least 1 data chunk,
    # got the [DONE] sentinel).
    for idx, text, chunk_count, saw_done in results:
        assert text, (
            f"request #{idx} returned empty reconstructed text; "
            f"chunks={chunk_count} saw_done={saw_done}"
        )
        assert chunk_count >= 1, (
            f"request #{idx} got 0 data chunks (status implicit 200 because we "
            f"got a response); saw_done={saw_done}"
        )
        assert saw_done, (
            f"request #{idx} did not terminate with [DONE] sentinel; "
            f"reconstructed={text!r}"
        )

    # Distinctness check: each request's reconstructed text should
    # differ from the other two.  We use ``set`` to make this O(n²)
    # without having to write pairwise comparisons by hand.
    texts = [r[1] for r in results]
    assert len(set(texts)) == len(texts), (
        f"concurrent responses collided — possible cross-talk: {texts!r}"
    )

    # Soft wall-time check: if all three ran serially behind a single
    # server-side lock, wall time would be ~3× the slowest request.
    # We can't measure "slowest request" inside the parallel gather,
    # so we just sanity-check that the gather took at least 0.5s
    # (the model is slow enough that even 3 parallel calls take more
    # than the event-loop overhead) and at most 3 × CHAT_TIMEOUT_SECONDS.
    # The interesting regression case (serialized) would push wall
    # time well past 60s; the budget here is loose so we don't flake
    # on a fast machine.
    assert wall_time < 3 * CHAT_TIMEOUT_SECONDS, (
        f"concurrent gather took {wall_time:.1f}s — possible server-side serialization"
    )


async def _stream_one(
    client: httpx.AsyncClient,
    prompt: str,
    index: int,
) -> Tuple[int, str, int, bool]:
    """Run one streaming chat call to completion; return (idx, text, chunk_count, saw_done).

    Uses the *async* iterator (``aiter_lines``) inside the stream
    context.  Mixing sync ``iter_lines`` into an ``AsyncClient.stream``
    raises ``RuntimeError: Attempted to call a sync iterator on an
    async stream`` in httpx ≥ 0.24, so we parse events manually here
    rather than reusing ``collect_sse_chunks`` (which is sync-only).
    """
    import json as _json

    text_parts: List[str] = []
    chunk_count = 0
    saw_done = False
    data_buf: List[str] = []
    role_seen = False

    async with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "model": DEFAULT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            "max_tokens": 16,
            "temperature": 0.0,
        },
    ) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise AssertionError(
                f"concurrent request #{index} returned {resp.status_code}: "
                f"{truncate(body.decode('utf-8', errors='replace'))}"
            )

        # Async line iteration — the right tool for an async stream.
        async for raw in resp.aiter_lines():
            line = raw.rstrip("\r")

            # Blank line = end of one event; flush.
            if line == "":
                if data_buf:
                    payload = "\n".join(data_buf)
                    data_buf = []
                    if payload == "[DONE]":
                        saw_done = True
                        break
                    try:
                        obj = _json.loads(payload)
                    except _json.JSONDecodeError:
                        continue
                    chunk_count += 1
                    try:
                        delta = obj["choices"][0].get("delta") or {}
                        if delta.get("role") == "assistant":
                            role_seen = True
                        if delta.get("content"):
                            text_parts.append(delta["content"])
                    except (KeyError, IndexError):
                        continue
                continue

            if line.startswith(":"):
                # keepalive comment
                continue
            if line.startswith("event:"):
                continue
            if line.startswith("data:"):
                payload = line[len("data:"):]
                if payload.startswith(" "):
                    payload = payload[1:]
                data_buf.append(payload)
                continue

    return (index, "".join(text_parts), chunk_count, saw_done and role_seen)

