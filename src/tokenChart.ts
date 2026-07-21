/**
 * Chart data prep (T-Q-S9).
 *
 * Pure functions that turn `TokenStats.daily` (from the Rust side) into
 * SVG-ready coordinates. Splitting this out lets us unit-test the math
 * without rendering a DOM.
 */

export interface DailyBucketLike {
  date: string; // YYYY-MM-DD
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface ChartSeriesPoint {
  date: string;
  /** Index on the X axis (0..n-1). */
  x: number;
  /** Stack height in user units (e.g. pixels). */
  inputH: number;
  outputH: number;
  /** Token totals, useful for tooltips. */
  total: number;
}

export interface ChartLayout {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  /** Pixels per token at the y-axis's max value. */
  scale: number;
  /** Y-axis max in tokens. Always >= 1 to avoid div-by-zero on empty data. */
  yMax: number;
}

export const DEFAULT_CHART_LAYOUT: ChartLayout = {
  width: 520,
  height: 200,
  padding: { top: 16, right: 16, bottom: 32, left: 48 },
  scale: 1,
  yMax: 1,
};

/**
 * Lay out a list of daily buckets into chart coordinates.
 * - `layout` controls canvas size + axis padding (caller picks).
 * - Returns the layout with `yMax` + `scale` filled in, plus per-point
 *   `x` / `inputH` / `outputH` (pixel heights for the stacked bars).
 *
 * Empty / all-zero input produces sensible defaults (yMax = 1) so the
 * SVG renderer doesn't divide by zero.
 */
export function layoutChart(
  daily: DailyBucketLike[],
  partial: Omit<ChartLayout, "scale" | "yMax"> = DEFAULT_CHART_LAYOUT,
): { layout: ChartLayout; points: ChartSeriesPoint[] } {
  const innerW = partial.width - partial.padding.left - partial.padding.right;
  const innerH = partial.height - partial.padding.top - partial.padding.bottom;
  const totals = daily.map((d) => d.input_tokens + d.output_tokens);
  const observedMax = totals.length > 0 ? Math.max(...totals) : 0;
  // Round yMax up to a "nice" number so the gridlines look clean.
  const yMax = niceCeil(Math.max(observedMax, 1));
  const scale = innerH / yMax;
  const barSlot = daily.length > 0 ? innerW / daily.length : innerW;
  const barW = Math.max(2, Math.min(40, barSlot * 0.7));
  const points: ChartSeriesPoint[] = daily.map((d, i) => {
    const total = d.input_tokens + d.output_tokens;
    return {
      date: d.date,
      x: partial.padding.left + barSlot * i + barSlot / 2 - barW / 2,
      inputH: d.input_tokens * scale,
      outputH: d.output_tokens * scale,
      total,
    };
  });
  return {
    layout: { ...partial, scale, yMax },
    points,
  };
}

/**
 * Pick a "nice" upper bound >= observed. Used for the y-axis so the
 * topmost bar isn't flush with the chart edge.
 *
 * 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, ...
 */
function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const mantissa = n / base;
  let niceMantissa: number;
  if (mantissa <= 1) niceMantissa = 1;
  else if (mantissa <= 2) niceMantissa = 2;
  else if (mantissa <= 5) niceMantissa = 5;
  else niceMantissa = 10;
  return niceMantissa * base;
}

/**
 * Format a number of tokens for display. 12345 -> "12.3k", 1_500_000 -> "1.5M".
 * Used by tooltips + chart axis labels.
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

/**
 * Format cost in ¥ (CNY) with tiered precision + thousands separator.
 * design spec: ¥ 分级精度 — <0.01 → 4位, <1 → 3位, <100 → 2位, ≥100 → 千分位整数
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "¥0";
  if (usd < 0.01) return `¥${usd.toFixed(4)}`;
  if (usd < 1) return `¥${usd.toFixed(3)}`;
  if (usd < 100) return `¥${usd.toFixed(2)}`;
  return `¥${Math.round(usd).toLocaleString("zh-CN")}`;
}
