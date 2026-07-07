// v0.2-alpha-18 — Mount the ChatInput Preact component + expose an
// imperative handle for main.ts to drive the textarea content.
//
// The form's `<form id="chat-form">` shell stays static in index.html.
// The drag/drop overlay state (.dragging class) is added by main.ts
// (it owns the DragEvent listeners — they need access to the native
// `chatForm` element + DataTransfer.files list which doesn't go through
// Preact cleanly).
//
// The mount returns a handle with three methods:
//   - appendText(text): append (or seed, when empty) text into the
//     textarea. Used by hermes-agent's voice transcript (alpha-18's
//     onRecordingComplete) and any other "fill the input" call site.
//   - clearText(): empty the textarea. Used after a successful send
//     and on Ctrl+Shift+H tray quick-capture.
//   - focus(): bring the textarea into focus. Used after quick-capture
//     + after voice transcript append.

import { render } from "preact";
import { ChatInput } from "./chat-input-view";
import type { ChatInputProps } from "./chat-input-view";
import { chatInputStore } from "./chat-input-store";

export interface ChatInputHandle {
  appendText: (text: string) => void;
  clearText: () => void;
  focus: () => void;
}

export interface MountChatInputOptions extends ChatInputProps {
  /** Container element id (defaults to "chat-form"). Override for
   *  tests so we can render into an isolated host. */
  targetId?: string;
}

/**
 * Imperative handle back-channel. Lives outside the component (a
 * module-level ref) because Preact's `ref={...}` callback fires on
 * every render — we want one stable handle across re-renders. The
 * component writes the latest textarea element + setText callback
 * here via a useEffect that subscribes to its own "ready" signal.
 */
let currentHandle: ChatInputHandle | null = null;

export function getChatInputHandle(): ChatInputHandle | null {
  return currentHandle;
}

/**
 * Mount the ChatInput Preact component into the existing
 * <form id="chat-form"> shell. Returns the host element so tests
 * can query its children.
 */
export function mountChatInput(opts: MountChatInputOptions): HTMLElement {
  const root = document.getElementById(opts.targetId ?? "chat-form");
  if (!root) {
    console.warn(`[Hermes] #${opts.targetId ?? "chat-form"} mount point missing`);
    throw new Error(`mount point #${opts.targetId ?? "chat-form"} not found`);
  }

  // v0.2-alpha-22 (manual Tauri verification) — wipe the v0.1.5
  // inline chat-form markup before Preact renders. Without this
  // the shell still contains the v0.1.5 attach-btn / message-input
  // / send-btn DOM, and Preact's render() appends a second
  // <form class="chat-form"> inside it — visible as two input rows
  // in the GUI (one anchored left, one anchored right). Same
  // pattern as the alpha-16 chat-view-mount (which already wipes
  // its <div id="messages"> shell). Captured during Step 9 manual
  // verification on 2026-07-07.
  root.innerHTML = "";

  // The Preact view owns the textarea content internally; we hand
  // main.ts three imperative methods (appendText / clearText / focus)
  // that reach into the DOM. To avoid a stale ref after re-renders we
  // re-query the textarea on every call — it's a single getElementById
  // and the operations are infrequent (voice transcript, quick
  // capture, post-send clear).
  const handle: ChatInputHandle = {
    appendText(text: string) {
      const el = document.getElementById("message-input") as HTMLTextAreaElement | null;
      if (!el) return;
      const current = el.value.trim();
      el.value = current ? `${current} ${text}` : text;
      // Dispatch a synthetic input event so the Preact view's onInput
      // picks up the change. This keeps the controlled-component
      // invariant intact (textarea value in DOM == React state).
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
      // Move the caret to the end so the user can keep typing without
      // hunting for the cursor.
      const len = el.value.length;
      el.setSelectionRange(len, len);
    },
    clearText() {
      const el = document.getElementById("message-input") as HTMLTextAreaElement | null;
      if (!el) return;
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.style.height = "auto";
      el.focus();
    },
    focus() {
      const el = document.getElementById("message-input") as HTMLTextAreaElement | null;
      el?.focus();
    },
  };
  currentHandle = handle;

  render(
    <ChatInput
      isLoading={opts.isLoading}
      onSubmit={opts.onSubmit}
      onAttach={opts.onAttach}
      onMicToggle={opts.onMicToggle}
    />,
    root,
  );
  return root;
}

export { chatInputStore };