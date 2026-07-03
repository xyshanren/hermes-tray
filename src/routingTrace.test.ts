import { describe, it, expect } from "vitest";
import { formatRoutingTrace, formatLatencyMs } from "./main";

describe("formatRoutingTrace (S14)", () => {
  it("returns empty string for null", () => {
    expect(formatRoutingTrace(null)).toBe("");
  });

  it("returns empty string for invalid JSON", () => {
    expect(formatRoutingTrace("not json")).toBe("");
  });

  it("renders native mode with primary provider/model", () => {
    expect(
      formatRoutingTrace(
        JSON.stringify({
          mode: "native",
          primary_provider: "openai",
          primary_model: "gpt-5",
          resolved_provider: "openai",
          resolved_model: "gpt-5",
        }),
      ),
    ).toBe("vision native: openai/gpt-5");
  });

  it("renders text mode with aux vision fallback", () => {
    expect(
      formatRoutingTrace(
        JSON.stringify({
          mode: "text",
          primary_provider: "openai",
          primary_model: "gpt-5",
          resolved_provider: "anthropic",
          resolved_model: "claude-opus-4-6",
          fallback_used: true,
          fallback_reason: "primary_unavailable",
          fallback_provider: "anthropic",
          fallback_model: "claude-opus-4-6",
        }),
      ),
    ).toBe(
      "vision fallback: anthropic/claude-opus-4-6 (primary primary_unavailable)",
    );
  });

  it("ignores unknown fields gracefully", () => {
    // Future agent-side additions shouldn't break the UI.
    expect(
      formatRoutingTrace(
        JSON.stringify({
          mode: "native",
          resolved_provider: "x",
          resolved_model: "y",
          // New fields the renderer doesn't know about.
          tool_calls: ["x"],
          experimental: { foo: "bar" },
        }),
      ),
    ).toBe("vision native: x/y");
  });
});

describe("formatLatencyMs (S14)", () => {
  it("returns empty string for null/negative", () => {
    expect(formatLatencyMs(null)).toBe("");
    expect(formatLatencyMs(-1)).toBe("");
  });

  it("renders sub-second as ms", () => {
    expect(formatLatencyMs(123)).toBe("123ms");
    expect(formatLatencyMs(999)).toBe("999ms");
  });

  it("renders >= 1s as decimal seconds", () => {
    expect(formatLatencyMs(1000)).toBe("1.0s");
    expect(formatLatencyMs(3400)).toBe("3.4s");
  });
});
