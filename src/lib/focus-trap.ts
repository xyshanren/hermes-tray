// v0.3 Phase 3 — Focus trap hook for modals (design spec U6).
//
// Usage inside a modal component:
//   const trapRef = useFocusTrap(open);
//   return <div ref={trapRef} role="dialog" aria-modal="true">...</div>
//
// To override which element receives the initial focus (e.g. a
// confirm-modal that should land on the Confirm button instead of
// the first focusable), pass the ref as the second argument:
//   const trapRef = useFocusTrap(open, confirmBtnRef);
//
// Behaviour:
//   - When `open` becomes true, focuses the explicit `initialFocusRef`
//     if provided, otherwise the first focusable element
//   - Tab / Shift+Tab cycles within the container
//   - When `open` becomes false, restores focus to the previously
//     focused element (trigger button)

import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Preact hook that traps keyboard focus within a container element
 * while `open` is true.
 *
 * @param open              when true, the trap activates
 * @param initialFocusRef   optional element to focus on open; if
 *                          omitted, the first focusable child wins
 */
export function useFocusTrap(
  open: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    // Save the currently focused element to restore later.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Focus the requested element (explicit ref) or fall back to
    // the first focusable child. Wrapped in rAF so Preact flushes
    // the DOM (and refs attach) before we call .focus().
    const focusInitial = () => {
      const explicit = initialFocusRef?.current;
      if (explicit) {
        explicit.focus();
        return;
      }
      const els = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (els && els.length > 0) {
        els[0].focus();
      } else {
        containerRef.current?.focus();
      }
    };
    const raf = requestAnimationFrame(focusInitial);

    // Keydown handler for Tab cycling.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !containerRef.current) return;
      const els = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (els.length === 0) return;

      const first = els[0];
      const last = els[els.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last.
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first.
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      // Restore focus to the trigger element.
      previousFocusRef.current?.focus();
    };
  }, [open]);

  return containerRef;
}
