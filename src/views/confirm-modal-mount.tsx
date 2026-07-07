// v0.2-alpha-19 — Mount the ConfirmModal Preact component into the
// existing <div id="confirm-modal"> overlay root.
//
// v0.2-alpha-22 fix (caught by Step 9 manual Tauri verification):
// index.html carries the shell as `<div id="confirm-modal"
// class="modal-overlay hidden">`. Without syncing the parent's
// `.hidden` class with the store, the Preact panel renders inside
// the shell but the parent stays `display: none` — meaning
// requestConfirm() fires, the store mutates, but the user sees
// nothing (same bug alpha-22 caught on shortcuts-modal-mount).
// Fix mirrors that one — `root.classList.toggle("hidden", !pending)`
// via store subscription.

import { render } from "preact";
import { ConfirmModal } from "./confirm-modal-view";
import { confirmStore } from "./confirm-modal-store";

// Re-export so main.ts has a single import path for both mount +
// request-the-confirmation API.
export { requestConfirm } from "./confirm-modal-store";

export function mountConfirmModal(targetId = "confirm-modal"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  // Sync the overlay's hidden class with the store.
  const syncHidden = (s: { pending: unknown }) => {
    root.classList.toggle("hidden", !s.pending);
  };
  syncHidden(confirmStore.get());
  confirmStore.subscribe(syncHidden);
  render(<ConfirmModal />, root);
  return root;
}