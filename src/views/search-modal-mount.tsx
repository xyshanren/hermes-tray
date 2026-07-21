// v0.2-alpha-7 — Mount the SearchModal Preact component into the
// `<div id="search-modal">` overlay root defined in index.html.
//
// The overlay's hidden class still controls visibility — this module just
// renders the inner modal panel and wires up the store subscription so
// external openSearchModal()/closeSearchModal() calls drive re-renders.

import { render } from "preact";
import { SearchModal } from "./search-modal";
import { searchModalStore } from "./search-modal-store";

export function mountSearchModal(opts: {
  onSelect: (sessionId: string) => void;
}): void {
  const root = document.getElementById("search-modal");
  if (!root) {
    console.warn("[Hermes] #search-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store so external callers
  // (openSearchModal/closeSearchModal) keep toggling visibility as before.
  const syncHidden = (open: boolean) => {
    root.classList.toggle("hidden", !open);
  };
  syncHidden(searchModalStore.getOpen());
  searchModalStore.subscribe(syncHidden);

  // Render the inner panel. Preact renders inside #search-modal, so the
  // <SearchModal /> root element appears as a child of the overlay.
  // v0.3: click-outside-to-close (read-only modal, safe to dismiss).
  root.addEventListener("click", (e) => {
    if (e.target === root) searchModalStore.setOpen(false);
  });
  render(<SearchModal onSelect={opts.onSelect} />, root);
}