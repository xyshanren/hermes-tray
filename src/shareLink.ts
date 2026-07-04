// v0.2 — Base64 URL-safe encoding/decoding. Pure functions, no DOM dependencies.
// Mirrors base64UrlEncode/base64UrlDecode from main.ts (T-Q-S10 share link).
// Tests at shareLink.test.ts now import directly from this module.

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