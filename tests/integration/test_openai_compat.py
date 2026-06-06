"""OpenAI Python SDK compatibility test (scenario 4).

hermes-agent-cn's claim is that any OpenAI-compatible client (Open WebUI,
LobeChat, LibreChat, AnythingLLM, NextChat, ChatBox, etc.) can connect
to it.  This test proves the claim by talking to the gateway with the
official ``openai`` Python SDK pointed at ``/v1`` — the SDK is a
strict consumer of the wire shape, so if it works here, the contract
is real.

Why we use a dummy api_key instead of skipping the auth header:
    hermes-agent-cn with ``API_SERVER_KEY`` configured rejects every
    request that lacks a valid ``Authorization: Bearer <key>`` header.
    The OpenAI SDK *always* sends some value (any string works in our
    case because the gateway only validates by hmac.compare_digest, and
    "dummy" is not what hermes-agent-cn expects either — but
    conftest.py's http_client fixture already adds the right bearer
    token via the httpx client).  We override the OpenAI SDK's own
    ``api_key`` argument to the real gateway token so the SDK doesn't
    fight our bearer injection.
"""

from __future__ import annotations

import httpx
import pytest

from conftest import read_hermes_agent_cn_health
from sse_helpers import DEFAULT_MODEL, truncate


def test_openai_sdk_non_streaming_compat(
    http_client: httpx.Client, gateway_url: str, bearer_token: str
) -> None:
    """The official OpenAI Python SDK can call ``/v1/chat/completions``.

    We use the SDK's ``OpenAI`` client with ``base_url`` pointed at the
    gateway, then issue a non-streaming ``chat.completions.create``
    call.  Assertions mirror what the SDK guarantees to its callers:

    * The response object exposes ``.choices[0].message.content``
      (Pydantic model attribute access, not dict).
    * The message role is ``"assistant"``.
    * The content is a non-empty string.
    * ``.usage`` carries token counts (the SDK exposes these as
      ``prompt_tokens`` / ``completion_tokens`` / ``total_tokens``).
    """
    if read_hermes_agent_cn_health(http_client) is None:
        pytest.skip("gateway health check failed; skipping SDK compat test")

    # Lazy import: openai is a heavy dep and we want the failure
    # message to be a clear "package not installed" rather than a
    # collection-time traceback.  pytest.importorskip would also work
    # but raises the skip *before* the skip-if-gateway-down check,
    # which is the wrong order — if the user doesn't have openai but
    # also has no gateway, the openai-missing message is misleading.
    try:
        from openai import OpenAI
    except ImportError:
        pytest.skip("openai SDK not installed (pip install openai>=1.0)")

    # The OpenAI SDK builds a httpx client internally; we mirror the
    # way hermes-tray's frontend constructs the URL: just the base
    # gateway URL with ``/v1`` appended.  Any trailing slash on the
    # gateway URL is stripped to keep httpx happy.
    base_url = gateway_url.rstrip("/") + "/v1"
    client = OpenAI(
        base_url=base_url,
        api_key=bearer_token or "dummy-not-used",  # SDK requires non-empty
    )

    completion = client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=[{"role": "user", "content": "Reply with a single word."}],
        max_tokens=16,
        temperature=0.0,
        stream=False,
    )

    # Pydantic-model attribute access — the whole point of using the
    # SDK here is to catch wire-shape drift that would still pass a
    # raw-dict assertion.
    assert completion.choices, (
        f"SDK returned no choices; raw={truncate(str(completion))}"
    )
    choice = completion.choices[0]
    assert choice.message.role == "assistant", (
        f"SDK choice.message.role != 'assistant'; got {choice.message.role!r}"
    )
    content = choice.message.content or ""
    assert content.strip(), (
        f"SDK choice.message.content is empty; full={truncate(str(completion))}"
    )

    if completion.usage is not None:
        assert completion.usage.completion_tokens > 0, (
            f"SDK usage.completion_tokens should be >0; got: {completion.usage}"
        )


def test_openai_sdk_list_models_compat(
    http_client: httpx.Client, gateway_url: str, bearer_token: str
) -> None:
    """``OpenAI().models.list()`` returns the gateway's advertised model.

    Secondary compat check — the SDK's model listing uses a different
    response shape (``SyncPage[Model]``) than the chat endpoint, so a
    regression in one doesn't necessarily break the other.  We assert
    at least one model with id ``hermes-agent`` shows up.
    """
    if read_hermes_agent_cn_health(http_client) is None:
        pytest.skip("gateway health check failed; skipping SDK model-list test")

    try:
        from openai import OpenAI
    except ImportError:
        pytest.skip("openai SDK not installed (pip install openai>=1.0)")

    base_url = gateway_url.rstrip("/") + "/v1"
    client = OpenAI(base_url=base_url, api_key=bearer_token or "dummy-not-used")

    models = client.models.list()
    ids = [m.id for m in models.data]
    assert DEFAULT_MODEL in ids, (
        f"SDK models.list() did not return {DEFAULT_MODEL!r}; got ids={ids!r}"
    )
