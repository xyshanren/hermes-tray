// v0.2-alpha-3 — Hermes Gateway HTTP helpers (formerly inline in main.ts).
//
// Two RPC-style entry points + one header helper:
//   - hermesGet(path):          GET through Rust proxy, returns HermesResponse.
//   - hermesPostStream(path, body): POST through Rust streaming proxy.
//   - authHeaders():            for inline invoke calls that need the same
//                               Authorization header (e.g. audio transcribe).
//
// Why these go through a Rust proxy command instead of fetch() directly:
//   - CORS: WebView can't bypass gateway CORS in dev.
//   - Streaming: hermes_proxy_post_stream handles SSE chunk piping + event
//     emission, which raw fetch + ReadableStream can't match for our event
//     protocol.
//
// All three functions read gatewayUrl + apiKey via `./state` so callers don't
// need to thread the values around.

import { invoke } from "@tauri-apps/api/core";
import { getGatewayUrl, getApiKey } from "./state";
import type { HermesResponse } from "../types";

/** Build Authorization headers for inline invoke() calls. */
export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getApiKey()}` };
}

/** GET `${gatewayUrl}${path}` via the Rust proxy. */
export async function hermesGet(path: string): Promise<HermesResponse> {
  return await invoke<HermesResponse>("hermes_proxy_get", {
    url: `${getGatewayUrl()}${path}`,
    headers: authHeaders(),
  });
}

/** POST `${gatewayUrl}${path}` via the Rust streaming proxy (SSE events emitted separately). */
export async function hermesPostStream(path: string, body: object): Promise<void> {
  return await invoke<void>("hermes_proxy_post_stream", {
    url: `${getGatewayUrl()}${path}`,
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}