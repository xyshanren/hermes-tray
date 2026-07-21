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
  // visible iff there's a pending import OR paste mode is open
  // (v0.3: paste-import gives desktop users a way to feed a share
  //  link into the app, since they can't open a #share= URL directly).
  const syncHidden = (s: { pending: unknown; pasteOpen: boolean }) => {
    root.classList.toggle("hidden", s.pending === null && !s.pasteOpen);
  };
  syncHidden(shareStore.get());
  shareStore.subscribe(syncHidden);

  render(<ShareImportModal />, root);
}