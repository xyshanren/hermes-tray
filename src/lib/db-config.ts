// v0.2-alpha-19 — db_config load/save helpers.
//
// Extracted from main.ts (alpha-19 main.ts cleanup). All access to
// the Rust `db_config_get` / `db_config_set` Tauri commands goes
// through this module so call sites get consistent error handling +
// the "empty string = unset" convention used by CONFIG_SCHEMA keys
// (alpha-13).
//
// The returned strings are trimmed before return so callers don't have
// to. Errors are logged via console.warn (best-effort: a missing
// config key shouldn't crash boot).

import { invoke } from "@tauri-apps/api/core";

interface ConfigEntry {
  key: string;
  value: string;
}

/** Raw key/value accessor. Returns null if the key is unset or the
 *  Rust call throws. The value is NOT trimmed here — callers handle
 *  that per-key (some keys are JSON, some are booleans, etc.). */
export async function getConfig(key: string): Promise<string | null> {
  try {
    const entry = await invoke<ConfigEntry | null>("db_config_get", { key });
    return entry?.value ?? null;
  } catch (e) {
    console.warn(`[db-config] ${key} not loaded:`, e);
    return null;
  }
}

/** Raw key/value setter. Logs on error but never throws. */
export async function setConfig(key: string, value: string): Promise<void> {
  try {
    await invoke("db_config_set", { key, value });
  } catch (e) {
    console.warn(`[db-config] ${key} not saved:`, e);
  }
}

/**
 * Trimmed string accessor. Returns null when the stored value is
 * empty/whitespace. Use this for path / id / model-id style prefs
 * where "" is semantically "unset" (CONFIG_SCHEMA convention).
 */
export async function getConfigString(key: string): Promise<string | null> {
  const raw = await getConfig(key);
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Typed convenience accessors ────────────────────────────────────────────
//
// These were the three "load default X" functions inlined in main.ts.
// Each one calls db_config_get with a specific key + applies the
// "empty = null" convention. Adding a new default pref just means
// adding a new typed accessor here + an entry in CONFIG_SCHEMA
// (src/lib/config-schema.ts).

const KEY_DEFAULT_PROJECT_PATH = "default_project_path";
const KEY_DEFAULT_MODEL = "default_model";
const KEY_DEFAULT_PERSONA_ID = "default_persona_id";

export async function loadDefaultProjectPath(): Promise<string | null> {
  return getConfigString(KEY_DEFAULT_PROJECT_PATH);
}

export async function loadDefaultModel(): Promise<string | null> {
  return getConfigString(KEY_DEFAULT_MODEL);
}

export async function loadDefaultPersonaId(): Promise<string | null> {
  // We don't trim persona id — the value is a uuid, never empty.
  return getConfig(KEY_DEFAULT_PERSONA_ID);
}

export async function setDefaultPersonaId(id: string | null): Promise<void> {
  // Empty string = "no default" (the picker treats empty/missing
  // the same). The Rust side doesn't have a "delete key" command,
  // so empty-string is the closest analog.
  await setConfig(KEY_DEFAULT_PERSONA_ID, id ?? "");
}

// ── Test helpers ──────────────────────────────────────────────────────────

/** Test-only: lets the test suite reset module-level state (none
 *  currently — pure-function module, but kept for symmetry with
 *  other lib modules). */
export function __resetForTests(): void {
  /* no-op */
}