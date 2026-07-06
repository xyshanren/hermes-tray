// v0.2-alpha-19 — ShortcutsModal (Preact JSX).
//
// Renders the keyboard-shortcuts reference overlay into the existing
// <div id="shortcuts-modal"> shell. Lists 7 shortcuts across 3 groups
// per design 16 in the SVG set.
//
// Layout (matching the SVG):
//   - Modal header: title "快捷键" + × close button
//   - Body: 3 columns (全局 / 输入区 / 通用) side-by-side, each
//     with a group header + a stack of shortcut rows
//   - Footer: subtle hint text "Esc 关闭" (matches SVG)
//   - The Esc key + × button + overlay-click all close the modal
//
// Trigger: Ctrl+/ opens the modal. main.ts wires the global keydown
// listener (after mount).

import { useEffect, useState } from "preact/hooks";
import { shortcutsModalStore, SHORTCUT_GROUPS } from "./shortcuts-modal-store";
import type { ShortcutsModalState } from "./shortcuts-modal-store";

export function ShortcutsModal() {
  const state = useShortcutsModalState();

  // Escape-to-close (matches the other v0.2 modals).
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        shortcutsModalStore.setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open]);

  if (!state.open) return null;
  return (
    <div class="modal modal-shortcuts" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>⌨ 快捷键</h2>
        <button
          type="button"
          class="modal-close-btn"
          aria-label="关闭"
          onClick={() => shortcutsModalStore.setOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body shortcuts-body">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.name} class="shortcuts-group">
            <h3 class="shortcuts-group-name">{group.name}</h3>
            <ul class="shortcuts-list">
              {group.shortcuts.map((row, idx) => (
                <li key={idx} class="shortcuts-row">
                  <span class="shortcut-keys">
                    {row.keys.map((k, i) => (
                      <span key={i} class="shortcut-key">
                        {k}
                      </span>
                    ))}
                  </span>
                  <span class="shortcut-desc">{row.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div class="modal-footer">
        <span class="shortcuts-footer-hint">按 Esc 关闭</span>
      </div>
    </div>
  );
}

// ── Local hook (split out so the JSX above stays readable) ────────────────

function useShortcutsModalState(): ShortcutsModalState {
  const [state, setState] = useState<ShortcutsModalState>(shortcutsModalStore.get());
  useEffect(() => shortcutsModalStore.subscribe(setState), []);
  return state;
}