// v0.2-alpha-32.5 — Per-session project override picker store.
//
// Tiny pub-sub driving the header project chip + dropdown. main.ts
// pushes state changes (session switch → new project info, pick →
// loading → success/fail); the Preact <ProjectPicker /> subscribes
// and re-renders.
//
// Pattern: same as search-modal-store.ts (Set<Listener> + subscribe
// returns unsubscribe).

export interface ProjectPickerState {
  /** Dropdown open/closed. */
  isOpen: boolean;
  /** Current session's project (parsed from project_context JSON). */
  currentProject: { name: string; project_dir: string } | null;
  /** MRU project paths (most-recent first, max 5). */
  recentPaths: string[];
  /** True while scanProject + session_update are in-flight. */
  isLoading: boolean;
  /** Current session id (needed for the update call). */
  sessionId: string | null;
}

type Listener = (state: ProjectPickerState) => void;

const initialState: ProjectPickerState = {
  isOpen: false,
  currentProject: null,
  recentPaths: [],
  isLoading: false,
  sessionId: null,
};

let state: ProjectPickerState = { ...initialState };
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(state);
}

export const projectPickerStore = {
  get(): ProjectPickerState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => { listeners.delete(listener); };
  },

  setOpen(open: boolean): void {
    if (state.isOpen === open) return;
    state = { ...state, isOpen: open };
    emit();
  },

  toggle(): void {
    state = { ...state, isOpen: !state.isOpen };
    emit();
  },

  /** Called on session switch — updates the chip label + session id. */
  setSession(sessionId: string | null, project: { name: string; project_dir: string } | null): void {
    state = { ...state, sessionId, currentProject: project, isOpen: false };
    emit();
  },

  setRecentPaths(paths: string[]): void {
    state = { ...state, recentPaths: paths.slice(0, 5) };
    emit();
  },

  setLoading(loading: boolean): void {
    state = { ...state, isLoading: loading };
    emit();
  },

  /** After a successful pick — update current project + close dropdown. */
  applyProject(project: { name: string; project_dir: string } | null): void {
    state = { ...state, currentProject: project, isOpen: false, isLoading: false };
    emit();
  },
};
