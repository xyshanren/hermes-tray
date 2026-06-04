import { describe, it, expect } from "vitest";
import { formatMessage } from "./formatMessage";

describe("formatMessage (marked 包装)", () => {
  it("纯文本应包在 <p> 里", () => {
    const html = formatMessage("hello");
    expect(html).toContain("<p>hello</p>");
  });

  it("应渲染 **bold** 为 <strong>", () => {
    const html = formatMessage("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("应渲染 *italic* 为 <em> (breaks=true 时也行)", () => {
    const html = formatMessage("*italic*");
    expect(html).toContain("<em>italic</em>");
  });

  it("应把单换行转成 <br> (breaks=true)", () => {
    const html = formatMessage("line1\nline2");
    expect(html).toContain("<br");
  });

  it("应渲染 GFM 表格", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const html = formatMessage(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("marked v18 不自动转义 HTML (需依赖 escapeHtml 防护 XSS)", () => {
    // 已知行为: marked v18 默认不转义 HTML, 这是为什么 src/main.ts 的 showToast 需要 escapeHtml 工具
    // 本测试记录此行为, 提醒下游: 用户提供的 raw HTML 必须用 escapeHtml.ts 单独处理
    const html = formatMessage("<script>alert(1)</script>");
    // marked 把 <script>...</script> 视为内联 HTML, 直接保留
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
  });

  it("代码块反引号应渲染为 <code>", () => {
    const html = formatMessage("`code`");
    expect(html).toContain("<code>code</code>");
  });
});
