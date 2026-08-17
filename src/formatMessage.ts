/**
 * formatMessage — marked.parse 的薄包装 (with DOMPurify sanitize).
 *
 * v0.2-alpha-X — 原版只是 `marked.parse(content) as string`. marked 18 已经
 *   移除了 sanitize 选项,直接 innerHTML 会被 audit §5.1 P10 标为 HIGH 风险:
 *   assistant 内容经过 hermes-agent (Python 进程) 流式传来,中间任何篡改
 *   (恶意代理 / API 错误 / 被攻陷的模型权重) 都能注入 HTML / 事件处理器。
 *
 * v0.3.0 P1-10 — 包一层 DOMPurify.sanitize, ALLOWED_TAGS 覆盖标准 markdown
 *   元素 + highlight.js 的 <span class="hljs-..."> + GFM 表格。ALLOWED_ATTR
 *   只放 class + href(协议白名单) + target + rel,其它全部剥掉。Danger
 *   标签 / 事件处理器 / javascript: 协议 URI 全部被 DOMPurify 拦下来。
 *
 * 镜像 src/main.ts 中 formatMessage() 的实现 (line 347-350):
 *
 *   function formatMessage(content: string): string {
 *     return DOMPurify.sanitize(marked.parse(content) as string, ALLOWED_CONFIG);
 *   }
 *
 * 不直接 import main.ts 是因为 main.ts 顶层有 window.addEventListener('DOMContentLoaded', ...)
 * + Tauri invoke import,会拉进 Tauri runtime 依赖并污染测试环境。
 *
 * 真实部署里 main.ts 的 marked 仍然由它自己的 marked.use(markedHighlight) 配置,
 * 测试时只关注 markdown → HTML → safe HTML 的纯转换行为。
 */
import { marked } from "marked";
// v0.3.0 P1-10 — use the isomorphic build so vitest+happy-dom (which
// crashes on plain dompurify's sandbox <iframe>) still works. The
// wrapper creates a JSDOM window under Node and uses the real browser
// DOM inside the Tauri WebView — identical sanitization behaviour.
import DOMPurify from "isomorphic-dompurify";

// 复刻 main.ts 顶层的 marked.setOptions (marked 是单例,setOptions 幂等)
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * DOMPurify config tuned for assistant markdown output:
 *
 * - ALLOWED_TAGS: standard markdown tags + hljs <span class="hljs-...">
 *   wrapping + GFM table cells. <input>, <form>, <button>, <iframe>,
 *   <embed>, <object> are NOT in the list so DOMPurify strips them.
 *
 * - ALLOWED_ATTR: only class (for hljs theming) + href + target + rel
 *   on anchors. No `style`, no event handlers, no `src` (assistant
 *   markdown doesn't embed images by design; if we add that later the
 *   src allowlist + URL filter needs to revisit).
 *
 * - ALLOWED_URI_REGEXP: protocol allowlist — http / https / mailto.
 *   Blocks javascript:, data:, file:, vbscript:. This is the same
 *   allowlist used by the alpha-33b P1-2 external-link interceptor,
 *   so a malicious anchor that survives sanitization is still rejected
 *   when the user clicks it.
 */
// `isomorphic-dompurify` re-exports `Config` only as `DOMPurify.Config`
// in some typings and as a top-level `Config` in others; letting TS
// infer the const preserves compat across both shapes.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "small",
    "ul", "ol", "li",
    "blockquote",
    "code", "pre",
    "a",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "span",  // highlight.js uses <span class="hljs-...">
    "input", // GFM task list: `- [ ]` / `- [x]` → <input disabled type="checkbox">
  ],
  ALLOWED_ATTR: ["class", "href", "target", "rel", "type", "checked", "disabled"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  // KEEP_CONTENT: keep text text inside stripped tags (so `<script>alert(1)</script>`
  // becomes `alert(1)`, not empty — the audit doesn't mandate dropping text).
  KEEP_CONTENT: true,
  // FORBID_TAGS / FORBID_ATTR: belt-and-suspenders. DOMPurify already
  // strips these by default; the explicit list documents intent.
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "button"],
  FORBID_ATTR: ["style", "src", "onerror", "onload", "onclick", "onmouseover"],
};

/**
 * 把 markdown 字符串渲染为 **安全的** HTML 字符串.
 * 与 main.ts 的 formatMessage 等价 (除 highlight 扩展外, 本测试不依赖代码高亮).
 */
export function formatMessage(content: string): string {
  const raw = marked.parse(content) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}