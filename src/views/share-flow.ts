// v0.2-alpha-15 — Share-link outbound + inbound helpers.
//
// All non-UI logic for the share-link feature lives here so it can be
// unit-tested in isolation. The Preact view in ./share-modal.tsx owns
// the import confirmation UI; main.ts owns the share-link-btn click
// handler that calls copySessionShareLink().
//
// Pure helpers (encodeShareDoc / buildShareUrl / parseShareHash) stay
// in src/shareLink.ts — they're domain logic, not view logic.

import {
  encodeShareDoc,
  buildShareUrl,
  parseShareHash,
  SHARE_FRAGMENT_RE,
} from "../shareLink";

// ── Outbound: copy markdown to clipboard ───────────────────────────────────

/**
 * Invoke `export_session_markdown` and copy the result to the system
 * clipboard. Sidebar context menu entry point.
 */
export async function copySessionAsMarkdown(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  showToast: (title: string, message: string, type: "success" | "error" | "info") => void,
  sessionId: string,
): Promise<void> {
  try {
    const md = await invoke<string>("export_session_markdown", { sessionId });
    await navigator.clipboard.writeText(md);
    showToast("已复制", `Markdown ${md.length} 字符到剪贴板`, "success");
  } catch (e) {
    showToast("导出失败", String(e), "error");
  }
}

// ── Outbound: build share URL + copy to clipboard ──────────────────────────

/**
 * Build a self-contained share link. The session's full state
 * (title, messages, persona, project) is encoded in the URL fragment
 * so the receiving end can preview the import without any server.
 */
export async function copySessionShareLink(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  showToast: (title: string, message: string, type: "success" | "error" | "info") => void,
  sessionId: string,
): Promise<void> {
  try {
    const json = await invoke<unknown>("export_session_json", { sessionId });
    const encoded = encodeShareDoc(json);
    const url = buildShareUrl(encoded, window.location.origin, window.location.pathname);
    await navigator.clipboard.writeText(url);
    showToast(
      "分享链接已复制",
      `${url.length} 字符 — 发给好友，对方点顶部“导入”按钮粘贴即可`,
      "success",
    );
  } catch (e) {
    showToast("生成链接失败", String(e), "error");
  }
}

// ── Inbound: parse + validate hash → ShareDoc preview ──────────────────────

/**
 * Decode a `#share=...` URL fragment. Returns null on no-match,
 * decode failure, or unsupported version. The caller (main.ts boot
 * hook) decides whether to surface a toast or open the import modal.
 *
 * Returned shape (when valid):
 *   { ok: true,  doc: ShareDoc }
 *   { ok: false, reason: 'no-match' | 'decode-failed' | 'unsupported-version', version?: number }
 *
 * Validation rule: doc.version must === 1. Anything else returns
 * 'unsupported-version' with the offending value attached.
 */
export type ShareHashValidation =
  | { ok: true; doc: import("../types").ShareDoc }
  | { ok: false; reason: "no-match" | "decode-failed" | "unsupported-version"; version?: number };

export function validateShareHash(hash: string): ShareHashValidation {
  // Pattern check first — if the hash doesn't match #share=... at
  // all (empty hash, plain anchor, or any other fragment), it's a
  // no-match and the caller silently ignores it. The previous
  // implementation folded no-match into decode-failed, which made
  // every cold-boot of the app pop a "URL 片段格式错误或已损坏"
  // toast (caught during v0.2-alpha-26 manual verification — the
  // toast was firing even on a vanilla `tauri://localhost/` URL).
  if (!SHARE_FRAGMENT_RE.test(hash)) return { ok: false, reason: "no-match" };
  // Pattern matched — try to decode the base64url payload.
  const decoded = parseShareHash(hash);
  if (decoded === null) return { ok: false, reason: "decode-failed" };
  const doc = decoded as import("../types").ShareDoc;
  if (doc.version !== 1) return { ok: false, reason: "unsupported-version", version: doc.version };
  return { ok: true, doc };
}

// ── Inbound: execute import → create new local session ────────────────────

/**
 * Execute the import: create a new local session titled `[分享] <title>`,
 * then append each message. The persona/project from the share doc
 * are dropped (different local IDs would be needed — out of scope for MVP).
 *
 * Returns the new session id so the caller can navigate to it.
 */
export async function executeShareImport(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  doc: import("../types").ShareDoc,
): Promise<string> {
  const newSession = await invoke<{ id: string }>("session_create", {
    title: `[分享] ${doc.session.title}`,
    personaId: null,
    projectDir: null,
    projectContext: null,
  });
  for (const m of doc.messages) {
    await invoke("message_append", {
      sessionId: newSession.id,
      role: m.role,
      content: m.content,
      toolCalls: null,
    });
  }
  return newSession.id;
}

// ── Inbound: URL hash clearing ────────────────────────────────────────────

/**
 * Strip the `#share=...` fragment from the URL so the next reload
 * doesn't re-trigger the import flow. Uses `pathname + search` to
 * preserve any query string the URL might have.
 */
export function clearShareHash(): void {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// ── Re-exports for callers that don't want to import shareLink directly ──
//
// These re-exports keep the call sites in src/views/ clean (one import
// instead of two) and document the intent: "everything related to the
// share flow lives in src/views/share-flow.ts".

export { encodeShareDoc, buildShareUrl, parseShareHash } from "../shareLink";