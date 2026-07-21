// v0.2-alpha-19 — Chat SSE pipeline (Tauri I/O + S14 usage extraction).
//
// Extracted from main.ts in alpha-19 so the orchestrator can stay thin.
// The module owns:
//
//   1. SSE listeners — listen('hermes-stream-chunk') + listen('hermes-stream-done').
//      Both listeners call internal handlers that push chunks into the
//      chatStore (the Preact <ChatViewWithWelcome /> subscriber picks
//      them up) and finalise the assistant message on done.
//   2. The sendChatMessage() entry point — composes the OpenAI-style
//      messages array (system prompt + recent 10 history rows with
//      multimodal content for the latest user turn), picks a model
//      via pickModelForRequest, and POSTs to hermesPostStream which
//      emits the SSE events we listen for.
//   3. S14 usage extraction — the agent pushes real prompt_tokens /
//      completion_tokens / image_tokens + routing_decision +
//      elapsed_ms on the final chunk; we stash them on module-level
//      lets and persist them via message_record_usage in finishStream.
//
// Dependencies are passed in via `initChatStream(deps)` — pure
// dependency-injection so the module has no direct import on
// main.ts's module-level lets. The 9 getters/setters below are the
// contract surface; everything else is owned internally.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { hermesPostStream } from "./api";
import { chatStore } from "../views/chat-view-store";
import type { ChatMessage, ChatMessageBar } from "../views/chat-view-store";
import { buildMultimodalContent } from "./multimodal";
import { pickModelForRequest } from "./modelPicker";
import { getGatewayUrl } from "./state";
import { CONFIG } from "../config";
import type { Session, Persona } from "../types";

// Re-exported so callers can type their getRecentMessages() return
// value without an extra import.
export type ChatStreamMessage = ChatMessage;

// ── Dependencies contract ──────────────────────────────────────────────────

export interface ChatStreamDeps {
  /** Returns the current session id, or null if no session is active. */
  getCurrentSessionId: () => string | null;
  /** Returns the current session row (used to look up persona_id). */
  getCurrentSession: () => Session | null;
  /** Returns the last N messages for the OpenAI messages array. */
  getRecentMessages: () => ChatStreamMessage[];
  /** Cached persona list for the model picker chain. */
  getPersonasCache: () => Persona[];
  /** Currently-selected model id (from /v1/models response). */
  getCurrentModel: () => string;
  /** User's saved default model from settings (db_config). */
  getDefaultModel: () => string | null;
  /** Currently-selected default persona id (from db_config). */
  getDefaultPersonaId: () => string | null;
  /** Update main.ts's `state.isLoading` flag (drives send button state). */
  setIsLoading: (b: boolean) => void;
  /** Update main.ts's `state.isStreaming` flag (legacy; not used by
   *  the Preact view but kept for any future analytics consumers). */
  setIsStreaming: (b: boolean) => void;
  /** Sync main.ts's `state.messages` mirror after a successful stream
   *  (the next sendChatMessage reads the 10-row recent slice from here). */
  setMessages: (m: ChatStreamMessage[]) => void;
  /** Hook called after the assistant reply finishes — main.ts uses it
   *  to invoke session_touch + refreshCurrentSessionRow for the live
   *  token badge in the sidebar. */
  onAfterReply: () => void;
  /** System prompt composer for the active session. Pure function
   *  but kept as a dep so tests can inject a stub. */
  buildSystemPrompt: () => Promise<string | null>;
}

let deps: ChatStreamDeps | null = null;

// ── Per-stream metadata (captured from final SSE chunk) ────────────────────

let lastStreamUsage: Record<string, unknown> | null = null;
let lastStreamRouting: unknown = null;
let lastStreamElapsedMs: number | null = null;
/** v0.3: actual model id reported by the gateway in SSE chunks.
 *  When hermes-agent routes internally, /v1/models only shows the
 *  proxy entry ("hermes-agent") but each chunk carries the real
 *  downstream model name. Captured so the UI can show it. */
let lastStreamModel: string | null = null;

let unlistenChunk: UnlistenFn | null = null;
let unlistenDone: UnlistenFn | null = null;

// ── Init / dispose ─────────────────────────────────────────────────────────

/**
 * Wire up the SSE listeners. Idempotent — calling twice replaces the
 * previous listeners (the dispose handle is returned and the new
 * one takes over).
 *
 * Returns a dispose handle that the caller invokes on window unload
 * to avoid leaking Tauri event subscriptions.
 */
export async function initChatStream(d: ChatStreamDeps): Promise<() => void> {
  await disposeChatStream();
  deps = d;

  unlistenChunk = await listen<string>("hermes-stream-chunk", (event) => {
    handleStreamChunk(event.payload);
  });
  unlistenDone = await listen("hermes-stream-done", () => {
    void finishStream();
  });

  return disposeChatStream;
}

export async function disposeChatStream(): Promise<void> {
  if (unlistenChunk) {
    await unlistenChunk();
    unlistenChunk = null;
  }
  if (unlistenDone) {
    await unlistenDone();
    unlistenDone = null;
  }
  deps = null;
  // Clear per-stream metadata so the dispose-then-reinit cycle doesn't
  // leak usage data across sessions.
  lastStreamUsage = null;
  lastStreamRouting = null;
  lastStreamElapsedMs = null;
  lastStreamModel = null;
}

/** v0.3: the actual model id from the most recent SSE stream, or null
 *  if the gateway hasn't reported one yet. Used by main.ts to show
 *  the real routed model in the footer pill. */
export function getLastStreamModel(): string | null {
  return lastStreamModel;
}

// ── Stream chunk parser ────────────────────────────────────────────────────

/**
 * Parse one SSE chunk payload (typically one event's worth of text),
 * extract the assistant content delta + S14 usage + routing metadata.
 * Pure function over the `data:` lines; side-effect via chatStore.
 */
export function handleStreamChunk(payload: string): void {
  const lines = payload.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      // v0.3: capture the actual model the gateway used for this
      // response (first chunk carries it in OpenAI-compatible streams).
      if (typeof json.model === "string" && json.model) {
        lastStreamModel = json.model;
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        chatStore.appendStreamChunk(delta);
      }
      // S14-agent: capture the final-chunk usage + routing metadata so
      // finishStream() can persist the real token count (replacing the
      // char/4 heuristic) and surface the routing decision in the
      // stats modal. We hold the *latest* value seen — OpenAI streaming
      // sends usage exactly once at the end, but a few proxies repeat
      // it across chunks and we want the most recent.
      const usage = json.usage;
      if (usage && typeof usage === "object") {
        lastStreamUsage = usage;
        const rd = (usage as Record<string, unknown>).routing_decision;
        if (rd) lastStreamRouting = rd;
        const el = (usage as Record<string, unknown>).elapsed_ms;
        if (typeof el === "number") lastStreamElapsedMs = el;
      }
      // Some agent shapes emit routing_decision at the top level of
      // the final chunk (not nested under usage). Cover that case too.
      const topRd = (json as Record<string, unknown>).routing_decision;
      if (topRd) lastStreamRouting = topRd;
      const topEl = (json as Record<string, unknown>).elapsed_ms;
      if (typeof topEl === "number") lastStreamElapsedMs = topEl;
    } catch {
      /* skip invalid JSON */
    }
  }
}

// ── Stream done (finalise) ────────────────────────────────────────────────

/**
 * Called when the Rust side emits `hermes-stream-done`. Persists the
 * assistant message + S14 usage metadata + invokes session_touch +
 * the post-reply sidebar refresh hook.
 */
export async function finishStream(): Promise<void> {
  if (!deps) return;
  const streamingSnapshot = chatStore.get().streaming;
  if (streamingSnapshot) {
    const finalContent = streamingSnapshot.content;
    // Compute the CLI bar metadata BEFORE we reset the per-stream
    // module-level lets — the S14 final-chunk values are the source
    // of truth for the bar.
    const usage = lastStreamUsage;
    const costUsd = usage && typeof usage.cost_estimate_usd === "number"
      ? usage.cost_estimate_usd : 0;
    const routingObj = (lastStreamRouting ?? {}) as Record<string, unknown>;
    const costThresholdExceeded = routingObj.cost_threshold_exceeded === true;
    const ruleId = typeof routingObj.rule_id === "string" ? routingObj.rule_id : null;
    const bar: ChatMessageBar = {
      costUsd,
      elapsedMs: lastStreamElapsedMs,
      ruleId,
      costThresholdExceeded,
    };
    // Hand the finalised bubble + bar to the Preact view. The store
    // clears its own streaming slot as part of finaliseStream().
    chatStore.finaliseStream(bar);
    deps.setMessages(chatStore.get().messages);

    // Persist assistant message to DB
    const sessionId = deps.getCurrentSessionId();
    if (sessionId) {
      try {
        const appended = await invoke<{ id: string; tokens: number }>("message_append", {
          sessionId,
          role: "assistant",
          content: finalContent,
          toolCalls: null,
        });
        // S14-agent: if the upstream pushed real usage, replace the
        // char/4 heuristic tokens + stash image_tokens / routing_decision
        // on the message metadata so the stats modal can show them.
        if (appended?.id && usage && typeof usage.prompt_tokens === "number") {
          const detail = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
          const imageTokens = typeof detail.image_tokens === "number"
            ? detail.image_tokens : 0;
          const routingJson = lastStreamRouting != null
            ? JSON.stringify(lastStreamRouting) : null;
          await invoke("message_record_usage", {
            id: appended.id,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens ?? 0,
            imageTokens,
            routingDecisionJson: routingJson,
            elapsedMs: lastStreamElapsedMs ?? null,
            costEstimateUsd: costUsd,
            costThresholdExceeded,
          });
        }
      } catch (e) {
        console.error("[DB] save assistant msg failed:", e);
      }
      invoke("session_touch", { id: sessionId }).catch(() => {});
      // T-Q-S9: refresh sidebar row so the token badge updates after
      // each assistant reply. The user sees their spend climbing live.
      deps.onAfterReply();
    }
  }
  deps.setIsLoading(false);
  deps.setIsStreaming(false);
  // S14: clear the per-stream metadata so the next turn starts fresh.
  lastStreamUsage = null;
  lastStreamRouting = null;
  lastStreamElapsedMs = null;
}

// ── Send entry ────────────────────────────────────────────────────────────

/**
 * Kick off a new chat completion. Composes the messages array,
 * picks the model, POSTs to hermesPostStream which starts emitting
 * SSE events. The handleStreamChunk / finishStream listeners (set
 * up via initChatStream) handle the rest asynchronously.
 *
 * Caller is responsible for having pushed the user message into
 * chatStore.appendMessage BEFORE calling this — sendChatMessage only
 * opens the streaming bubble + dispatches the request.
 */
export async function sendChatMessage(): Promise<void> {
  if (!deps) throw new Error("[ChatStream] initChatStream() must be called first");

  deps.setIsLoading(true);
  // v0.2-alpha-16: open the streaming bubble via the store. The Preact
  // <ChatViewWithWelcome /> subscriber picks up the change and renders
  // the empty streaming bubble; subsequent handleStreamChunk calls
  // accumulate content into it.
  deps.setIsStreaming(true);
  chatStore.openStream();

  try {
    // T-Q-S7 + T-Q-S8: prepend a system message that combines the
    // session's persona system_prompt with the cached project context
    // summary. Composed by the dep-provided buildSystemPrompt() so
    // tests can stub it.
    const systemContent = await deps.buildSystemPrompt();
    // T-Q-S14: build multimodal content for the last user message if
    // it has attachments. Older messages in the window are sent as
    // text (their attachments are not re-attached — hermes-agent
    // would need to re-read them from storage, out of MVP scope).
    const recent = deps.getRecentMessages().slice(-10);
    // Find the last user message in the window. We only attach
    // images to the most recent user turn — older ones are sent as
    // text only.
    let lastUserIdx = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].role === "user") { lastUserIdx = i; break; }
    }
    const userMessages = recent.map((m, i) => ({
      role: m.role,
      content: (i === lastUserIdx && m.attachments && m.attachments.length > 0)
        ? buildMultimodalContent(m.content, m.attachments)
        : m.content,
    }));
    const apiMessages = systemContent === null
      ? userMessages
      : [{ role: "system" as const, content: systemContent }, ...userMessages];

    // Use streaming — response is empty, chunks via events
    // T-Q-S12-light: model priority chain. See `pickModelForRequest`
    // for the pure function and its tests. hermes-agent handles
    // routing/retries; tray just sends the name.
    const session = deps.getCurrentSession();
    const persona = session?.persona_id
      ? deps.getPersonasCache().find((p) => p.id === session.persona_id) ?? null
      : null;
    const model = pickModelForRequest(
      persona,
      deps.getCurrentModel(),
      deps.getDefaultModel(),
      CONFIG.defaultModel,
    );
    await hermesPostStream("/v1/chat/completions", {
      model,
      messages: apiMessages,
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature,
      stream: true,
    });
  } catch (error) {
    deps.setIsStreaming(false);
    console.error("Send message error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    // v0.2-alpha-16: discard the half-written streaming bubble (the
    // store clears its slot) and surface the error through the
    // store's error channel — the Preact view renders a red error
    // bubble.
    chatStore.abortStream();
    chatStore.setError(`连接失败: ${errorMsg} (${getGatewayUrl()})`);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────

/** Test-only: lets the test suite reset module-level state. */
export function __resetForTests(): void {
  lastStreamUsage = null;
  lastStreamRouting = null;
  lastStreamElapsedMs = null;
  lastStreamModel = null;
  deps = null;
}