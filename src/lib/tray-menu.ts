// v0.2-alpha-19 — Tray menu event listeners.
//
// Extracted from main.ts DOMContentLoaded. Wires the three
// `tray://...` events the Rust side emits when the user clicks a
// tray menu item (新建会话 / 续上次 / 搜索). main.ts passes in
// callbacks so the module has no direct import on main.ts's
// module-level lets.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { showToast, type ToastType } from "./toast";

export interface TrayMenuDeps {
  /** Called when the user clicks tray → new session. */
  createSession: () => Promise<string | null> | void;
  /** Called when the user clicks tray → continue last (loads the
   *  most recent non-empty session). */
  loadLastSession: () => Promise<void> | void;
  /** Called when the user clicks tray → search (opens the search
   *  modal — wired via the existing searchModalStore). */
  openSearchModal: () => void;
}

/**
 * Subscribe to the three tray menu events + the cross-cutting
 * gateway-notification toast channel. Returns a dispose handle
 * that the caller invokes on window unload.
 */
export async function registerTrayMenuListeners(
  deps: TrayMenuDeps,
): Promise<() => Promise<void>> {
  const unlisteners: UnlistenFn[] = [];

  unlisteners.push(
    await listen("tray://new-session", () => {
      void deps.createSession();
    }),
  );
  unlisteners.push(
    await listen("tray://continue-last", () => {
      void deps.loadLastSession();
    }),
  );
  unlisteners.push(
    await listen("tray://open-search", () => {
      deps.openSearchModal();
    }),
  );

  // Cross-cutting: any backend-side toast (e.g. hermes-agent pushing
  // a notification) is forwarded to the in-app toast system.
  unlisteners.push(
    await listen<{ type: string; title: string; message: string }>(
      "gateway-notification",
      (event) => {
        showToast(
          event.payload.title,
          event.payload.message,
          event.payload.type as ToastType,
        );
      },
    ),
  );

  return async () => {
    for (const u of unlisteners) {
      try {
        await u();
      } catch {
        /* ignore — listener may already be torn down */
      }
    }
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function __resetForTests(): void {
  /* no module-level state to reset */
}