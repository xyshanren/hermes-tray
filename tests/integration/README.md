# hermes-tray integration tests

Smoke tests that verify the wire-level contract between **hermes-tray**
(the Tauri desktop tray) and **hermes-agent-cn** (the Python aiohttp
gateway that runs on `127.0.0.1:8642`).

These tests hit the live gateway from a regular Python process — they
do **not** spin up hermes-tray itself.  The Rust proxy commands
(`hermes_proxy_get` / `hermes_proxy_post` / `hermes_proxy_post_stream`
in `src-tauri/src/lib.rs`) are simple pass-throughs that forward
`url + headers + body` to the gateway, so testing the network surface
is sufficient to prove the integration works.

## What is covered

| Test                          | Endpoint           | Purpose                                                |
| ----------------------------- | ------------------ | ------------------------------------------------------ |
| `test_health_endpoint`        | `GET /health`      | Gateway is alive; no auth required.                    |
| `test_models_endpoint`        | `GET /v1/models`   | Returns an OpenAI-shaped model list with a hermes id.  |
| `test_capabilities_endpoint`  | `GET /v1/capabilities` | Advertises `chat_completions=true` (frontend needs this). |
| `test_conftest_health_helper` | (helper)           | The `read_hermes_agent_cn_health` helper stays sane.    |

If the gateway is not reachable, the **entire suite is skipped** (not
failed) so a developer with the gateway temporarily stopped still gets
a clean exit code.

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
tests/integration/test_smoke.py::test_health_endpoint        PASSED
tests/integration/test_smoke.py::test_models_endpoint       PASSED
tests/integration/test_smoke.py::test_capabilities_endpoint PASSED
tests/integration/test_smoke.py::test_conftest_health_helper PASSED
========= 4 passed in 0.4s =========
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

## Files

| File                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `conftest.py`       | Fixtures: gateway URL, bearer token, HTTP client, skip-if-down. |
| `test_smoke.py`     | The 4 tests.                                           |
| `pytest.ini`        | Pytest discovery config + `integration` marker.        |
| `requirements.txt`  | `pytest>=7`, `httpx>=0.27`.                            |
| `README.md`         | This file.                                             |
