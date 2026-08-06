// v0.2-alpha-19 — ConfirmModal (Preact JSX).
//
// Renders a single-instance confirmation overlay into the existing
// <div id="confirm-modal"> root defined in index.html. Subscribes to
// confirmStore for the pending request; renders nothing when no
// request is pending.
//
// Follows the alpha-15 share-import modal pattern: header with title
// + × close button, body with the message, footer with Cancel +
// Confirm buttons (Confirm uses the danger outline style when
// `pending.danger` is true, matching the AGENTS.md §4 requirement).

import { useEffect, useRef, useState } from "preact/hooks";
import { confirmStore } from "./confirm-modal-store";
import type { ConfirmStoreState } from "./confirm-modal-store";
import { useFocusTrap } from "../lib/focus-trap";

export function ConfirmModal() {
  const state = useConfirmStoreState();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  // v0.3-alpha-34: focus trap wraps the dialog and lands on the
  // Confirm button by default so Enter still dismisses (the previous
  // hand-rolled useEffect that called confirmBtnRef.focus() is
  // replaced — useFocusTrap's requestAnimationFrame does the same
  // thing once Preact has flushed the refs).
  const trapRef = useFocusTrap(!!state.pending, confirmBtnRef);

  // Escape closes the modal (resolves false). We listen on the
  // document level so the user doesn't have to focus inside the
  // modal first — same behaviour as alpha-7 search-modal.
  useEffect(() => {
    if (!state.pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        confirmStore.resolve(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.pending]);

  if (!state.pending) return null;
  const p = state.pending;
  return (
    <div ref={trapRef} class="modal modal-confirm" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>{p.title}</h2>
        <button
          type="button"
          class="modal-close-btn"
          aria-label="关闭"
          onClick={() => confirmStore.resolve(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <p class="confirm-message">{p.message}</p>
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => confirmStore.resolve(false)}
        >
          {p.cancelLabel ?? "取消"}
        </button>
        <button
          ref={confirmBtnRef}
          type="button"
          class={p.danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={() => confirmStore.resolve(true)}
        >
          {p.confirmLabel ?? "确认"}
        </button>
      </div>
    </div>
  );
}

// Re-export useState for the small wrapper below.
function useConfirmStoreState(): ConfirmStoreState {
  const [state, setState] = useState<ConfirmStoreState>(confirmStore.get());
  useEffect(() => confirmStore.subscribe(setState), []);
  return state;
}