// v0.2-alpha-8 — Mount the PersonaModal Preact component into the
// existing <div id="persona-modal"> overlay root from index.html.
//
// Idempotent. The store in ./persona-modal-store drives visibility; main.ts
// owns the openPersonaModal/closePersonaModal wrappers, the picker
// refresh callback, and the personas CRUD command wrappers.

import { render } from "preact";
import { PersonaModal } from "./persona-modal";
import { personaStore } from "./persona-modal-store";

export function mountPersonaModal(opts: {
  /** Called after every CRUD inside PersonaModal so main.ts can refresh
   *  the header persona picker. */
  onPersonasChanged: () => void;
}): void {
  const root = document.getElementById("persona-modal");
  if (!root) {
    console.warn("[Hermes] #persona-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store so external callers
  // (openPersonaModal/closePersonaModal) keep toggling visibility as before.
  const syncHidden = (s: { open: boolean }) => {
    root.classList.toggle("hidden", !s.open);
  };
  syncHidden(personaStore.get());
  personaStore.subscribe(syncHidden);

  render(<PersonaModal onPersonasChanged={opts.onPersonasChanged} />, root);
}