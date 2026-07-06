// v0.2-alpha-19 — Confirm modal store.
//
// Replaces the last native window.confirm() in main.ts with a proper
// Preact modal so we get consistent styling + focus trap + Escape
// handling. Single call site today (handleSessionDelete for the
// sidebar's × button); the store is generic enough to serve future
// confirmation flows (e.g. "clear all sessions" danger zone in the
// settings modal — that's currently a stub toast in main.ts and
// will move here when alpha-19 finishes wiring it).
//
// API shape — a Promise-based single-call API:
//   const ok = await requestConfirm({ title, message, danger });
//   if (!ok) return;
//
// The Promise resolves true on Confirm, false on Cancel / × / Escape /
// overlay-click. The store holds at most one pending request — a
// second requestConfirm() call while one is pending cancels the
// first (resolves false) and replaces it. This matches the
// "single-modal" semantics of the other v0.2 modal stores.

type Resolve = (value: boolean) => void;

interface PendingRequest {
  title: string;
  message: string;
  /** When true, the Confirm button uses the red-outlined "danger" style
   *  matching the AGENTS.md §4 dangerous-action requirement. */
  danger: boolean;
  /** Confirm button label (default: "确认"). */
  confirmLabel?: string;
  /** Cancel button label (default: "取消"). */
  cancelLabel?: string;
  resolve: Resolve;
}

interface ConfirmStoreState {
  pending: PendingRequest | null;
}

export type { ConfirmStoreState };

type Listener = (state: ConfirmStoreState) => void;

let state: ConfirmStoreState = { pending: null };
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const confirmStore = {
  get(): ConfirmStoreState {
    return state;
  },

  /**
   * Resolve the pending request with `value` (true = confirm, false =
   * cancel) and clear it. No-op if no request is pending.
   */
  resolve(value: boolean): void {
    const r = state.pending;
    if (!r) return;
    state = { pending: null };
    notify();
    r.resolve(value);
  },

  /**
   * Subscribe. Fires immediately so a fresh Preact useEffect doesn't
   * miss any setPending that ran before mount (alpha-7 lesson — same
   * pattern).
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: lets the test suite reset module-level state. */
  __resetForTests(): void {
    state = { pending: null };
    listeners.clear();
  },
};

/**
 * Request a confirmation. Returns a Promise that resolves true on
 * confirm + false on cancel. Only one request can be pending at a
 * time; a second call cancels the first (resolves false) before
 * opening the new one.
 */
export function requestConfirm(opts: {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  // If a previous request is still pending, resolve it with false
  // so the caller's `await` unblocks before we replace it.
  if (state.pending) {
    const old = state.pending;
    state = { pending: null };
    old.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    state = {
      pending: {
        title: opts.title,
        message: opts.message,
        danger: opts.danger ?? false,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        resolve,
      },
    };
    notify();
  });
}