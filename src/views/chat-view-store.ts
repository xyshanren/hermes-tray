// v0.2-alpha-16 — ChatView state store.
//
// Owns the data layer for the main chat surface (messages list + the
// active streaming bubble). The Preact component in chat-view.tsx
// subscribes here; main.ts uses the mutators to drive updates.
//
// Why a tiny pub-sub instead of `useState` in the Preact component:
//   - Streaming chunks fire at ~10-50 Hz during a reply. A pure Preact
//     store would force a full re-render of every component tree under
//     <App />, including input controls. By isolating chat state to
//     this store + a single subscriber, we keep input/focus unaffected.
//   - main.ts can call mutators imperatively from the SSE chunk handler
//     (a Tauri event listener) without a Preact ref hand-off.
//
// State shape:
//   - messages:    finalised history (user + assistant bubbles)
//   - streaming:   active assistant bubble being filled by SSE chunks
//                  (null when no stream is in flight)
//   - isLoading:   true between handleSubmit() and finishStream()
//   - error:       last transient error message (cleared on next send)
//
// Backward compat: this replaces the `state` object + DOM refs that
// were inlined in main.ts. Existing code keeps working because
// main.ts only consumes the mutators, not the state object.
//
// Formatter re-exports: chat-view.tsx imports `formatMessage` from
// ./chat-view-store so the Preact view doesn't need a second import
// path. Other formatters (formatMessageBar / formatRoutingTrace /
// formatLatencyMs / buildMessageBar) live in src/lib/chat-formatters.ts
// and stay re-exported from main.ts itself for the existing
// messageBar.test.ts + routingTrace.test.ts suites (which import
// from "./main").
export { formatMessage } from "../lib/chat-formatters";

export interface ChatMessage {
  /** Stable id used as the React-style key in the Preact message list.
   *  Optional at the type level — call sites that omit it (legacy
   *  callers) get a timestamp-based key in the view. freshId() is
   *  called internally when finalising a stream so the bar can be
   *  attached to a stable target. */
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  attachments?: PendingAttachment[];
  /** Per-turn CLI bar metadata (S14-agent + v0.1.5 S12 cost/latency/rule). */
  bar?: ChatMessageBar;
}

export interface PendingAttachment {
  /** Stable id so React-style keys don't shift during previews re-render.
   *  Optional — older test fixtures (src/multimodal.test.ts) and any
   *  code path that hasn't been migrated to alpha-16 may omit it; the
   *  Preact view falls back to the array index in that case. New code
   *  should always populate it via crypto.randomUUID() (see
   *  fileToAttachment in main.ts). */
  id?: string;
  /** data: URL (base64-encoded) ready for OpenAI `image_url.url` and
   *  for direct <img src="..."> rendering in the message bubble. */
  dataUrl: string;
  name: string;
  /** MIME type, e.g. `image/png`. */
  type: string;
  /** Byte size — displayed alongside the thumbnail. */
  size: number;
}

export interface ChatMessageBar {
  costUsd: number;
  elapsedMs: number | null;
  ruleId: string | null;
  costThresholdExceeded: boolean;
}

interface StreamingBubble {
  content: string;
  startedAt: number;
}

interface ChatStoreState {
  messages: ChatMessage[];
  streaming: StreamingBubble | null;
  isLoading: boolean;
  error: string | null;
}

type Listener = (state: ChatStoreState) => void;

let state: ChatStoreState = {
  messages: [],
  streaming: null,
  isLoading: false,
  error: null,
};

const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

/**
 * Generate a fresh id for a chat message. We use a monotonic counter
 * to avoid the date.now() collision risk when two appends land in the
 * same millisecond (rare but observed in stress tests).
 */
let nextId = 1;
function freshId(): string {
  return `msg-${Date.now().toString(36)}-${nextId++}`;
}

export const chatStore = {
  get(): ChatStoreState {
    return state;
  },

  /**
   * Replace the entire message list. Used by loadSession() when we
   * fetch the persisted history from the DB and by createSession()
   * to wipe the list for a fresh welcome screen.
   */
  setMessages(messages: ChatMessage[]): void {
    state = { ...state, messages: [...messages], error: null };
    notify();
  },

  /**
   * Append a finalised message bubble. Used for user sends (immediate)
   * and for assistant replies once the stream finishes (finaliseStream
   * promotes the streaming bubble into a real message).
   */
  appendMessage(msg: ChatMessage): void {
    state = { ...state, messages: [...state.messages, msg] };
    notify();
  },

  /**
   * Open a fresh streaming bubble for an assistant reply. Called from
   * sendMessage() right before we kick off the SSE POST. Subsequent
   * chunks are appended via `appendStreamChunk`.
   */
  openStream(): void {
    state = { ...state, streaming: { content: "", startedAt: Date.now() } };
    notify();
  },

  /**
   * Append one SSE chunk to the active streaming bubble. No-op if no
   * stream is open (defensive — chunks can arrive after finishStream()
   * races against a new send).
   */
  appendStreamChunk(delta: string): void {
    if (!state.streaming) return;
    state = {
      ...state,
      streaming: { ...state.streaming, content: state.streaming.content + delta },
    };
    notify();
  },

  /**
   * Close the streaming bubble and convert it into a finalised
   * message with the S14/S12 CLI bar attached. Called from
   * finishStream() after the S14 usage + routing metadata has been
   * extracted from the last SSE chunk.
   */
  finaliseStream(bar: ChatMessageBar): void {
    if (!state.streaming) return;
    const finished: ChatMessage = {
      id: freshId(),
      role: "assistant",
      content: state.streaming.content,
      timestamp: new Date(),
      bar,
    };
    state = {
      ...state,
      messages: [...state.messages, finished],
      streaming: null,
      isLoading: false,
    };
    notify();
  },

  /**
   * Discard the streaming bubble without appending a message. Used in
   * the error path — the user sees an error bubble instead of a
   * half-written reply.
   */
  abortStream(): void {
    if (!state.streaming) return;
    state = { ...state, streaming: null, isLoading: false };
    notify();
  },

  setIsLoading(loading: boolean): void {
    state = { ...state, isLoading: loading };
    notify();
  },

  /**
   * Surface a transient error. Rendered as a red error bubble under
   * the last message; cleared automatically when the next user send
   * fires (setMessages / appendMessage also resets `error`).
   */
  setError(message: string | null): void {
    state = { ...state, error: message };
    notify();
  },

  /**
   * Wipe everything (used on app boot before the first session loads,
   * and on `session_clear_all` from settings).
   */
  reset(): void {
    state = { messages: [], streaming: null, isLoading: false, error: null };
    nextId = 1;
    notify();
  },

  /**
   * Subscribe to state. Fires immediately so a fresh Preact useEffect
   * doesn't miss any mutator that ran before the effect mounted
   * (alpha-7 search-modal lesson — same pattern).
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: lets the test suite reset the module-level state. */
  __resetForTests(): void {
    state = { messages: [], streaming: null, isLoading: false, error: null };
    nextId = 1;
    listeners.clear();
  },
};

export type { ChatStoreState, StreamingBubble };