// v0.2-alpha-15 — Mount the ShareImportModal Preact component into
// the `<div id="share-import-modal">` overlay root defined in index.html.
//
// The overlay's hidden class still controls visibility — this module
// just renders the inner modal panel and wires up the store subscription
// so external setPending() calls drive re-renders.

import { render } from "preact";
import { ShareImportModal } from "./share-modal";
import { shareStore } from "./share-modal-store";

export function mountShareImportModal(): void {
  const root = document.getElementById("share-import-modal");
  if (!root) {
    console.warn("[Hermes] #share-import-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store. The overlay is
  // visible iff `pending != null` (no modal when there's nothing to
  // import — the URL hash check happens at boot time, so most of the
  // time the overlay is hidden).
  const syncHidden = (s: { pending: unknown }) => {
    root.classList.toggle("hidden", s.pending === null);
  };
  syncHidden(shareStore.get());
  shareStore.subscribe(syncHidden);

  render(<ShareImportModal />, root);
}