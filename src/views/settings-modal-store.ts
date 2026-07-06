// v0.2-alpha-11 — SettingsModal open/close state.
//
// Tiny pub-sub for the settings modal overlay. The modal contents
// (theme segmented control, gateway connection group, distro select,
// port + api key + default project + default model fields) all live
// in ./settings-modal.tsx and react to `open` transitions through
// this store.

type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(open);
}

export const settingsStore = {
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