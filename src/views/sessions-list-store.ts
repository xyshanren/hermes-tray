// v0.2-alpha-17 — Session list state store.
//
// Owns the data layer for the sidebar session list:
//   - sessions[]: the page of sessions currently loaded (paginated)
//   - hasMore: whether the server returned a full page (i.e. there's
//     probably another page to fetch)
//   - isLoading: true while a load-more fetch is in flight
//   - activeId: the session currently selected in the chat view
//   - renameId: id of the session whose title is being inline-edited
//     (null when nobody is renaming)
//
// main.ts drives all mutations through the mutators below:
//   - loadFirstPage / loadMorePage (triggered on session_created /
//     "加载更多" button)
//   - refreshRow (after each user send, T-Q-S9 live token badge)
//   - removeSession (after session_delete)
//   - renameSession (after session_update success)
//   - setActiveId (after selectSession)
//
// The Preact component (./sessions-list-view.tsx) subscribes to the
// store for rendering; it does NOT mutate state directly. Inline
// rename UI lives in the view as a sub-component so the editor state
// (input value, focus) stays local to that subtree.

import type { Session } from "../types";

interface SessionListState {
  sessions: Session[];
  /** True when the last fetch returned a full SESSION_PAGE — there's
   *  probably more data on the server. False when we've reached the
   *  end of the list (or never paginated). */
  hasMore: boolean;
  /** True while a load-more fetch is in flight (disables the button). */
  isLoading: boolean;
  /** The session currently selected in the chat view. Highlighted in
   *  the list via the `active` CSS class. */
  activeId: string | null;
  /** Id of the session currently being inline-renamed. The view swaps
   *  the title span for an <input> when this matches a row's id. */
  renameId: string | null;
}

export type { SessionListState };

type Listener = (state: SessionListState) => void;

let state: SessionListState = {
  sessions: [],
  hasMore: false,
  isLoading: false,
  activeId: null,
  renameId: null,
};

const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const sessionListStore = {
  get(): SessionListState {
    return state;
  },

  /**
   * Replace the entire session list with a fresh first page. Used on
   * app boot, after creating a new session, and after deleting the
   * last session in the list (to drop the empty placeholder row).
   */
  setFirstPage(sessions: Session[]): void {
    state = { ...state, sessions: [...sessions], hasMore: sessions.length >= PAGE_SIZE };
    notify();
  },

  /**
   * Append the next page to the existing list. `hasMore` is computed
   * from the returned length — if it equals PAGE_SIZE, there might be
   * more; if it's smaller, we've hit the end.
   */
  appendMorePage(sessions: Session[]): void {
    state = {
      ...state,
      sessions: [...state.sessions, ...sessions],
      hasMore: sessions.length >= PAGE_SIZE,
      isLoading: false,
    };
    notify();
  },

  setLoading(loading: boolean): void {
    state = { ...state, isLoading: loading };
    notify();
  },

  setActiveId(id: string | null): void {
    if (state.activeId === id) return;
    state = { ...state, activeId: id };
    notify();
  },

  /**
   * Remove a session from the list. Called after session_delete succeeds;
   * if it was the active one, also clears activeId so the chat view
   * falls back to the welcome screen.
   */
  removeSession(id: string): void {
    state = {
      ...state,
      sessions: state.sessions.filter((s) => s.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
      renameId: state.renameId === id ? null : state.renameId,
    };
    notify();
  },

  /**
   * Apply a partial patch to one session row. Used after session_update
   * (rename) and after the per-row refresh that surfaces live token
   * counts after each send (T-Q-S9).
   */
  patchSession(id: string, patch: Partial<Session>): void {
    state = {
      ...state,
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    };
    notify();
  },

  /**
   * Begin inline-rename mode for a session. The view swaps the title
   * span for an <input> when this matches a row's id. Setting to the
   * same id is a no-op (idempotent).
   */
  beginRename(id: string): void {
    if (state.renameId === id) return;
    state = { ...state, renameId: id };
    notify();
  },

  /** Cancel inline-rename mode (Escape key or click-outside). */
  cancelRename(): void {
    if (state.renameId === null) return;
    state = { ...state, renameId: null };
    notify();
  },

  /**
   * Wipe everything (used on app boot before the first session loads).
   * The pagination offset is also reset so a subsequent loadFirstPage
   * starts at row 0.
   */
  reset(): void {
    state = {
      sessions: [],
      hasMore: false,
      isLoading: false,
      activeId: null,
      renameId: null,
    };
    notify();
  },

  /**
   * Subscribe to state. Fires immediately so a fresh Preact useEffect
   * doesn't miss any mutator that ran before the effect mounted
   * (alpha-7 search-modal lesson — same pattern).
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Test-only: lets the test suite reset the module-level state. */
  __resetForTests(): void {
    state = {
      sessions: [],
      hasMore: false,
      isLoading: false,
      activeId: null,
      renameId: null,
    };
    listeners.clear();
  },
};

/**
 * Pagination size — exported so main.ts can pass it to the
 * `session_list` Tauri command. v0.1.5 had this as a module-level
 * `const SESSION_PAGE = 50` inside main.ts; we keep the same value for
 * behavioural parity.
 */
export const PAGE_SIZE = 50;