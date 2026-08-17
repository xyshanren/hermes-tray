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
  encodeShareDocV2,
  buildShareUrl,
  parseShareHash,
  SHARE_FRAGMENT_RE,
  verifyShareDocChecksum,
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
 *
 * v0.3.0 P1-13 — uses schema v2 (SHA-256 checksum). The receiving
 * tray verifies the checksum and rejects the link if it was tampered
 * with or got truncated mid-flight. encodeShareDocV2 is async
 * because it relies on `crypto.subtle.digest`.
 */
export async function copySessionShareLink(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  showToast: (title: string, message: string, type: "success" | "error" | "info") => void,
  sessionId: string,
): Promise<void> {
  try {
    const doc = await invoke<{
      session: { id: string; title: string };
      messages: Array<{ role: string; content: string }>;
    }>("export_session_json", { sessionId });
    const encoded = await encodeShareDocV2(doc.session, doc.messages);
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
 * v0.3.0 P1-13 — async now so the v2 checksum can be verified via
 * `crypto.subtle.digest`. v1 docs skip checksum verification (no
 * checksum field exists in the legacy payload) and are accepted as-is
 * so old shared links keep working.
 *
 * Returned shape (when valid):
 *   { ok: true,  doc: ShareDoc }
 *   { ok: false, reason: 'no-match' | 'decode-failed' | 'unsupported-version' | 'checksum-mismatch', version?: number }
 */
export type ShareHashValidation =
  | { ok: true; doc: import("../types").ShareDoc }
  | { ok: false; reason: "no-match" | "decode-failed" | "unsupported-version" | "checksum-mismatch"; version?: number };

export async function validateShareHash(hash: string): Promise<ShareHashValidation> {
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
  if (doc.version !== 1 && doc.version !== 2) {
    return { ok: false, reason: "unsupported-version", version: doc.version };
  }
  // v0.3.0 P1-13 — v2 docs must pass checksum verification. v1 docs
  // skip the check (no checksum field) and are accepted as legacy.
  if (doc.version === 2) {
    const ok = await verifyShareDocChecksum(doc);
    if (!ok) return { ok: false, reason: "checksum-mismatch" };
  }
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

export { encodeShareDocV2, buildShareUrl, parseShareHash } from "../shareLink";