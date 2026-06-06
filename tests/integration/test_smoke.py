"""Smoke tests for the hermes-agent-cn gateway.

These tests verify that the wire-level contract hermes-tray depends on
is alive.  They do NOT exercise the gateway's chat or tool logic — the
3 endpoints below are the minimum the frontend needs to know it can
trust the gateway at all.

Each test is independent: if one fails the others still run, so the
diagnostic message tells you exactly which surface is broken.

The tests use ``http_client`` and ``gateway_url`` from ``conftest.py``;
they do not need a live hermes-tray process.  The proxy is exercised
end-to-end from the perspective of the network (i.e. hermes-tray's
Rust ``hermes_proxy_get`` would forward the same ``GET`` with the
same ``Authorization`` header to the same URL).
"""

from __future__ import annotations

import httpx
import pytest

from conftest import read_hermes_agent_cn_health


# ── /health ───────────────────────────────────────────────────────────


def test_health_endpoint(http_client: httpx.Client) -> None:
    """GET /health responds 200 with ``{"status": "ok", ...}``.

    This endpoint intentionally has no auth requirement so dashboards
    and orchestrators can probe it cheaply.  The presence of the
    ``status: ok`` field is the canonical "I'm alive" signal.
    """
    resp = http_client.get("/health")
    assert resp.status_code == 200, (
        f"/health returned {resp.status_code}: {resp.text[:200]}"
    )

    payload = resp.json()
    assert payload.get("status") == "ok", (
        f"/health body missing status=ok; got: {payload!r}"
    )
    # The platform field is informational but stable; assert it so we
    # catch accidental rebrands that would surprise hermes-tray UIs.
    assert payload.get("platform") == "hermes-agent", (
        f"/health platform field changed: {payload.get('platform')!r}"
    )


# ── /v1/models ────────────────────────────────────────────────────────


def test_models_endpoint(http_client: httpx.Client) -> None:
    """GET /v1/models returns at least one model whose id contains "hermes".

    hermes-tray's frontend populates its model dropdown from this
    endpoint, so the response shape must follow the OpenAI
    ``{object: "list", data: [{id, ...}, ...]}`` convention.  An
    empty list would leave the UI without a default model.
    """
    resp = http_client.get("/v1/models")
    assert resp.status_code == 200, (
        f"/v1/models returned {resp.status_code}: {resp.text[:200]}"
    )

    payload = resp.json()
    assert payload.get("object") == "list", (
        f"/v1/models missing object='list'; got: {payload.get('object')!r}"
    )

    data = payload.get("data")
    assert isinstance(data, list) and data, (
        f"/v1/models data is empty or not a list: {data!r}"
    )

    # Every entry should expose an id; assert at least one is a
    # hermes-family model so we catch accidental swaps to a different
    # gateway's identity.
    ids = [entry.get("id", "") for entry in data]
    assert any("hermes" in str(model_id) for model_id in ids), (
        f"/v1/models returned no hermes-family id; ids={ids!r}"
    )


# ── /v1/capabilities ──────────────────────────────────────────────────


def test_capabilities_endpoint(http_client: httpx.Client) -> None:
    """GET /v1/capabilities advertises ``chat_completions`` support.

    hermes-tray actually talks to ``/v1/chat/completions`` (see
    ``hermes_proxy_post_stream`` in ``src-tauri/src/lib.rs``), so
    this capability flag is the only thing telling the frontend the
    endpoint is safe to call.  A regression to ``false`` would
    silently break the chat panel.
    """
    resp = http_client.get("/v1/capabilities")
    assert resp.status_code == 200, (
        f"/v1/capabilities returned {resp.status_code}: {resp.text[:200]}"
    )

    payload = resp.json()
    assert payload.get("object") == "hermes.api_server.capabilities", (
        f"/v1/capabilities object field changed: {payload.get('object')!r}"
    )

    features = payload.get("features")
    assert isinstance(features, dict), (
        f"/v1/capabilities features is not a dict: {features!r}"
    )
    assert features.get("chat_completions") is True, (
        f"/v1/capabilities features.chat_completions is not True; "
        f"got: {features.get('chat_completions')!r}"
    )


# ── Bonus: re-uses the conftest helper to keep the helper honest ─────


def test_conftest_health_helper(http_client: httpx.Client) -> None:
    """``read_hermes_agent_cn_health`` returns a status='ok' dict.

    This is a small belt-and-braces check: if the helper ever silently
    swallows a 200 response (e.g. someone changes its return type),
    the rest of the suite's diagnostic value drops.
    """
    payload = read_hermes_agent_cn_health(http_client)
    assert payload is not None, "read_hermes_agent_cn_health() returned None"
    assert payload.get("status") == "ok", (
        f"helper returned non-ok status: {payload!r}"
    )
