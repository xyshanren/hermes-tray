// v0.2-alpha-19 — Mount the ShortcutsModal Preact component into the
// existing <div id="shortcuts-modal"> shell defined in index.html.

import { render } from "preact";
import { ShortcutsModal } from "./shortcuts-modal-view";

export function mountShortcutsModal(targetId = "shortcuts-modal"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  render(<ShortcutsModal />, root);
  return root;
}