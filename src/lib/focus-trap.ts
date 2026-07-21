// v0.3 Phase 3 — Focus trap hook for modals (design spec U6).
//
// Usage inside a modal component:
//   const trapRef = useFocusTrap(open);
//   return <div ref={trapRef} role="dialog" aria-modal="true">...</div>
//
// Behaviour:
//   - When `open` becomes true, focuses the first focusable element
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
 */
export function useFocusTrap(open: boolean): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    // Save the currently focused element to restore later.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Focus the first focusable element inside the container.
    const focusFirst = () => {
      const els = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (els && els.length > 0) {
        els[0].focus();
      } else {
        containerRef.current?.focus();
      }
    };
    // Delay to allow Preact render to flush DOM.
    const raf = requestAnimationFrame(focusFirst);

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
