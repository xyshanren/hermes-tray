// v0.2-alpha-19 — Model picker chain (T-Q-S12-light).
//
// Pure function extracted from main.ts in alpha-19 so the chat-stream
// module can import it directly. Priority chain (highest first):
//   1. persona.model — pinned model on the active persona
//   2. currentModel — set by /v1/models response or user override
//   3. defaultModel — user-saved in settings (DB config key)
//   4. legacyDefault — hardcoded legacy fallback
//
// `currentModel` is the sentinel UNKNOWN_MODEL ("-") when the gateway
// hasn't reported any. Pure function for testability — see
// src/modelPicker.test.ts (8 cases).

export function pickModelForRequest(
  persona: { model: string | null } | null,
  currentModel: string,
  defaultModel: string | null,
  legacyDefault: string,
): string {
  if (persona?.model) return persona.model;
  if (currentModel && currentModel !== "-") return currentModel;
  if (defaultModel) return defaultModel;
  return legacyDefault;
}