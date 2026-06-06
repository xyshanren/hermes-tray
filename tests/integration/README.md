# hermes-tray integration tests

Integration tests that verify the wire-level contract between
**hermes-tray** (the Tauri desktop tray) and **hermes-agent-cn** (the
Python aiohttp gateway that runs on `127.0.0.1:8642`).

These tests hit the live gateway from a regular Python process — they
do **not** spin up hermes-tray itself.  The Rust proxy commands
(`hermes_proxy_get` / `hermes_proxy_post` / `hermes_proxy_post_stream`
in `src-tauri/src/lib.rs`) are simple pass-throughs that forward
`url + headers + body` to the gateway, so testing the network surface
is sufficient to prove the integration works.  See
`test_hermes_tray_compat.py::test_proxy_commands_are_passthroughs`
for the static check that pins the pass-through contract.

## What is covered

| Scenario | Test file | What it verifies |
| -------- | --------- | ---------------- |
| 1. Smoke | `test_smoke.py` | `/health`, `/v1/models`, `/v1/capabilities`, helper sanity. |
| 2. Non-streaming chat | `test_chat.py::test_chat_completion_non_streaming` | POST `/v1/chat/completions` with `stream:false` returns an OpenAI-shape `chat.completion` object with non-empty content. |
| 3. Streaming chat (SSE) | `test_chat.py::test_chat_completion_streaming_sse` | POST `/v1/chat/completions` with `stream:true` returns a `text/event-stream` whose `data:` lines parse as OpenAI chunks; the stream terminates with a `[DONE]` sentinel and the final chunk carries `usage`. |
| 3a. SSE keepalive | `test_chat.py::test_sse_parser_handles_keepalive` | The custom SSE parser surfaces `: keepalive` comment lines as `kind="keepalive"` events without dropping the surrounding data. |
| 4. OpenAI SDK compat | `test_openai_compat.py` | The official `openai` Python SDK (≥1.0) can call `/v1/chat/completions` and list `/v1/models` against the gateway. |
| 5. Error paths | `test_errors.py` | 5 sub-cases for `/v1/chat/completions` returning HTTP 400 with the OpenAI-shape `{"error": {"message": ..., "type": "invalid_request_error"}}` envelope, plus a 401 case for the wrong bearer token. |
| 6. Concurrent streams | `test_concurrent.py` | 3 parallel streaming calls (asyncio + `httpx.AsyncClient`) all succeed, the reconstructed texts are distinct (no cross-talk), and wall time is under 3 × single-request budget (catches accidental server-side serialization). |
| 7. hermes-tray 端到端对照 | `test_hermes_tray_compat.py` | (a) Static check that the Rust `hermes_proxy_*` commands are pass-throughs registered in `invoke_handler!`; (b) GET `/v1/models` with the exact `Authorization: Bearer ...` header `src/main.ts::hermesGet` builds; (c) Streaming chat with the exact request shape `src/main.ts::sendMessage` builds, parsed through the same `split('\n')` logic the frontend's `handleStreamChunk` uses. |
| 8. Multi-turn | `test_chat.py::test_chat_completion_multi_turn` | 5 alternating user/assistant messages → 200 + non-empty content from the last turn. |

If the gateway is not reachable, the **entire suite is skipped** (not
failed) so a developer with the gateway temporarily stopped still gets
a clean exit code.

## File layout

| File | Purpose |
| ---- | ------- |
| `conftest.py` | Pytest fixtures: `gateway_url`, `bearer_token`, `http_client`, session-scope skip-if-gateway-down. |
| `sse_helpers.py` | Shared utilities: `SSEEvent` dataclass, `iter_sse_events` parser, `collect_sse_chunks`, `post_chat_completion`, hermes-tray wire-shape helpers, truncation diagnostic. |
| `test_smoke.py` | Scenario 1 (4 tests). |
| `test_chat.py` | Scenarios 2, 3, 3a, 8 (4 tests). |
| `test_openai_compat.py` | Scenario 4 (2 tests). |
| `test_errors.py` | Scenario 5 (7 tests including parametrized + 401). |
| `test_concurrent.py` | Scenario 6 (1 test driving 3 parallel streams). |
| `test_hermes_tray_compat.py` | Scenario 7 (3 tests: static + GET + streaming). |
| `pytest.ini` | Pytest discovery config + `integration` marker. |
| `requirements.txt` | `pytest>=7.0`, `httpx>=0.27`, `openai>=1.0`, `httpx-sse>=0.4` (the last is informational only — the suite rolls its own parser). |
| `README.md` | This file. |
| `.last-run.log` | Output of the most recent `python -m pytest -v` run, for quick triage. |

## Running the suite

### 1. Install test dependencies

```bash
# from this directory (tests/integration/)
python -m venv .venv-tests
# Windows:
.venv-tests\Scripts\activate
# WSL / Linux / macOS:
source .venv-tests/bin/activate

pip install -r requirements.txt
```

Python 3.10+ is required (matches the user's hermes-agent-cn setup).

### 2. Make sure the gateway is up

```bash
curl http://127.0.0.1:8642/health
# expected: {"status": "ok", "platform": "hermes-agent"}
```

If you get a connection refused, start hermes-agent-cn first.

### 3. Run the tests

```bash
python -m pytest -v
```

Expected output (truncated):

```
test_chat.py::test_chat_completion_non_streaming         PASSED
test_chat.py::test_chat_completion_streaming_sse          PASSED
test_chat.py::test_sse_parser_handles_keepalive           PASSED
test_chat.py::test_chat_completion_multi_turn             PASSED
test_concurrent.py::test_three_concurrent_streaming_requests PASSED
test_errors.py::test_chat_completion_400_on_bad_input[...] PASSED  (5 cases)
test_errors.py::test_chat_completion_400_on_malformed_json PASSED
test_errors.py::test_chat_completion_401_on_bad_bearer    PASSED
test_hermes_tray_compat.py::test_proxy_commands_are_passthroughs PASSED
test_hermes_tray_compat.py::test_hermes_tray_shaped_get_models    PASSED
test_hermes_tray_compat.py::test_hermes_tray_shaped_stream_matches_frontend_parser PASSED
test_openai_compat.py::test_openai_sdk_non_streaming_compat PASSED
test_openai_compat.py::test_openai_sdk_list_models_compat  PASSED
test_smoke.py::test_health_endpoint                       PASSED
test_smoke.py::test_models_endpoint                       PASSED
test_smoke.py::test_capabilities_endpoint                 PASSED
test_smoke.py::test_conftest_health_helper                PASSED
=========== 21 passed in ~15s ===========
```

## Configuration via environment variables

| Variable               | Default                       | Notes                                            |
| ---------------------- | ----------------------------- | ------------------------------------------------ |
| `GATEWAY_URL`          | `http://127.0.0.1:8642`        | Override to test against a remote gateway.       |
| `GATEWAY_BEARER_TOKEN` | `hermes-local-dev-key`        | Matches the hard-coded token in `src/main.ts`. Set to empty string to skip sending the `Authorization` header (matches the gateway's "no API_SERVER_KEY configured" branch). |

Examples:

```bash
# Point at a remote gateway
GATEWAY_URL=http://192.0.2.10:8642 python -m pytest -v

# Gateway has no API key configured (anonymous mode)
GATEWAY_BEARER_TOKEN= python -m pytest -v

# Gateway uses a non-default key
GATEWAY_BEARER_TOKEN=my-strong-key python -m pytest -v
```

## Why pytest (not vitest / cargo test)?

* hermes-agent-cn is a Python service; the natural test environment
  is the same Python interpreter the gateway runs in.
* The tests are about the **integration contract** between two
  processes, not about hermes-tray's internal Rust/TS units.  The
  Rust unit tests already in `src-tauri/src/lib.rs` cover hermes-tray
  itself; the frontend TS is covered by vitest in `vitest.config.ts`.
* pytest + httpx is the smallest dependency surface that proves the
  wire works.

## Wire-shape contract summary (for triage)

The exact shapes this suite pins are documented inline in the test
files; here's the short version for quick reference:

* **Auth header**: `Authorization: Bearer hermes-local-dev-key`
  (matches `src/main.ts:44`).
* **Non-stream response** (`POST /v1/chat/completions`,
  `stream:false`):
  ```json
  {
    "id": "chatcmpl-...",
    "object": "chat.completion",
    "created": 1700000000,
    "model": "hermes-agent",
    "choices": [
      {"index": 0, "message": {"role": "assistant", "content": "..."}, "finish_reason": "stop"}
    ],
    "usage": {"prompt_tokens": N, "completion_tokens": M, "total_tokens": N+M}
  }
  ```
* **Stream response** (`stream:true`): one or more
  `data: {json}\n\n` chunks + a final `data: [DONE]\n\n` sentinel.
  Each chunk has the same `id`/`created`/`model` and a `choices[0]`
  whose `delta` carries either `{"role": "assistant"}` (first),
  `{"content": "..."}` (middle), or `{}` (last).  The terminal
  *non-DONE* chunk carries `usage`.
* **Error envelope** (4xx):
  `{"error": {"message": "...", "type": "invalid_request_error", "code": "..."}}`.
* **Auth fail (401)**: same envelope with `code: "invalid_api_key"`.
