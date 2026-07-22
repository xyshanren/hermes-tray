// v0.2 — Runtime config and constants extracted from main.ts.
// Pure constants only — no logic. Safe to import anywhere.

/**
 * Sentinel value used by main.ts when the gateway hasn't reported
 * any model yet. Display "-" in the UI rather than an empty string.
 */
export const UNKNOWN_MODEL = '-';

/**
 * Session list pagination.
 */
export const SESSION_PAGE = 50;

/**
 * T-Q-S14 attachment limits.
 * 10MB per image × 4 per message is a sane UX trade-off.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 4;

/**
 * T-Q-S13 voice capture cap. 1 minute keeps uploads sane.
 */
export const VOICE_MAX_MS = 60_000;

/**
 * App-wide configuration object. Read once at boot; mutated by the
 * settings modal (auto-save pattern in v0.2 Phase 7).
 */
export const CONFIG = {
  maxTokens: 4000,
  temperature: 0.7,
  defaultModel: 'hermes-agent',
  /** Fallback when no persona is pinned and gateway hasn't reported a model. */
  legacyDefault: 'hermes-agent',
  /** Hero tray icon title (top bar brand) — mirrors tauri.conf.json productName */
  productName: 'Hermes 助手',
  /** DB config keys (T-Q-S7 / S12-light / Phase 7) */
  configKeys: {
    defaultPersonaId: 'default_persona_id',
    defaultModel: 'default_model',
    defaultProjectPath: 'default_project_path',
    // v0.2 Phase 7 — new fields
    theme: 'theme',                    // 'light' | 'dark' | 'system'
    currency: 'currency',              // 'CNY' | 'USD' | 'auto'
    autoConnect: 'auto_connect',       // 'true' | 'false'
    autoRename: 'auto_rename',         // 'true' | 'false'
    sortOrder: 'sort_order',           // 'recent' | 'created' | 'messages'
  },
} as const;

/**
 * Theme storage keys.
 */
export const THEME_STORAGE_KEY = 'hermes-theme'; // 'light' | 'dark' | 'system'