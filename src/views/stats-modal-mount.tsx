// v0.2-alpha-10 — Mount the StatsModal Preact component into the
// `<div id="stats-modal">` overlay root defined in index.html.
//
// The overlay's hidden class still controls visibility — this module
// just renders the inner modal panel and wires up the store subscription
// so external openStatsModal()/closeStatsModal() calls drive re-renders.

import { render } from "preact";
import { StatsModal } from "./stats-modal";
import { statsStore } from "./stats-modal-store";

export function mountStatsModal(): void {
  const root = document.getElementById("stats-modal");
  if (!root) {
    console.warn("[Hermes] #stats-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store so external callers
  // (openStatsModal/closeStatsModal) keep toggling visibility as before.
  const syncHidden = (open: boolean) => {
    root.classList.toggle("hidden", !open);
  };
  syncHidden(statsStore.getOpen());
  statsStore.subscribe(syncHidden);

  // v0.3: click-outside-to-close (read-only modal, safe to dismiss).
  root.addEventListener("click", (e) => {
    if (e.target === root) statsStore.setOpen(false);
  });

  render(<StatsModal />, root);
}