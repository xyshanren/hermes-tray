// v0.2-alpha-3 — Frontend runtime state (formerly module-level let bindings in main.ts).
//
// Holds the two pieces of mutable state that hermesGet / hermesPostStream /
// audio transcribe need at call time:
//   - gatewayUrl: resolved at boot via hermes_resolve_gateway_ip, replaced again
//     when the user changes distro/port in the settings modal.
//   - apiKey: loaded from config at boot, replaced again when the user edits it
//     in settings.
//
// Read via getters; write via setters. Keeps callers from mutating module
// internals directly, and makes it trivial to mock in tests (vi.spyOn / module
// reset between tests).

import { invoke } from "@tauri-apps/api/core";
import type { GatewayInfo } from "../types";

const DEFAULT_API_KEY = "hermes-local-dev-key";
const FALLBACK_GATEWAY_URL = "http://172.31.98.230:8642";

let gatewayUrl = "";
let apiKey = DEFAULT_API_KEY;

export function getGatewayUrl(): string {
  return gatewayUrl;
}

export function setGatewayUrl(url: string): void {
  gatewayUrl = url;
}

export function getApiKey(): string {
  return apiKey;
}

export function setApiKey(key: string): void {
  apiKey = key;
}

/**
 * Resolve the gateway URL via the Rust-side `hermes_resolve_gateway_ip` command.
 * On failure (no WSL, IPC down), fall back to a dev default so the rest of the
 * app can still try to connect.
 *
 * @returns the resolved (or fallback) gateway URL.
 */
export async function resolveGatewayUrl(): Promise<string> {
  try {
    const info = await invoke<GatewayInfo>("hermes_resolve_gateway_ip");
    setGatewayUrl(info.url);
  } catch {
    setGatewayUrl(FALLBACK_GATEWAY_URL);
  }
  return getGatewayUrl();
}

/**
 * Apply a port override to the currently-resolved gateway URL (no-op if URL is
 * empty or already uses that port). Centralized here so settings save + boot
 * stay in sync.
 */
export function applyPortOverride(port: number | string | null | undefined): void {
  const current = getGatewayUrl();
  if (!current || !port) return;
  setGatewayUrl(current.replace(/:\d+$/, `:${port}`));
}

/** Test-only: reset to module defaults. Not exported via index. */
export function __resetForTests(): void {
  gatewayUrl = "";
  apiKey = DEFAULT_API_KEY;
}