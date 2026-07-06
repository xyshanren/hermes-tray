// v0.2-alpha-17 — Sidebar visibility store.
//
// Tiny pub-sub for the sidebar's show/hide state. main.ts toggles the
// store in response to:
//   - the sidebar-toggle / sidebar-show buttons (alpha-1 header icons)
//   - tray menu commands (tray://new-session, tray://open-search)
//   - the Ctrl+K search shortcut handler that wants to surface the
//     sidebar so the user can see the search results in context
//
// The <aside id="sidebar"> overlay already has its `hidden` class
// driven by the store via sessions-list-mount's subscribe callback —
// no separate Preact component needed for the wrapper because the
// sidebar header (icons + "会话" title) is static markup in
// index.html and alpha-17 only swaps out the inner <div id="session-list">.

type Listener = (visible: boolean) => void;

let visible = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(visible);
}

export const sidebarStore = {
  get(): boolean {
    return visible;
  },

  setVisible(next: boolean): void {
    if (visible === next) return;
    visible = next;
    notify();
  },

  /**
   * Flip visibility. Returns the new value so callers can chain
   * (e.g. "if (sidebarStore.toggle()) ..." inside a Ctrl+K handler).
   */
  toggle(): boolean {
    visible = !visible;
    notify();
    return visible;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(visible);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: lets the test suite reset the module-level state. */
  __resetForTests(): void {
    visible = false;
    listeners.clear();
  },
};