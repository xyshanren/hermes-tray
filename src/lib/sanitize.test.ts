// v0.2-alpha-7 — tests for src/lib/sanitize.ts.
// Pure functions; tests run in happy-dom (project default) by default,
// but vitest forces jsdom here because DOMPurify's internal sandbox
// <iframe> crashes happy-dom.
// @vitest-environment jsdom
//
// v0.3.0 P1-9 + P1-10 — escapeHtml now escapes quotes (was missing)
// and sanitizeSnippet is backed by DOMPurify instead of a hand-rolled
// regex (the regex had entity-encoded `javascript:` / on-event-shorthand
// bypasses — see audit §5.1 P9). Test expectations updated accordingly.

import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeSnippet } from "./sanitize";

describe("escapeHtml", () => {
  it("escapes < and > and &", () => {
    expect(escapeHtml("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  // v0.3.0 P1-9 — escapeHtml must escape " and ' too so the result is
  // safe inside attribute contexts (onclick="...", href="..."). The
  // previous "does not escape quotes" assertion was the audit's P9
  // finding: `<a title="${escapeHtml(input)}">` could be escaped out
  // by an attacker who closes the attribute with `" onmouseover="...`.
  it("escapes double and single quotes (attribute-context safe)", () => {
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("it's fine")).toBe("it&#39;s fine");
    expect(escapeHtml(`<a title='x" onmouseover="alert(1)'>`)).toBe(
      "&lt;a title=&#39;x&quot; onmouseover=&quot;alert(1)&#39;&gt;",
    );
  });

  it("is a no-op for safe text", () => {
    expect(escapeHtml("hello world 中文 🎉")).toBe("hello world 中文 🎉");
  });

  it("escapes & first to avoid double-escaping later replacements", () => {
    // '&' must become '&amp;' BEFORE we replace '<' → '&lt;', otherwise
    // a string like "&lt;" (literal) would become "&amp;lt;" (still
    // correct) but a string like "& <" would become "&amp; &lt;"
    // which is what we want — verify the order is correct.
    expect(escapeHtml("& <")).toBe("&amp; &lt;");
  });
});

describe("sanitizeSnippet (DOMPurify-backed)", () => {
  it("keeps <b> tags from FTS5 highlight", () => {
    expect(sanitizeSnippet("hello <b>world</b>")).toContain("<b>world</b>");
  });

  it("strips <script> tags entirely", () => {
    expect(sanitizeSnippet("safe<script>alert(1)</script>after")).not.toContain(
      "<script",
    );
    expect(sanitizeSnippet("safe<script>alert(1)</script>after")).not.toContain(
      "alert(1)",
    );
    expect(sanitizeSnippet("<SCRIPT>alert(1)</SCRIPT>")).not.toContain(
      "alert(1)",
    );
  });

  it("strips inline event handlers (onclick, onload, onerror, onmouseover)", () => {
    // DOMPurify removes the event-handler attributes AND drops the
    // empty anchor / img elements it leaves behind, depending on config.
    // We assert the dangerous payload is gone — output shape varies.
    expect(sanitizeSnippet('<a onclick="bad()">x</a>')).not.toContain(
      "bad",
    );
    expect(sanitizeSnippet('<a onclick="bad()">x</a>')).toContain("x");
    expect(sanitizeSnippet('<img src=x onerror="alert(1)">')).not.toContain(
      "onerror",
    );
    expect(sanitizeSnippet('<img src=x onerror="alert(1)">')).not.toContain(
      "alert(1)",
    );
    // event-handler on element that has no real content
    expect(sanitizeSnippet('<svg onload="alert(1)" />')).not.toContain(
      "alert(1)",
    );
    // on-event shorthand with no whitespace (`<svg/onload=...>`)
    expect(sanitizeSnippet("<svg/onload=alert(1)>")).not.toContain("alert");
  });

  it("strips javascript: URIs from href / src", () => {
    expect(sanitizeSnippet('<a href="javascript:alert(1)">x</a>')).not.toContain(
      "javascript",
    );
    expect(sanitizeSnippet('<a href="javascript:alert(1)">x</a>')).toContain(
      "x",
    );
    // entity-encoded javascript: (`&#106;avascript:`) — the alpha-7
    // regex did NOT catch this; DOMPurify does.
    expect(
      sanitizeSnippet('<a href="&#106;avascript:alert(1)">x</a>'),
    ).not.toContain("javascript:");
  });

  it("strips data: URIs that can carry script payloads", () => {
    // `<a href="data:text/html,<script>alert(1)</script>">` is the
    // classic data-URI XSS vector; the audit didn't enumerate this
    // explicitly but DOMPurify's URL allowlist catches it by default.
    expect(
      sanitizeSnippet('<a href="data:text/html,<script>alert(1)</script>">x</a>'),
    ).not.toContain("data:text/html");
  });

  it("strips any tag other than <b>", () => {
    // <i>, <em>, <strong>, <a>, <img>, <script>, <style> — all gone.
    expect(sanitizeSnippet("<i>italic</i>")).not.toContain("<i>");
    expect(sanitizeSnippet("<em>em</em>")).not.toContain("<em>");
    expect(sanitizeSnippet("<strong>strong</strong>")).not.toContain(
      "<strong>",
    );
    expect(sanitizeSnippet('<a href="x">a</a>')).not.toContain("<a");
    expect(sanitizeSnippet("<img src=x />")).not.toContain("<img");
    expect(sanitizeSnippet("<style>body{}</style>")).not.toContain("<style");
  });

  it("preserves benign content untouched", () => {
    expect(sanitizeSnippet("hello world")).toBe("hello world");
    expect(sanitizeSnippet("中文测试 <b>粗体</b>")).toContain("中文测试");
    expect(sanitizeSnippet("中文测试 <b>粗体</b>")).toContain("<b>粗体</b>");
  });

  it("survives malformed / truncated payloads without throwing", () => {
    // Each of these would have given the alpha-7 regex stripper an
    // excuse to misbehave — DOMPurify's HTML parser is total.
    expect(() => sanitizeSnippet("<b>unclosed")).not.toThrow();
    expect(() => sanitizeSnippet("<<<<>>>>")).not.toThrow();
    expect(() => sanitizeSnippet("\x00\x01\x02")).not.toThrow();
  });
});