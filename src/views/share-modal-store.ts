// v0.2-alpha-15 — ShareImportModal open/pendingImport state.
//
// Tiny pub-sub for the share-import modal overlay. The modal renders
// a preview of the decoded ShareDoc (title + message count) and asks
// the user to confirm before invoking executeShareImport.
//
// Flow:
//   main.ts boot hook -> validateShareHash() -> shareStore.setPending(doc)
//   User clicks "Import" in modal -> executeShareImport(doc) -> clearPending
//   User clicks "Cancel" in modal -> clearPending (no import)
//   Successful import also clears pending + clears the URL hash

import type { ShareDoc } from "../types";

interface ShareModalState {
  pending: ShareDoc | null;
  /** True while executeShareImport is in flight — disables the import button. */
  isImporting: boolean;
}

type Listener = (s: ShareModalState) => void;

let state: ShareModalState = { pending: null, isImporting: false };
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const shareStore = {
  get(): ShareModalState {
    return state;
  },
  /** Set the pending ShareDoc for import. Pass null to close the modal. */
  setPending(doc: ShareDoc | null): void {
    state = { ...state, pending: doc, isImporting: false };
    notify();
  },
  /** Mark the import as in-flight (UI should disable the Import button). */
  setImporting(importing: boolean): void {
    state = { ...state, isImporting: importing };
    notify();
  },
  /**
   * Subscribe to state. Fires immediately so a fresh Preact useEffect
   * doesn't miss any setPending() that ran before the effect mounted.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },
};