// v0.2-alpha-19 — Share-link UI wiring (T-Q-S10).
//
// Extracted from main.ts DOMContentLoaded. Owns:
//   1. The header share-link button click — copies a self-contained
//      share URL to the clipboard for the current session.
//   2. The boot-time URL hash check — if the page was opened with a
//      `#share=...` fragment, the import modal opens. Stale /
//      malformed fragments are cleared so they don't re-trigger
//      errors on every reload (alpha-13 fix).
//
// The actual import logic (executeShareImport) and decode helpers
// (validateShareHash / clearShareHash) live in src/views/share-flow.ts
// + src/shareLink.ts (alpha-15 split). This module is the UI glue.

import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./toast";
import { shareStore } from "../views/share-modal-store";
import { mountShareImportModal } from "../views/share-modal-mount";
import { copySessionShareLink } from "../views/share-flow";
import { validateShareHash, clearShareHash } from "../views/share-flow";

export interface ShareUIDeps {
  /** Current session id (null if no session is selected — the button
   *  shows an info toast instead of erroring). */
  getCurrentSessionId: () => string | null;
}

/**
 * Wire the share-link button + the boot-time hash check + mount the
 * share import modal. Call this once in DOMContentLoaded.
 */
export function initShareUI(deps: ShareUIDeps): void {
  document.getElementById("share-link-btn")?.addEventListener("click", () => {
    const currentSessionId = deps.getCurrentSessionId();
    if (currentSessionId) {
      void copySessionShareLink(invoke, showToast, currentSessionId);
    } else {
      showToast("没有当前会话", "请先创建或选择一个会话", "info");
    }
  });

  // v0.3: paste-import entry point — the recipient side of sharing.
  // Opens the share modal in paste mode so a desktop user can feed a
  // share link (received via IM / email / doc) into the app.
  document.getElementById("share-import-btn")?.addEventListener("click", () => {
    shareStore.setPasteOpen(true);
  });

  // Check URL hash on startup for a pending share import. The
  // validateShareHash helper returns a tagged union — we dispatch on
  // the reason field per alpha-13's stale-hash fix.
  //
  // v0.3.0 P1-13 — validateShareHash is async now (it verifies the v2
  // SHA-256 checksum via crypto.subtle.digest). Fire-and-forget at
  // boot is fine — if the link is valid, shareStore.setPending opens
  // the import modal; if not, we toast + clear the hash.
  void (async () => {
    const hashResult = await validateShareHash(window.location.hash);
    if (hashResult.ok) {
      shareStore.setPending(hashResult.doc);
    } else if (hashResult.reason === "checksum-mismatch") {
      // v0.3.0 P1-13 — the v2 SHA-256 didn't match. Either the link
      // was hand-edited, truncated by a chat client, or got corrupted
      // mid-flight. Don't auto-import.
      clearShareHash();
      showToast(
        "分享链接已损坏",
        "校验和不匹配，链接可能被算改或转码损坏，请重新生成",
        "error",
      );
    } else if (hashResult.reason === "unsupported-version") {
      // Clear stale hash BEFORE returning so the link doesn't
      // re-trigger this error toast on every reload.
      clearShareHash();
      showToast(
        "分享链接版本不支持",
        `version=${hashResult.version ?? "?"}`,
        "error",
      );
    } else if (hashResult.reason === "decode-failed") {
      // Stale or malformed #share= fragment. Clear so we don't retry.
      clearShareHash();
      showToast("分享链接解析失败", "URL 片段格式错误或已损坏", "error");
    }
    // no-match: silently ignore (the URL had no #share= fragment).
    mountShareImportModal();
  })();
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function __resetForTests(): void {
  /* no module-level state to reset */
}