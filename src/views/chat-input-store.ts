// v0.2-alpha-18 — ChatInput state store.
//
// Owns the data layer for the chat input form's pre-send attachments
// and recording visual state. The textarea text itself stays local to
// the Preact <ChatInput /> component (controlled input pattern; keeps
// IME composition + cursor position stable across renders). Only the
// bits main.ts needs to observe externally live here.
//
//   - pendingAttachments: images the user picked via 📎 button /
//     drag-drop, waiting to be sent with the next user message.
//     Cleared on submit so the strip empties before the SSE reply
//     comes back (the persisted attachments move into the chat
//     history as message metadata — alpha-16's ChatView renders
//     those post-send).
//   - isRecording: visual toggle for the mic button. The actual
//     MediaRecorder state lives in main.ts (it owns the audio stream
//     + hermes_proxy_transcribe invoke); this flag just drives the
//     pulsing-red CSS class.
//   - maxInputLength: copy of CONFIG.maxInputLength (4000 chars) so
//     the view can render the "X / 4000" counter without reaching
//     into main.ts's module-level CONFIG.

import type { PendingAttachment } from "./chat-view-store";

interface ChatInputState {
  pendingAttachments: PendingAttachment[];
  isRecording: boolean;
  maxInputLength: number;
}

export type { ChatInputState };

type Listener = (state: ChatInputState) => void;

let state: ChatInputState = {
  pendingAttachments: [],
  isRecording: false,
  maxInputLength: 4000,
};

const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const chatInputStore = {
  get(): ChatInputState {
    return state;
  },

  /**
   * Append a freshly-decoded attachment (output of `fileToAttachment`).
   * We append (don't replace) so drag-drop + 📎 button work in tandem.
   */
  addAttachment(att: PendingAttachment): void {
    state = { ...state, pendingAttachments: [...state.pendingAttachments, att] };
    notify();
  },

  /**
   * Drop the attachment at `idx`. Called by the × button on each
   * preview thumb. No-op if idx is out of bounds.
   */
  removeAttachment(idx: number): void {
    if (idx < 0 || idx >= state.pendingAttachments.length) return;
    state = {
      ...state,
      pendingAttachments: state.pendingAttachments.filter((_, i) => i !== idx),
    };
    notify();
  },

  /**
   * Wipe all pending attachments. Called after a successful send so
   * the strip empties before the SSE reply arrives.
   */
  clearAttachments(): void {
    if (state.pendingAttachments.length === 0) return;
    state = { ...state, pendingAttachments: [] };
    notify();
  },

  /**
   * Flip the mic-button visual state. Called by main.ts's
   * startRecording() / stopRecording() — the audio side-effects live
   * there (MediaRecorder + hermes_proxy_transcribe invoke), this
   * just toggles the .recording CSS class.
   */
  setRecording(recording: boolean): void {
    if (state.isRecording === recording) return;
    state = { ...state, isRecording: recording };
    notify();
  },

  /**
   * Wipe everything (used on app boot / logout / reset). The textarea
   * text isn't owned by this store — see the ChatInput view for the
   * local clearText imperative API exposed via mountChatInput().
   */
  reset(): void {
    state = { pendingAttachments: [], isRecording: false, maxInputLength: 4000 };
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
    state = { pendingAttachments: [], isRecording: false, maxInputLength: 4000 };
    listeners.clear();
  },
};