"""Pytest fixtures for hermes-tray integration tests.

These tests hit a live hermes-agent-cn gateway (default 127.0.0.1:8642) the
same way hermes-tray's frontend does: through the ``hermes_proxy_get`` /
``hermes_proxy_post`` Tauri commands, which in turn forward a request to
the gateway with a ``Authorization: Bearer <key>`` header.

Why we keep auth env-driven:
    hermes-agent-cn's ``api_server`` allows anonymous access only when
    ``API_SERVER_KEY`` is empty (see ``api_server.py::_check_auth``).
    hermes-tray's ``src/main.ts`` hard-codes ``hermes-local-dev-key`` as
    the default bearer token, so a real local setup almost always has
    the gateway configured with that key.

How the fixtures behave:
    * ``gateway_url``  — returns the gateway base URL (env override).
    * ``bearer_token`` — returns the bearer token (env override).  When
      empty, no ``Authorization`` header is sent (matches the gateway's
      "no key configured" branch).
    * ``http_client``  — module-scoped synchronous ``httpx.Client`` with
      generous timeouts.  Sync is fine because the gateway responds in
      O(milliseconds) and we don't need streaming here.
    * ``skip_if_gateway_unavailable`` — session-level autouse fixture
      that TCP-probes 127.0.0.1:8642; if the gateway is down, the entire
      suite is skipped rather than failing (a developer with the
      gateway temporarily stopped still gets a clean run).

If you need to point the suite at a non-localhost gateway, set the
``GATEWAY_URL`` environment variable:

    GATEWAY_URL=http://192.0.2.10:8642 python -m pytest -v
"""

from __future__ import annotations

import os
import socket
from typing import Optional

import httpx
import pytest


# ── Constants ──────────────────────────────────────────────────────────

DEFAULT_GATEWAY_URL = "http://127.0.0.1:8642"
DEFAULT_BEARER_TOKEN = "hermes-local-dev-key"  # matches src/main.ts:44
PROBE_TIMEOUT_SECONDS = 2.0
HTTP_TIMEOUT_SECONDS = 10.0


# ── Configuration helpers ──────────────────────────────────────────────


def _resolve_gateway_url() -> str:
    """Return the gateway base URL, stripping any trailing slash."""
    raw = os.environ.get("GATEWAY_URL", DEFAULT_GATEWAY_URL).strip()
    return raw.rstrip("/") if raw else DEFAULT_GATEWAY_URL


def _resolve_bearer_token() -> str:
    """Return the bearer token to use, or '' to send no Authorization header."""
    return os.environ.get("GATEWAY_BEARER_TOKEN", DEFAULT_BEARER_TOKEN).strip()


def _parse_host_port(url: str) -> tuple[str, int]:
    """Best-effort (host, port) extraction for the TCP probe.

    Accepts ``http://host:port`` and ``https://host:port``.  Falls back
    to (127.0.0.1, 8642) if the URL is malformed.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return host, port


def _gateway_reachable(url: str, timeout: float = PROBE_TIMEOUT_SECONDS) -> bool:
    """TCP-probe the gateway.  Cheap, doesn't touch the HTTP stack."""
    host, port = _parse_host_port(url)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# ── Fixtures ───────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def gateway_url() -> str:
    """Base URL of the hermes-agent-cn gateway under test."""
    return _resolve_gateway_url()


@pytest.fixture(scope="session")
def bearer_token() -> str:
    """Bearer token for ``Authorization`` header.  '' means omit header."""
    return _resolve_bearer_token()


@pytest.fixture(scope="session")
def http_client(gateway_url: str, bearer_token: str) -> httpx.Client:
    """Synchronous ``httpx.Client`` with a sensible timeout.

    The bearer token is attached only if non-empty — this matches the
    gateway's auth model (empty key → no auth required) and lets the
    same client drive both authenticated and anonymous tests.
    """
    headers: dict[str, str] = {"Accept": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    return httpx.Client(
        base_url=gateway_url,
        timeout=HTTP_TIMEOUT_SECONDS,
        headers=headers,
    )


@pytest.fixture(scope="session", autouse=True)
def skip_if_gateway_unavailable(gateway_url: str) -> None:
    """Skip the whole suite (not fail) if the gateway is unreachable.

    Rationale: a CI box or a developer machine may not have
    hermes-agent-cn running, and the suite is meant to verify the
    wire between hermes-tray and the gateway — there's no useful
    fallback to test against.
    """
    if not _gateway_reachable(gateway_url):
        pytest.skip(
            f"hermes-agent-cn gateway not reachable at {gateway_url} "
            "(set GATEWAY_URL to point at a running instance)",
            allow_module_level=True,
        )


# ── Helpers exposed to tests ──────────────────────────────────────────


def read_hermes_agent_cn_health(client: httpx.Client) -> Optional[dict]:
    """GET /health and return the parsed JSON, or None on transport failure.

    The /health endpoint requires no auth, so we use it as a fast liveness
    probe before each test in case the gateway died mid-session.  Tests
    should treat ``None`` as "skip" rather than fail when possible.
    """
    try:
        resp = client.get("/health")
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except ValueError:
        return None
