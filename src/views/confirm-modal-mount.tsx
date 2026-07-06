// v0.2-alpha-19 — Mount the ConfirmModal Preact component into the
// existing <div id="confirm-modal"> overlay root.
//
// The overlay's hidden class is driven by the store — when no request
// is pending the modal renders nothing, so the overlay stays empty.
// main.ts calls this once in DOMContentLoaded.
//
// No return value — requestConfirm() is the call site for triggering
// a confirmation. The modal mount is independent.

import { render } from "preact";
import { ConfirmModal } from "./confirm-modal-view";

// Re-export so main.ts has a single import path for both mount +
// request-the-confirmation API.
export { requestConfirm } from "./confirm-modal-store";

export function mountConfirmModal(targetId = "confirm-modal"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  render(<ConfirmModal />, root);
  return root;
}