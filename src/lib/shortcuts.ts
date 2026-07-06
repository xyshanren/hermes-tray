// v0.2-alpha-19 — Global shortcut registration.
//
// Extracted from main.ts DOMContentLoaded. Wires the
// `Ctrl+Shift+H → quick capture new session` global shortcut via the
// Tauri global-shortcut plugin. Best-effort: registration failures
// are logged but never throw (the OS may not allow the binding).
//
// main.ts passes in callbacks (createSession + focus helpers) so the
// module has no direct import on main.ts's module-level lets.

import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface ShortcutDeps {
  /** Called when the shortcut fires. Should return the new session id
   *  (or null if creation failed). */
  createSession: () => Promise<string | null>;
  /** Called after a successful createSession to clear + focus the
   *  textarea so the user can start typing immediately. */
  clearAndFocusInput: () => void;
  /** Called to hide the sidebar (quick capture wants focus mode). */
  hideSidebar: () => void;
}

const QUICK_CAPTURE_SHORTCUT = "Ctrl+Shift+H";

/**
 * Register the Ctrl+Shift+H global shortcut. Returns a dispose handle
 * the caller invokes on window unload. Best-effort: returns a
 * no-op dispose handle if registration fails.
 */
export async function registerQuickCaptureShortcut(
  deps: ShortcutDeps,
): Promise<() => Promise<void>> {
  let registered = false;
  try {
    await register(QUICK_CAPTURE_SHORTCUT, async () => {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
      const newId = await deps.createSession();
      if (!newId) {
        console.warn("[GlobalShortcut] createSession returned null");
        deps.clearAndFocusInput();
        return;
      }
      // 收掉侧边栏到 focus 模式、清空输入、focus 让用户立刻打字
      deps.hideSidebar();
      deps.clearAndFocusInput();
    });
    registered = true;
    console.log(`[GlobalShortcut] ${QUICK_CAPTURE_SHORTCUT} registered (quick capture)`);
  } catch (e) {
    console.warn("[GlobalShortcut] Failed to register:", e);
  }
  return async () => {
    if (!registered) return;
    try {
      await unregister(QUICK_CAPTURE_SHORTCUT);
    } catch {
      /* ignore — Tauri may have already cleared it on window close */
    }
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function __resetForTests(): void {
  /* no module-level state to reset (registration is idempotent in
     Tauri but we don't track it here). */
}