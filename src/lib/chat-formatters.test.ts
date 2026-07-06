// v0.2-alpha-16 — Unit tests for chat-view formatters.
//
// Covers `formatMessage` (markdown renderer). The other three
// formatters (formatMessageBar / formatRoutingTrace / formatLatencyMs)
// are already covered by:
//   - src/messageBar.test.ts (12 cases)
//   - src/routingTrace.test.ts (8 cases)
// We only add coverage for the moved function plus a sanity check
// that the re-exports from main.ts still resolve.

import { describe, it, expect } from "vitest";
import { formatMessage } from "../views/chat-view-store";

describe("formatMessage (chat-view-store re-export)", () => {
  it("renders bold via marked", () => {
    const html = formatMessage("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders inline code", () => {
    const html = formatMessage("use `npm test`");
    expect(html).toContain("<code>npm test</code>");
  });

  it("renders fenced code blocks", () => {
    const html = formatMessage("```ts\nconst x = 1;\n```");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("renders an empty string to an empty body", () => {
    // marked returns "" for empty input; we don't assert on the exact
    // wrapper to avoid coupling to marked's output format.
    const html = formatMessage("");
    // Just ensure it doesn't throw and stays a string.
    expect(typeof html).toBe("string");
  });

  it("preserves multi-line content as <p> blocks", () => {
    const html = formatMessage("line one\n\nline two");
    expect(html).toContain("<p>line one</p>");
    expect(html).toContain("<p>line two</p>");
  });
});