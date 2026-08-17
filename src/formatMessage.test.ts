// v0.3.0 P1-10 — tests for the DOMPurify-wrapped formatMessage.
//
// vitest environment: jsdom. Plain happy-dom (the project default) makes
// DOMPurify's internal sandbox <iframe> crash (happy-dom iframe impl
// reads from a property happy-dom itself nulled out). jsdom handles it
// correctly and is already in the dep tree via isomorphic-dompurify.
// @vitest-environment jsdom
//
// Behaviour change vs alpha-X: marked 18 does NOT auto-escape HTML, so
// before this fix assistant markdown like `<script>alert(1)</script>`
// rendered as-is into the chat view's innerHTML (audit §5.1 P10).
// After the fix, formatMessage() pipes marked's output through DOMPurify
// with an allowlist (markdown tags + hljs + GFM tables/inputs) — every
// test below either shows legitimate markdown still passes through, or
// shows a malicious payload is neutralised.

import { describe, it, expect } from "vitest";
import { formatMessage } from "./formatMessage";

describe("formatMessage (marked + DOMPurify)", () => {
  it("renders plain text inside <p>", () => {
    expect(formatMessage("hello")).toContain("<p>hello</p>");
  });

  it("renders **bold** as <strong>", () => {
    expect(formatMessage("**bold**")).toContain("<strong>bold</strong>");
  });

  it("renders *italic* as <em> (breaks=true)", () => {
    expect(formatMessage("*italic*")).toContain("<em>italic</em>");
  });

  it("converts single line breaks to <br> (breaks=true)", () => {
    expect(formatMessage("line1\nline2")).toContain("<br");
  });

  it("renders GFM tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const html = formatMessage(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders code spans and fenced code blocks", () => {
    expect(formatMessage("`code`")).toContain("<code>code</code>");
    expect(formatMessage("```\nhello\n```")).toContain("<pre>");
  });

  it("preserves benign HTML pass-through (class attribute for hljs)", () => {
    // marked keeps spans with classes when it sees them in the source —
    // we use a raw inline `<span class="hljs-keyword">x</span>` so the
    // assertion doesn't depend on the highlight integration.
    const html = formatMessage('<span class="hljs-keyword">x</span>');
    expect(html).toContain('class="hljs-keyword"');
  });

  // ── v0.3.0 P1-10 — DOMPurify security boundary ────────────────────────

  it("strips <script> tags entirely (the audit P10 case)", () => {
    const html = formatMessage("safe\n<script>alert(1)</script>\nafter");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    // Case-insensitive too.
    const html2 = formatMessage("<SCRIPT>alert(1)</SCRIPT>");
    expect(html2).not.toContain("alert(1)");
  });

  it("strips inline event handlers (onerror / onclick / onload)", () => {
    expect(formatMessage('<img src=x onerror="alert(1)">')).not.toContain(
      "onerror",
    );
    expect(formatMessage('<img src=x onerror="alert(1)">')).not.toContain(
      "alert(1)",
    );
    expect(formatMessage('<a onclick="bad()">x</a>')).not.toContain("onclick");
    expect(formatMessage('<svg onload="alert(1)" />')).not.toContain("alert");
  });

  it("strips javascript: URIs from href", () => {
    const html = formatMessage('[click](javascript:alert(1))');
    expect(html).not.toContain("javascript:");
  });

  it("strips data: URIs (the data:text/html XSS vector)", () => {
    const html = formatMessage(
      '[click](data:text/html,<script>alert(1)</script>)',
    );
    expect(html).not.toContain("data:text/html");
  });

  it("strips <iframe> / <object> / <embed> / <form> / <button> entirely", () => {
    expect(formatMessage("<iframe src=x></iframe>")).not.toContain("<iframe");
    expect(formatMessage("<object data=x></object>")).not.toContain("<object");
    expect(formatMessage("<embed src=x />")).not.toContain("<embed");
    expect(formatMessage("<form action=x></form>")).not.toContain("<form");
    expect(formatMessage("<button>click</button>")).not.toContain("<button");
  });

  it("strips style attribute (no inline CSS injection)", () => {
    const html = formatMessage('<p style="background:url(javascript:alert(1))">x</p>');
    expect(html).not.toContain("style=");
  });

  it("renders markdown headings", () => {
    expect(formatMessage("# H1")).toMatch(/<h1[^>]*>H1<\/h1>/);
    expect(formatMessage("### H3")).toMatch(/<h3[^>]*>H3<\/h3>/);
  });

  it("renders GFM task list checkboxes", () => {
    // marked 18 emits `<input disabled>` (no `type` attribute — the
    // browser default `type="checkbox"` does the rest). DOMPurify keeps
    // `disabled` + `checked` and drops anything else, which is what we
    // want for a static (non-interactive) task-list rendering.
    const html = formatMessage("- [ ] todo\n- [x] done");
    expect(html).toContain("<input");
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
    expect(html).not.toContain('type="checkbox"'); // explicit no, see comment
  });

  it("renders a mixed markdown doc end-to-end", () => {
    const md = [
      "# Title",
      "",
      "Paragraph with **bold** and `code`.",
      "",
      "- item 1",
      "- item 2",
      "",
      "[link](https://example.com)",
    ].join("\n");
    const html = formatMessage(md);
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>item 1</li>");
    expect(html).toContain('href="https://example.com"');
  });
});