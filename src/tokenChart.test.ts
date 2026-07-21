import { describe, it, expect } from "vitest";
import { layoutChart, formatTokens, formatCost, DEFAULT_CHART_LAYOUT } from "./tokenChart";

const sample = [
  { date: "2026-06-20", input_tokens: 100, output_tokens: 50, cost: 0.001 },
  { date: "2026-06-21", input_tokens: 200, output_tokens: 80, cost: 0.002 },
  { date: "2026-06-22", input_tokens: 0, output_tokens: 0, cost: 0 },
  { date: "2026-06-23", input_tokens: 300, output_tokens: 100, cost: 0.003 },
];

describe("layoutChart", () => {
  it("returns sane defaults for empty input", () => {
    const { layout, points } = layoutChart([], DEFAULT_CHART_LAYOUT);
    expect(points).toEqual([]);
    expect(layout.yMax).toBe(1);
    expect(layout.scale).toBeGreaterThan(0);
  });

  it("yMax rounds up to a nice number (400 -> 500, 50 -> 50)", () => {
    const { layout } = layoutChart(sample);
    // max total = 400 (300+100). 400 rounds up to 500.
    expect(layout.yMax).toBe(500);
  });

  it("each point gets a unique x, correct stack heights", () => {
    const { points } = layoutChart(sample, DEFAULT_CHART_LAYOUT);
    expect(points).toHaveLength(4);
    const xSet = new Set(points.map((p) => p.x));
    expect(xSet.size).toBe(4);
    // Point 0: 100 input + 50 output -> 150 total
    expect(points[0].total).toBe(150);
    expect(points[0].inputH + points[0].outputH).toBeCloseTo(150 * (layoutScale(points[0])), 5);
  });

  it("respects custom layout dimensions", () => {
    const { layout } = layoutChart(sample, { ...DEFAULT_CHART_LAYOUT, width: 100, height: 100 });
    expect(layout.width).toBe(100);
    expect(layout.height).toBe(100);
  });
});

function layoutScale(p: { inputH: number; outputH: number; total: number }): number {
  // inverse of inputH / input_tokens for the first point
  return p.inputH / 100;
}

describe("formatTokens", () => {
  it("sub-1k: round to integer", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(123)).toBe("123");
    expect(formatTokens(999)).toBe("999");
  });

  it("1k-10k: 2 decimals", () => {
    expect(formatTokens(1000)).toBe("1.00k");
    expect(formatTokens(1234)).toBe("1.23k");
    expect(formatTokens(9999)).toBe("10.00k"); // 9999/1000 = 9.999
  });

  it("10k-1M: 1 decimal", () => {
    expect(formatTokens(10000)).toBe("10.0k");
    expect(formatTokens(123456)).toBe("123.5k");
  });

  it("1M+: M suffix", () => {
    expect(formatTokens(1_500_000)).toBe("1.50M");
    expect(formatTokens(12_345_678)).toBe("12.3M");
  });
});

describe("formatCost", () => {
  it("zero: ¥0", () => {
    expect(formatCost(0)).toBe("¥0");
  });

  it("sub-cent: 4 decimals", () => {
    expect(formatCost(0.00012)).toBe("¥0.0001");
  });

  it("sub-dollar: 3 decimals", () => {
    expect(formatCost(0.5)).toBe("¥0.500");
  });

  it("sub-100: 2 decimals", () => {
    expect(formatCost(1.5)).toBe("¥1.50");
    expect(formatCost(99.99)).toBe("¥99.99");
  });

  it("100+: rounded to integer with thousands sep", () => {
    expect(formatCost(1500)).toBe("¥1,500");
  });
});
