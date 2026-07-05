// v0.2-alpha-7 — SearchModal open/close state.
//
// Tiny pub-sub because SearchModal needs to react when main.ts calls
// openSearchModal() / closeSearchModal() from external triggers
// (sidebar button, Ctrl+K, tray menu) without prop drilling or remount.
//
// Subscribe returns an unsubscribe function — use inside useEffect:
//   useEffect(() => searchModalStore.subscribe(setOpen), [])

type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

export const searchModalStore = {
  getOpen(): boolean {
    return open;
  },
  setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    for (const l of listeners) l(next);
  },
  /**
   * Subscribe to open/close changes. The listener fires once immediately
   * with the current state — otherwise a Preact `useEffect(subscribe, [])`
   * pattern would miss any setOpen() that ran before the effect mounted.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(open);
    return () => {
      listeners.delete(listener);
    };
  },
};