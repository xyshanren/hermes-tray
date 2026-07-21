// v0.2-alpha-20 — Mount the ShortcutsModal Preact component into the
// existing <div id="shortcuts-modal"> shell defined in index.html.
//
// v0.2-alpha-22 fix: the index.html shell carries a static
// `class="modal-overlay hidden"` so the overlay is hidden until JS
// mounts. We must sync that .hidden class with the store so the
// overlay becomes visible when shortcutsModalStore.setOpen(true)
// fires — without this the Preact panel renders inside but the
// parent stays display:none, which was the bug caught by the
// Playwright verification (16-shortcuts-modal screenshot showed
// the chat view instead of the modal).

import { render } from "preact";
import { ShortcutsModal } from "./shortcuts-modal-view";
import { shortcutsModalStore } from "./shortcuts-modal-store";

export function mountShortcutsModal(targetId = "shortcuts-modal"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  // Sync the overlay's hidden class with the store, matching the
  // search-modal-mount pattern (alpha-7).
  const syncHidden = (s: { open: boolean }) => {
    root.classList.toggle("hidden", !s.open);
  };
  syncHidden(shortcutsModalStore.get());
  shortcutsModalStore.subscribe(syncHidden);
  // v0.3: click-outside-to-close (read-only modal, safe to dismiss).
  root.addEventListener("click", (e) => {
    if (e.target === root) shortcutsModalStore.setOpen(false);
  });
  render(<ShortcutsModal />, root);
  return root;
}