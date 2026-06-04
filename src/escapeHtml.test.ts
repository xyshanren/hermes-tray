import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escapeHtml";

describe("escapeHtml", () => {
  it("空字符串应原样返回", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("纯文本不应被修改", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("应转义 & 为 &amp;", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("应转义 < 和 > 为 &lt; / &gt;", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("应转义双引号和单引号", () => {
    // O"Re'illy — 包含一个双引号, 一个单引号, 一个撇号样式撇 (right single quotation mark)
    expect(escapeHtml(`O"Re'illy`)).toBe("O&quot;Re&#39;illy");
  });

  it("应转义标准撇号 O'Brien 中的单引号", () => {
    expect(escapeHtml("O'Brien")).toBe("O&#39;Brien");
  });

  it("XSS payload <script>alert(1)</script> 应被完全转义", () => {
    const xss = "<script>alert(1)</script>";
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&lt;/script&gt;");
  });

  it("javascript: 协议不应被破坏成可执行 URL", () => {
    const evil = `<a href="javascript:alert(1)">click</a>`;
    const escaped = escapeHtml(evil);
    expect(escaped).not.toContain('href="javascript:');
    expect(escaped).toContain("&lt;a");
    expect(escaped).toContain("&quot;javascript:alert(1)&quot;");
  });

  it("& 必须先转, 否则不会双重转义", () => {
    // 如果先转 <, 再转 &, "<script>" 会变成 "&lt;script>" 然后被转成 "&amp;lt;script>"
    // 正确做法是先转 &, 再转 < — 确保输出只含一个 &amp; 前缀
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&")).toBe("&amp;");
    // 验证: 输入 "<&>" 应变成 "&lt;&amp;&gt;" 而非 "&amp;lt;&amp;amp;&amp;gt;"
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });
});
