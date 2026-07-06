// v0.2-alpha-19 — Splash screen store (design 17 in the SVG set).
//
// Pub-sub for the boot-time splash overlay. Shows on app launch while
// main.ts is initialising (gateway resolve → settings load → persona
// load → session list fetch). The progress bar fills 0..100 as each
// boot step completes, then the splash fades out.
//
// Trigger: main.ts calls splashStore.setProgress(n) / setStatus(text)
// as each boot step lands. Once everything's wired up, call
// splashStore.setVisible(false) — the view fades out via CSS.
//
// The view is mounted into the existing <div id="splash"> shell in
// index.html. The shell is visible by default (no .hidden class) so
// the user sees the splash while the JS bundle loads. After the first
// Preact render the store-driven visibility takes over.

export interface SplashState {
  /** 0..100 — the purple progress bar fill width. */
  progress: number;
  /** Short status line below the progress bar ("连接 Hermes Gateway..."). */
  status: string;
  /** When false, the splash fades out + is unmounted. */
  visible: boolean;
}

type Listener = (state: SplashState) => void;

let state: SplashState = {
  progress: 0,
  status: "连接 Hermes Gateway...",
  visible: true,
};
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const splashStore = {
  get(): SplashState {
    return state;
  },

  /** Clamp the progress to 0..100. Out-of-range values are coerced
   *  (negative → 0, >100 → 100). */
  setProgress(p: number): void {
    const clamped = Math.max(0, Math.min(100, p));
    if (state.progress === clamped) return;
    state = { ...state, progress: clamped };
    notify();
  },

  setStatus(status: string): void {
    if (state.status === status) return;
    state = { ...state, status };
    notify();
  },

  /** Hide the splash (called once after the chat view is mounted +
   *  initial state fetched). The Preact view fades out via CSS +
   *  unmounts. */
  hide(): void {
    if (!state.visible) return;
    // Snap progress to 100 first so the user sees the bar fill
    // before the fade.
    state = { ...state, progress: 100, visible: false };
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },

  __resetForTests(): void {
    state = {
      progress: 0,
      status: "连接 Hermes Gateway...",
      visible: true,
    };
    listeners.clear();
  },
};