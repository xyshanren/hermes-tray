/**
 * escapeHtml — XSS 防护纯函数.
 *
 * 背景: src/main.ts 的 showToast() 当前用 innerHTML 直接插入 title/message，
 *       存在 XSS 风险（用户提供的消息可注入 <script> 等）.
 *       本模块提供标准 XSS escape 工具，可直接复用或后续集成到 showToast.
 *
 * 设计: 转义全部 5 个 HTML 特殊字符（&, <, >, ", '），顺序很关键 —
 *       必须先转 &, 否则后续注入的 &lt; 会被再次转义成 &amp;lt;.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
