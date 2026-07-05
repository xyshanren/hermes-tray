// v0.2-alpha-7 — tests for src/lib/sanitize.ts.
// Pure functions; tests run in node env (no DOM needed).

import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeSnippet } from "./sanitize";

describe("escapeHtml", () => {
  it("escapes < and > and &", () => {
    expect(escapeHtml("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("is a no-op for safe text", () => {
    expect(escapeHtml("hello world 中文 🎉")).toBe("hello world 中文 🎉");
  });

  it("does not escape quotes or apostrophes (XSS-safe in innerHTML context)", () => {
    // Quotes don't need escaping when inserted inside text content via innerHTML;
    // attribute contexts need different escaping. InnerHTML text injection is safe.
    expect(escapeHtml("it's fine")).toBe("it's fine");
    expect(escapeHtml('"quoted"')).toBe('"quoted"');
  });
});

describe("sanitizeSnippet", () => {
  it("keeps <b> tags from FTS5 highlight", () => {
    expect(sanitizeSnippet("hello <b>world</b>")).toBe("hello <b>world</b>");
  });

  it("strips <script> tags entirely", () => {
    expect(sanitizeSnippet("safe<script>alert(1)</script>after")).toBe(
      "safeafter",
    );
    expect(sanitizeSnippet("<SCRIPT>alert(1)</SCRIPT>")).toBe("");
  });

  it("strips inline event handlers (onclick, onload, on...)", () => {
    // The regex replaces `on*=` with ` data-ignored=` — note the leading
    // space and the fact that the original attribute name's surrounding
    // text (e.g. `click="bad()"`) is preserved on the right of the `=`.
    expect(sanitizeSnippet('<a onclick="bad()">x</a>')).toBe(
      '<a  data-ignored="bad()">x</a>',
    );
    expect(sanitizeSnippet('<img src=x onerror="alert(1)">')).toBe(
      '<img src=x  data-ignored="alert(1)">',
    );
  });

  it("strips javascript: URIs", () => {
    expect(sanitizeSnippet('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a href="alert(1)">x</a>',
    );
    expect(sanitizeSnippet("javascript:alert(1)")).toBe("alert(1)");
  });

  it("preserves benign content untouched", () => {
    expect(sanitizeSnippet("hello world")).toBe("hello world");
    expect(sanitizeSnippet("中文测试 <b>粗体</b>")).toBe("中文测试 <b>粗体</b>");
  });
});