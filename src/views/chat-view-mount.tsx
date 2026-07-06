// v0.2-alpha-16 — Mount the ChatView Preact component into the
// `<div id="messages">` shell defined in index.html.
//
// The shell stays static (no need to touch index.html); this module
// wipes any existing inner content (the v0.1.5 inline welcome bubble)
// and renders the Preact component into the same element.
//
// We render <ChatViewWithWelcome /> (the wrapper that also subscribes
// to chatWelcomeStore) so the welcome screen picks up persona + project
// hints pushed by main.ts via chatWelcomeStore.setContext().
//
// One-line call site from main.ts (DOMContentLoaded):
//   mountChatView();

import { render } from "preact";
import { ChatViewWithWelcome, type ChatViewActions } from "./chat-view";

// Re-export the chat view stores from the mount module so main.ts only
// needs one import path. chatStore lives in ./chat-view-store.ts (the
// pure data layer) and chatWelcomeStore lives in ./chat-view.tsx
// (colocated with the Preact view that consumes it). The mount module
// is the public surface that the rest of the app uses.
export { chatStore } from "./chat-view-store";
export { chatWelcomeStore } from "./chat-view";

export function mountChatView(actions?: ChatViewActions): void {
  const root = document.getElementById("messages");
  if (!root) {
    console.warn("[Hermes] #messages mount point missing in index.html");
    return;
  }
  // v0.1.5 ships a static welcome-message bubble inside #messages.
  // We wipe it because the Preact view owns this region now; if the
  // store is empty (no session loaded yet), <WelcomeBubble /> renders
  // an equivalent welcome into the same slot.
  root.innerHTML = "";
  render(<ChatViewWithWelcome actions={actions} />, root);
}