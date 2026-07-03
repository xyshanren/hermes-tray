// v0.1.5 S12: pure formatter for the per-turn CLI bar (💰 cost · ⏱ latency
// · 🛡 rule). The bar appears under each assistant message so the user
// sees the per-turn routing cost at a glance.

import { describe, it, expect } from "vitest";
import { formatMessageBar } from "./main";

describe("formatMessageBar (v0.1.5 S12)", () => {
  it("returns null when nothing to show (pre-S12 message)", () => {
    expect(
      formatMessageBar({
        costUsd: 0,
        elapsedMs: null,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBeNull();
  });

  it("renders the canonical cost + latency + rule trio", () => {
    expect(
      formatMessageBar({
        costUsd: 0.0234,
        elapsedMs: 3400,
        ruleId: "vision_fallback_config",
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0234 · ⏱ 3.4s · 🛡 vision_fallback_config");
  });

  it("renders just the cost when latency/rule missing", () => {
    expect(
      formatMessageBar({
        costUsd: 0.005,
        elapsedMs: null,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0050");
  });

  it("renders just the latency when cost/rule missing", () => {
    expect(
      formatMessageBar({
        costUsd: 0,
        elapsedMs: 1500,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("⏱ 1.5s");
  });

  it("renders just the rule when cost/latency missing", () => {
    expect(
      formatMessageBar({
        costUsd: 0,
        elapsedMs: null,
        ruleId: "default",
        costThresholdExceeded: false,
      }),
    ).toBe("🛡 default");
  });

  it("shows sub-second latency in ms (no s)", () => {
    // S12 agents can return small elapsed_ms for cheap calls.
    expect(
      formatMessageBar({
        costUsd: 0.0001,
        elapsedMs: 850,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0001 · ⏱ 850ms");
  });

  it("hides cost when it is 0 (SSE didn't push cost_estimate_usd)", () => {
    // Defensive: even if threshold tripped, a 0 cost should NOT render
    // "💰 $0.0000" — that adds visual noise without information.
    expect(
      formatMessageBar({
        costUsd: 0,
        elapsedMs: 5000,
        ruleId: null,
        costThresholdExceeded: true,
      }),
    ).toBe("⏱ 5.0s · 🛡 cost_threshold_exceeded");
  });

  it("falls back to 'cost_threshold_exceeded' label when rule_id missing but threshold tripped", () => {
    // Edge case: S12 cost-aware fallback flagged the breach but the
    // routing_decision blob didn't include rule_id. The user should
    // still see the breach in the bar.
    expect(
      formatMessageBar({
        costUsd: 0.1234,
        elapsedMs: 8000,
        ruleId: null,
        costThresholdExceeded: true,
      }),
    ).toBe(
      "💰 $0.1234 · ⏱ 8.0s · 🛡 cost_threshold_exceeded",
    );
  });

  it("prefers rule_id over the threshold_breach fallback label", () => {
    // When both are present (the normal case for S12), rule_id wins.
    expect(
      formatMessageBar({
        costUsd: 0.05,
        elapsedMs: 2000,
        ruleId: "cost_aware_fallback",
        costThresholdExceeded: true,
      }),
    ).toBe(
      "💰 $0.0500 · ⏱ 2.0s · 🛡 cost_aware_fallback",
    );
  });

  it("formats very small cost with 4 decimal places (USD precision)", () => {
    // LLM cost is often < $0.001 for short exchanges; 4 decimals
    // (0.0001) is the smallest meaningful unit. We always emit 4
    // decimals (no trim) so a column of bars aligns visually.
    expect(
      formatMessageBar({
        costUsd: 0.0001,
        elapsedMs: null,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0001");
  });

  it("ignores negative cost (defensive: agent bug would surface as 0)", () => {
    expect(
      formatMessageBar({
        costUsd: -0.5,
        elapsedMs: 1000,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("⏱ 1.0s");
  });

  it("ignores negative or zero elapsedMs", () => {
    // formatLatencyMs already returns "" for these, so the parts list
    // ends up empty for the latency slot.
    expect(
      formatMessageBar({
        costUsd: 0.01,
        elapsedMs: 0,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0100");
    expect(
      formatMessageBar({
        costUsd: 0.01,
        elapsedMs: -100,
        ruleId: null,
        costThresholdExceeded: false,
      }),
    ).toBe("💰 $0.0100");
  });
});
