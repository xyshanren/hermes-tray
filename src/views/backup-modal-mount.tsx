// v0.2-alpha-9 — Mount the BackupModal Preact component into the existing
// `<div id="backup-modal">` overlay root defined in index.html.
//
// The overlay's hidden class still controls visibility — this module
// just renders the inner modal panel and wires up the store subscription
// so external openBackupModal()/closeBackupModal() calls drive re-renders.

import { render } from "preact";
import { BackupModal } from "./backup-modal";
import { backupStore } from "./backup-modal-store";

export function mountBackupModal(): void {
  const root = document.getElementById("backup-modal");
  if (!root) {
    console.warn("[Hermes] #backup-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store so external callers
  // (openBackupModal/closeBackupModal) keep toggling visibility as before.
  const syncHidden = (open: boolean) => {
    root.classList.toggle("hidden", !open);
  };
  syncHidden(backupStore.getOpen());
  backupStore.subscribe(syncHidden);

  render(<BackupModal />, root);
}