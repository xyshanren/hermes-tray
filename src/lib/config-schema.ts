// v0.2-alpha-13 — Frontend config-keys schema for db_config table.
//
// The db_config table is a generic key-value store; Rust doesn't enforce
// a schema for the keys. This module is the front-end source of truth
// for which keys we read/write, their TypeScript types, default values,
// and (where relevant) the set of allowed values.
//
// Adding a new preference? Add a row here, then drive it from the
// SettingsModal form. The settings-modal will:
//   1. Read the value via db_config_get on load.
//   2. Fall back to this default if the key is unset.
//   3. Validate against allowedValues (if defined) before saving.
//   4. Persist via db_config_set on save.
//
// Pre-existing keys (theme, default_project_path, default_model) are
// defined here too — single source of truth for the whole config table.

// ── Type definitions ──────────────────────────────────────────────────────

export type Currency = "CNY" | "USD" | "model";
export type SortOrder = "recent" | "created" | "name";

export interface ConfigKeyDef<T extends string = string> {
  /** The db_config primary key. */
  key: string;
  /** Default value used when the key is unset. */
  defaultValue: T;
  /** Allowed values for validation. Omit for free-form strings. */
  allowedValues?: readonly T[];
  /** Human-readable label for UI. */
  label: string;
}

// ── Schema ────────────────────────────────────────────────────────────────

export const CONFIG_SCHEMA = {
  theme: {
    key: "theme",
    defaultValue: "system",
    allowedValues: ["light", "dark", "system"],
    label: "主题",
  },
  default_project_path: {
    key: "default_project_path",
    defaultValue: "",
    label: "默认项目路径",
  },
  default_model: {
    key: "default_model",
    defaultValue: "",
    label: "默认模型",
  },
  // ── NEW in alpha-13 (SVG 11 "偏好" section) ─────────────────────────────
  currency: {
    key: "currency",
    defaultValue: "CNY",
    allowedValues: ["CNY", "USD", "model"],
    label: "费用货币",
  },
  auto_connect: {
    key: "auto_connect",
    defaultValue: "true",
    allowedValues: ["true", "false"],
    label: "启动时自动连接",
  },
  auto_rename: {
    key: "auto_rename",
    defaultValue: "true",
    allowedValues: ["true", "false"],
    label: "自动生成会话名",
  },
  sort_order: {
    key: "sort_order",
    defaultValue: "recent",
    allowedValues: ["recent", "created", "name"],
    label: "会话列表排序",
  },
} as const satisfies Record<string, ConfigKeyDef>;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Coerce a raw db_config value (always a string) into the right TS type
 * for a known schema key. Falls back to the key's default if the value
 * is empty or not in allowedValues.
 */
export function coerceConfigValue<K extends keyof typeof CONFIG_SCHEMA>(
  key: K,
  raw: string | null | undefined,
): (typeof CONFIG_SCHEMA)[K]["defaultValue"] {
  const def = CONFIG_SCHEMA[key];
  const fallback = def.defaultValue;
  if (raw == null || raw === "") return fallback;
  if ("allowedValues" in def && def.allowedValues) {
    if ((def.allowedValues as readonly string[]).includes(raw)) {
      return raw as (typeof CONFIG_SCHEMA)[K]["defaultValue"];
    }
    return fallback;
  }
  return raw as (typeof CONFIG_SCHEMA)[K]["defaultValue"];
}

/**
 * Parse a string-typed boolean preference ("true" / "false") to a real
 * boolean. Defaults to false when the value is anything else.
 */
export function parseBoolPref(raw: string | null | undefined): boolean {
  return raw === "true";
}

/** Serialize a boolean preference into the "true" / "false" string form. */
export function formatBoolPref(value: boolean): string {
  return value ? "true" : "false";
}