// v0.2 — HTML escaping + snippet sanitization helpers.
//
// escapeHtml: 通用 HTML escape，用于 innerHTML 拼接用户/DB 数据时。
// sanitizeSnippet: FTS5 snippet 自带 <b> 高亮标签，需要保留；其他危险
//   HTML (script/on*=javascript:) 全部剥除。

/** Escape user- or DB-supplied text before injecting into innerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strip dangerous HTML from FTS5 snippet. Keeps <b> for highlighting.
 * Removes <script>, on*= event handlers, and javascript: URIs.
 */
export function sanitizeSnippet(s: string): string {
  return s
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=/gi, " data-ignored=")
    .replace(/javascript:/gi, "");
}