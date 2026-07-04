// v0.2 — Share-link encoding (T-Q-S10).
//
// A session can be shared as a self-contained URL:
//   `${origin}${pathname}#share=<base64url(JSON.stringify(doc))>`
//
// The receiving end reads the URL fragment, decodes the JSON, and (after
// user confirmation) re-creates the session locally. No server needed for
// the MVP; no HMAC signature either — acceptable for personal use, may
// be added in a future T-Q-S10.x iteration.
//
// This module is pure (no DOM, no Tauri, no clipboard) so it can be
// unit-tested in isolation. The DOM- and Tauri-touching wrappers
// (`copySessionAsMarkdown`, `copySessionShareLink`, `maybeImportFromHash`)
// stay in main.ts.

/**
 * Encode a string as URL-safe base64 (RFC 4648 §5).
 * - URL-safe: '+' → '-', '/' → '_'
 * - No padding: trailing '=' stripped
 * - UTF-8 safe: works for emoji, CJK, etc.
 */
export function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode a URL-safe base64 string back to its original UTF-8 form.
 * Accepts missing padding by re-adding it before atob().
 */
export function base64UrlDecode(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Regex for matching a #share=... URL fragment.
 * Captures the base64url payload after the prefix.
 */
export const SHARE_FRAGMENT_RE = /^#share=(.+)$/;

// ── Higher-level share-link helpers ──────────────────────────────────────
//
// encodeShareDoc / decodeShareDoc own the JSON ↔ base64url boundary.
// buildShareUrl assembles the final URL given a pre-encoded payload so
// callers don't have to keep concatenating '#share=' strings.
// parseShareHash does the inverse — extract a doc from a raw hash string
// (or return null if the hash isn't a share fragment).

/**
 * Encode a JSON-serializable value into a base64url string suitable for
 * a URL fragment.
 */
export function encodeShareDoc(doc: unknown): string {
  return base64UrlEncode(JSON.stringify(doc));
}

/**
 * Decode a base64url string back into its parsed JSON document.
 * Throws if the payload isn't valid base64url or valid JSON — callers
 * should catch and surface a toast.
 */
export function decodeShareDoc(encoded: string): unknown {
  return JSON.parse(base64UrlDecode(encoded));
}

/**
 * Build a full share URL `${origin}${pathname}#share=${encoded}`.
 * `origin` and `pathname` are passed in (instead of read from
 * window.location) so this stays a pure function and is unit-testable.
 */
export function buildShareUrl(encoded: string, origin: string, pathname: string): string {
  return `${origin}${pathname}#share=${encoded}`;
}

/**
 * Try to extract a decoded share document from a URL hash.
 * Returns `null` when the hash is empty, doesn't match `#share=...`,
 * or fails to decode. Useful for the "auto-detect on boot" flow that
 * should silently no-op for non-share URLs.
 */
export function parseShareHash(hash: string): unknown | null {
  const m = hash.match(SHARE_FRAGMENT_RE);
  if (!m) return null;
  try {
    return decodeShareDoc(m[1]);
  } catch {
    return null;
  }
}