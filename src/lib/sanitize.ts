// v0.2 — HTML escaping + snippet sanitization helpers.
//
// escapeHtml: 通用 HTML escape，用于 innerHTML 拼接用户/DB 数据时。
//   v0.3.0 P1-9 — also escapes `"` and `'` so the result is safe inside
//   attribute contexts (`onclick="..."`, `href="..."`). The previous
//   implementation only escaped `<`, `>`, `&`, which is fine when the
//   string lands in element text but breaks a the moment it lands
//   inside an attribute value: `<a title="${escapeHtml(input)}">`
//   could be escaped out via `x" onmouseover="alert(1)`.
//
// sanitizeSnippet: FTS5 snippet 自带 <b> 高亮标签，需要保留；其他危险
//   HTML 全部剥除。
//   v0.3.0 P1-10 — backed by DOMPurify (configured ALLOWED_TAGS=[b])
//   so we keep <b> for highlighting and drop script/on*=javascript:
//   reliably (the hand-rolled stripper from alpha-7 had a few subtle
//   bypasses — see audit §5.1 P9).

// v0.3.0 P1-10 — switch from `dompurify` to `isomorphic-dompurify`. The
// pure browser `dompurify` package crashes inside vitest+happy-dom because
// its internal sandbox <iframe> element hits a happy-dom bug. The
// isomorphic wrapper creates a JSDOM window when running under Node
// (vitest, SSR) and uses the browser DOM otherwise — same surface API.
import DOMPurify from "isomorphic-dompurify";

/** Escape user- or DB-supplied text before injecting into innerHTML
 *  (element text **or** attribute value). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip dangerous HTML from an FTS5 snippet. Keeps <b> for highlighting.
 * Removes <script>, on*= event handlers, javascript:/data: URIs, and any
 * tag other than <b>.
 *
 * v0.3.0 P1-10 — replaced the alpha-7 hand-rolled regex stripper with
 * DOMPurify. The regex approach had subtle gaps around entity-encoded
 * `javascript:` (`&#106;avascript:`) and certain on-event shorthands
 * (e.g. `<a/onmouseover=...>`); DOMPurify's HTML parser handles both
 * correctly.
 */
export function sanitizeSnippet(s: string): string {
  return DOMPurify.sanitize(s, {
    ALLOWED_TAGS: ["b"],
    ALLOWED_ATTR: [],
  });
}