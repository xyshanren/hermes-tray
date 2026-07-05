// v0.2-alpha-8 — PersonaModal open/close + mode state.
//
// Tiny pub-sub carrying the three things the persona modal needs to know:
//   - open:    whether the overlay is visible
//   - mode:    which view to render inside (list / create / edit)
//   - editingId: when mode === 'edit', the persona being edited
//
// The actual personas array lives inside PersonaModal itself (fetched on
// first open + reloaded after every CRUD operation). That's simpler than
// sharing module-level state across main.ts (which still owns the picker
// options) and the component.

type PersonaMode = "list" | "create" | "edit";

export interface PersonaStoreState {
  open: boolean;
  mode: PersonaMode;
  editingId: string | null;
}

let state: PersonaStoreState = { open: false, mode: "list", editingId: null };
const listeners = new Set<(s: PersonaStoreState) => void>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const personaStore = {
  get(): PersonaStoreState {
    return state;
  },
  setOpen(open: boolean): void {
    if (state.open === open) return;
    state = { ...state, open };
    notify();
  },
  setMode(mode: PersonaMode): void {
    if (state.mode === mode) return;
    state = { ...state, mode };
    notify();
  },
  setEditingId(editingId: string | null): void {
    if (state.editingId === editingId) return;
    state = { ...state, editingId };
    notify();
  },
  /** Close + reset to defaults in one call (used by the closePersonaModal
   *  wrapper in main.ts, and by the × button inside the modal). */
  close(): void {
    if (!state.open && state.mode === "list" && state.editingId === null) return;
    state = { open: false, mode: "list", editingId: null };
    notify();
  },
  /**
   * Subscribe to state changes. The listener fires once immediately with
   * the current state — otherwise a fresh Preact useEffect would miss any
   * setOpen()/setMode() that ran before the effect mounted.
   */
  subscribe(listener: (s: PersonaStoreState) => void): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },
};