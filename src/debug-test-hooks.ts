// v0.2-alpha-22 — Optional test hook for the verification harness.
//
// Loaded by verification/harness/playwright.mjs via the mock-tauri
// shim's `__HERMES_TEST__` global. When the bundle detects
// `window.__HERMES_TEST__` is set (i.e. it's running in the
// Playwright harness, not real Tauri), it exposes the chat store
// mutators on that global so the harness can drive UI states.
//
// In production (real Tauri WebView) this hook is a no-op — main.ts
// never reads from window.__HERMES_TEST__ outside the Playwright
// runtime, so there's no surface area for an attacker to flip
// state via DOM injection.
//
// How the hook reaches the bundle: the harness HTML inserts
// `window.__HERMES_TEST__ = {}` BEFORE the bundle loads; after the
// bundle boots, the DOMContentLoaded handler copies mutator refs
// into it. The harness then calls `__HERMES_TEST__.setError(...)`
// etc. to drive specific empty / error states for screenshots.

import { chatStore } from "./views/chat-view-store";

if (typeof window !== "undefined" && (window as any).__HERMES_TEST__) {
  const t = (window as any).__HERMES_TEST__;
  t.setConnectionStatus = (s: "online" | "offline") => chatStore.setConnectionStatus(s);
  t.setHasSessions = (b: boolean) => chatStore.setHasSessions(b);
  t.setError = (msg: string | null) => chatStore.setError(msg);
  t.setFatal = (msg: string | null) => chatStore.setFatal(msg);
  t.clearFatal = () => chatStore.clearFatal();
  t.setMessages = (msgs: any[]) => chatStore.setMessages(msgs);
  t.appendMessage = (role: string, content: string) =>
    chatStore.appendMessage({
      role: role as "user" | "assistant",
      content,
      timestamp: new Date(),
    });
  t.openShortcutsModal = () => {
    // Lazy import to avoid a circular dep at module-load time.
    import("./views/shortcuts-modal-store").then((m) => {
      m.shortcutsModalStore.toggle();
    });
  };
  t.closeShortcutsModal = () => {
    import("./views/shortcuts-modal-store").then((m) => {
      // No dedicated hide() — use toggle() to flip back to closed.
      // The store's toggle is idempotent in the open→closed direction
      // (returns false when called on an already-closed modal).
      m.shortcutsModalStore.toggle();
    });
  };
  // Mark the hook as ready so the harness can poll for it.
  t.__ready__ = true;
}