"""Error-path tests for /v1/chat/completions (scenario 5).

The hermes-agent-cn gateway returns OpenAI-style error envelopes on
bad input::

    {"error": {"message": "...", "type": "invalid_request_error", "code": ...}}

with the appropriate HTTP status.  This file pins the wire contract
hermes-tray's frontend depends on for surfacing user-visible errors —
if the gateway ever started returning plain text 500s, the chat
panel would render an empty error toast.

Three sub-cases from the tq7-full-suite task plan:

1. Missing ``messages`` field → 400
2. ``messages`` is not a list → 400
3. Body is not valid JSON → 400

Each is its own ``@pytest.mark.parametrize`` case so a regression in
one doesn't mask the others.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import httpx
import pytest

from sse_helpers import truncate


# ── Parametrized error contract ───────────────────────────────────────


#: Each case is a small named bundle: an id (for pytest output), the
#: request body to send, and a function that returns the raw body
#: bytes (so the "invalid JSON" case can ship bytes that aren't
#: valid JSON, which the ``json=`` kwarg won't let us do directly).
_ERROR_CASES = [
    pytest.param(
        {"model": "hermes-agent"},
        id="missing-messages",
    ),
    pytest.param(
        {"model": "hermes-agent", "messages": "not a list, just a string"},
        id="messages-not-a-list",
    ),
    pytest.param(
        {"model": "hermes-agent", "messages": None},
        id="messages-null",
    ),
    pytest.param(
        {"model": "hermes-agent", "messages": []},
        id="messages-empty-list",
    ),
    pytest.param(
        # Object missing role/content is technically a list, but no
        # user message means the gateway bails.  Per api_server.py
        # line 1073, this returns 400 with "No user message found".
        {"model": "hermes-agent", "messages": [{"foo": "bar"}]},
        id="messages-no-user-role",
    ),
]


@pytest.mark.parametrize("body", _ERROR_CASES)
def test_chat_completion_400_on_bad_input(
    http_client: httpx.Client, body: Dict[str, Any]
) -> None:
    """All malformed request bodies return HTTP 400 with an OpenAI-shape error envelope.

    The contract hermes-tray's UI depends on is::

        HTTP 400
        Content-Type: application/json
        {"error": {"message": "<human readable>", "type": "invalid_request_error"}}

    A regression to ``{"error": "..."}`` (string) or to a plain-text
    body would break the frontend's error-rendering code path.  We
    pin both the status and the envelope shape here.
    """
    resp = http_client.post("/v1/chat/completions", json=body)
    assert resp.status_code == 400, (
        f"expected 400, got {resp.status_code}: {truncate(resp.text)}"
    )

    ctype = resp.headers.get("content-type", "")
    assert ctype.startswith("application/json"), (
        f"expected application/json error body, got Content-Type={ctype!r}"
    )

    payload = resp.json()
    assert "error" in payload, (
        f"error response missing 'error' key; payload={truncate(str(payload))}"
    )
    err = payload["error"]
    assert isinstance(err, dict), (
        f"error envelope should be an object, got {type(err).__name__}: {err!r}"
    )
    assert "message" in err and err["message"], (
        f"error.message missing or empty: {err!r}"
    )
    # OpenAI convention: every error has a ``type`` field.  The gateway
    # uses "invalid_request_error" for all 4xx cases here.
    assert err.get("type") == "invalid_request_error", (
        f"error.type should be 'invalid_request_error'; got {err.get('type')!r}"
    )


def test_chat_completion_400_on_malformed_json(http_client: httpx.Client) -> None:
    """A body that isn't valid JSON returns 400 with the same envelope.

    httpx's ``json=`` kwarg won't let us ship invalid JSON, so we drop
    down to ``content=`` and set Content-Type ourselves.  This is the
    same path a buggy frontend (or a curl-typo in CI) would exercise.
    """
    resp = http_client.post(
        "/v1/chat/completions",
        content=b"{not valid json at all, missing closing brace",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400, (
        f"expected 400, got {resp.status_code}: {truncate(resp.text)}"
    )

    payload = resp.json()
    err = payload.get("error") or {}
    assert err.get("type") == "invalid_request_error", (
        f"expected invalid_request_error envelope; got: {err!r}"
    )
    assert err.get("message"), (
        f"expected non-empty error.message; got: {err!r}"
    )


def test_chat_completion_401_on_bad_bearer(
    gateway_url: str,
) -> None:
    """A request with the wrong bearer token returns 401.

    Out-of-band from the parametrized cases because it needs a
    *separate* httpx client with the wrong key — the conftest's
    ``http_client`` fixture always injects the right one.  We
    construct a one-shot client here.

    We skip this test when the gateway has no API key configured
    (anonymous mode), because then auth is bypassed and there is no
    401 contract to test.
    """
    # Build a client with a deliberately wrong bearer.
    bad_client = httpx.Client(
        base_url=gateway_url,
        timeout=10.0,
        headers={"Authorization": "Bearer this-is-not-the-real-key"},
    )
    try:
        # If the gateway has no API key configured, /v1/models is open
        # — try it first as a quick anonymous-mode probe.
        models_resp = bad_client.get("/v1/models")
        if models_resp.status_code == 200:
            pytest.skip("gateway is in anonymous mode (no API key) — 401 path N/A")

        # Auth-enabled: now hit chat and assert 401.
        resp = bad_client.post(
            "/v1/chat/completions",
            json={
                "model": "hermes-agent",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 4,
            },
        )
        assert resp.status_code == 401, (
            f"wrong bearer should yield 401, got {resp.status_code}: {truncate(resp.text)}"
        )
        payload = resp.json()
        assert payload.get("error", {}).get("code") == "invalid_api_key", (
            f"expected error.code=invalid_api_key; got: {payload!r}"
        )
    finally:
        bad_client.close()
