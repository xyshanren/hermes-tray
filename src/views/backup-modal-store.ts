// v0.2-alpha-9 — BackupModal open/close state.
//
// Tiny pub-sub for the backup modal overlay. The modal itself is a single
// flat view (no mode switcher — see AGENTS.md §4: "Backup modal:
// separation cards, not tabs"); the components inside the modal manage
// their own state for create vs restore flows.

type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(open);
}

export const backupStore = {
  getOpen(): boolean {
    return open;
  },
  setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    notify();
  },
  /**
   * Subscribe to open/close. Fires immediately so a fresh Preact useEffect
   * doesn't miss any setOpen() that ran before the effect mounted.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(open);
    return () => {
      listeners.delete(listener);
    };
  },
};