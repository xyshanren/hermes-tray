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

// ── v0.3.0 P1-13 — share-link schema v2 (checksum) ─────────────────────────────────
//
// The v1 schema (encodeShareDoc above) wraps a JSON doc in base64url with no
// tamper detection. v2 adds a SHA-256 checksum over the (session, messages)
// payload so the receiving end can reject corrupted / hand-edited links
// instead of importing nonsense. The canonical input to the hash is just
// the session + messages (no version / checksum fields) so the digest is
// stable across re-encodings of the same conversation.
//
// We use Web Crypto (`crypto.subtle.digest`) — available in both the
// Tauri WebView and Node 20+ (vitest happy-dom) — instead of pulling a
// synchronous hash lib. The 16-hex-char slice (64 bits) is plenty for
// per-document collision resistance and keeps the URL fragment short.

/** v0.3.0 P1-13: share-link schema v2 marker. */
export const SHARE_DOC_VERSION_V2 = 2 as const;

/** Canonical fields fed into the v2 checksum. */
type ChecksummedFields = { session: unknown; messages: unknown };

/**
 * Hex-encode a Uint8Array buffer (Web Crypto digest output).
 * Pure function for testability.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute the SHA-256 hex digest of a string (UTF-8 bytes).
 * Async because Web Crypto's subtle.digest is Promise-based.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** Length (hex chars) of the v2 checksum slice stored in the link. */
export const SHARE_CHECKSUM_HEX_LEN = 16;

/**
 * Build the canonical JSON string used as v2 checksum input.
 * Stable across re-encodings of the same (session, messages) pair.
 */
export function canonicalChecksumInput(fields: ChecksummedFields): string {
  return JSON.stringify(fields);
}

/**
 * Encode (session, messages) as a v2 share doc with an embedded
 * SHA-256 checksum. Returns the base64url payload — caller wraps it
 * in `${origin}${pathname}#share=...`.
 *
 * Async because Web Crypto's digest is Promise-based.
 */
export async function encodeShareDocV2(
  session: { id: string; title: string },
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const checksumInput = canonicalChecksumInput({ session, messages });
  const fullDigest = await sha256Hex(checksumInput);
  const checksum = fullDigest.slice(0, SHARE_CHECKSUM_HEX_LEN);
  const doc = { version: SHARE_DOC_VERSION_V2, session, messages, sha256: checksum };
  return base64UrlEncode(JSON.stringify(doc));
}

/**
 * Verify a v2 share doc's checksum. Returns true when the embedded
 * sha256 matches a fresh recomputation; false when the doc was
 * tampered with, truncated, or the URL got corrupted mid-flight.
 *
 * Returns false on v1 docs (no checksum to verify against) — the
 * caller decides whether v1 = "legacy, accept" or "reject".
 */
export async function verifyShareDocChecksum(doc: { version: unknown; session: unknown; messages: unknown; sha256?: unknown }): Promise<boolean> {
  if (doc.version !== SHARE_DOC_VERSION_V2) return false;
  if (typeof doc.sha256 !== "string") return false;
  const checksumInput = canonicalChecksumInput({ session: doc.session, messages: doc.messages });
  const fullDigest = await sha256Hex(checksumInput);
  const expected = fullDigest.slice(0, SHARE_CHECKSUM_HEX_LEN);
  // Constant-time-ish compare via length+loop; the checksum is small
  // enough that timing leakage doesn't materially help an attacker.
  if (expected.length !== doc.sha256.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ doc.sha256.charCodeAt(i);
  }
  return diff === 0;
}