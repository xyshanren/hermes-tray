// v0.2-alpha-16 — Chat view pure formatters.
//
// These helpers were originally inlined in src/main.ts. They have no
// side effects and don't touch the DOM, so they belong in src/lib/ for
// unit-test coverage (the messageBar + routingTrace test files already
// imported them from src/main.ts via the re-export below).
//
// Why a dedicated module instead of keeping them in main.ts:
//   - alpha-16 splits the chat view into a Preact component that imports
//     formatters directly (no need to plumb them through main.ts).
//   - alpha-17 will likely split the streaming chunk handler into a
//     helper; these formatters are the leaf layer it will consume.
//
// Backward compatibility: src/main.ts re-exports `formatMessageBar`,
// `formatRoutingTrace`, and `formatLatencyMs` from this module so the
// existing src/messageBar.test.ts + src/routingTrace.test.ts suites
// keep importing from src/main.ts without changes.

import { marked } from "marked";

/**
 * Render an assistant message body as HTML. We use `marked` for full
 * GFM support (tables, code blocks with syntax highlighting, etc.).
 * User messages are rendered as plain text in the MessageBubble
 * component (no markdown — `<user content>` would be a security risk).
 */
export function formatMessage(content: string): string {
  return marked.parse(content) as string;
}

/**
 * v0.1.5 S12: pure formatter for the per-turn CLI bar (💰 cost ·
 * ⏱ latency · 🛡 rule). The bar appears under each assistant message
 * so the user sees the per-turn routing cost at a glance.
 *
 * Pure function — tested in src/messageBar.test.ts (12 cases).
 */
export function formatMessageBar(args: {
  costUsd: number;
  elapsedMs: number | null;
  ruleId: string | null;
  costThresholdExceeded: boolean;
}): string | null {
  const parts: string[] = [];
  if (args.costUsd > 0) {
    parts.push(`💰 $${args.costUsd.toFixed(4)}`);
  }
  if (args.elapsedMs != null && args.elapsedMs > 0) {
    parts.push(`⏱ ${formatLatencyMs(args.elapsedMs)}`);
  }
  if (args.ruleId) {
    parts.push(`🛡 ${args.ruleId}`);
  } else if (args.costThresholdExceeded) {
    // Threshold was tripped but the agent didn't surface a rule_id —
    // surface the breach anyway so the user can see something fired.
    parts.push(`🛡 cost_threshold_exceeded`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/**
 * DOM wrapper around `formatMessageBar`. Returns the
 * `<div class="message-bar">` element (with the `-warn` modifier when
 * the S12 cost-aware fallback flagged a budget overrun), or null when
 * the bar would be empty.
 *
 * Kept here (rather than in the Preact view) because the caller in
 * main.ts (finishStream) still appends the bar imperatively to the
 * message DOM during the streaming finalization path. alpha-17 will
 * move the append into the Preact component once streaming is fully
 * migrated.
 */
export function buildMessageBar(args: {
  costUsd: number;
  elapsedMs: number | null;
  ruleId: string | null;
  costThresholdExceeded: boolean;
}): HTMLElement | null {
  const text = formatMessageBar(args);
  if (text == null) return null;
  const div = document.createElement("div");
  div.className = "message-bar";
  if (args.costThresholdExceeded) div.classList.add("message-bar-warn");
  div.textContent = text;
  return div;
}

/**
 * S14-agent: turn the routing_decision JSON blob into a one-line trace
 * for the stats modal. The agent pushes a structured dict like:
 *   { mode: "native" | "text", primary_provider, primary_model,
 *     resolved_provider, resolved_model, fallback_used, fallback_reason,
 *     fallback_provider, fallback_model }
 * We render the bits the user cares about and ignore unknown fields so
 * future agent-side additions don't break the UI.
 *
 * Pure function — tested in src/routingTrace.test.ts (8 cases).
 */
export function formatRoutingTrace(blob: string | null): string {
  if (!blob) return "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(blob) as Record<string, unknown>;
  } catch {
    return "";
  }
  const mode = typeof parsed.mode === "string" ? parsed.mode : null;
  const provider = typeof parsed.resolved_provider === "string" ? parsed.resolved_provider : null;
  const model = typeof parsed.resolved_model === "string" ? parsed.resolved_model : null;
  const fallbackUsed = parsed.fallback_used === true;
  const fallbackReason = typeof parsed.fallback_reason === "string" ? parsed.fallback_reason : null;
  const fallbackProvider = typeof parsed.fallback_provider === "string" ? parsed.fallback_provider : null;
  if (fallbackUsed && fallbackProvider) {
    return `vision fallback: ${provider}/${model} (primary ${fallbackReason ?? "unavailable"})`;
  }
  if (mode && provider) {
    return `vision ${mode}: ${provider}/${model}`;
  }
  return "";
}

/** S14-agent: render elapsed_ms as a human latency string. */
export function formatLatencyMs(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}