// v0.2-alpha-19 — Boot-time gateway + config initialisation.
//
// Extracted from main.ts DOMContentLoaded. Reads the saved config
// from the Rust side (legacy hermes_get_config command for the api_key
// + port, plus db_config for everything added in alpha-13) and
// applies it to the runtime state.
//
// Runtime side-effects (all of which are already module-level lets in
// src/lib/state.ts):
//   - resolveGatewayUrl(): populates the hermes gateway URL
//   - setApiKey(key): populates the auth header
//   - applyPortOverride(port): biases the auto-resolved URL
//
// This module is pure glue — no React/Preact, no DOM. main.ts calls
// applyBootConfig() once at the top of DOMContentLoaded.

import { invoke } from "@tauri-apps/api/core";
import { resolveGatewayUrl, setApiKey, applyPortOverride } from "./state";

/**
 * Resolve the gateway URL + apply the saved API key + port override.
 * Returns the resolved URL for logging.
 *
 * Best-effort: errors are logged via console.warn and never thrown
 * (the gateway may legitimately be unreachable at boot — we let the
 * periodic health-check pick that up later).
 */
export async function applyBootConfig(): Promise<string> {
  const resolvedUrl = await resolveGatewayUrl();
  console.log("[Hermes] Gateway resolved:", resolvedUrl);
  try {
    const config = await invoke<Record<string, unknown>>("hermes_get_config");
    if (typeof config.api_key === "string" && config.api_key) {
      setApiKey(config.api_key);
    }
    if (typeof config.port === "number" && config.port) {
      applyPortOverride(config.port);
    }
  } catch (e) {
    // legacy hermes_get_config may not exist on a fresh install or
    // may have been migrated away. We log and continue — the
    // periodic health check will surface connectivity issues.
    console.warn("[Boot] hermes_get_config not loaded:", e);
  }
  return resolvedUrl;
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function __resetForTests(): void {
  /* no module-level state to reset */
}