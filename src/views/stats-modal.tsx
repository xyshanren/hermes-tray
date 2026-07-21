// v0.2-alpha-10 — StatsModal (Preact JSX).
//
// Renders token/cost statistics into the existing `<div id="stats-modal">`
// overlay root from index.html. Loads via invoke('token_stats') on every
// open + on every period tab change. The store in ./stats-modal-store
// drives visibility; main.ts owns openStatsModal/closeStatsModal wrappers
// + sidebar button click handler.
//
// Heavy port from main.ts:898-1098. The chart SVG is generated inline
// rather than via innerHTML so the bar <rect>s use Preact's tree-shaken
// render path instead of the v0.1.5 innerHTML-on-resync pattern.

import { useEffect, useMemo, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import {
  formatTokens,
  formatCost,
  layoutChart,
  DEFAULT_CHART_LAYOUT,
  type DailyBucketLike,
} from "../tokenChart";
import type { DailyBucket, TokenStats } from "../types";
import { showToast } from "../lib/toast";
import { escapeHtml } from "../lib/sanitize";
import { statsStore } from "./stats-modal-store";
import { formatRoutingTrace, formatLatencyMs } from "../main";

// ── Period type + labels ──────────────────────────────────────────────────

type StatsPeriod = "day" | "week" | "month" | "all";

const PERIODS: ReadonlyArray<{ value: StatsPeriod; label: string }> = [
  { value: "day", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "all", label: "全部" },
];

// ── Main modal ────────────────────────────────────────────────────────────

export function StatsModal() {
  const [open, setOpen] = useState(statsStore.getOpen());
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(false);

  // Subscribe to open/close. fire-on-subscribe means a fresh mount
  // gets the current state synchronously, even before the effect's
  // microtask flush completes.
  useEffect(() => statsStore.subscribe(setOpen), []);

  // Load on first open + on every period change.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invoke<TokenStats>("token_stats", { period })
      .then((s) => {
        setStats(s);
      })
      .catch((e) => {
        showToast("加载统计失败", String(e), "error");
        setStats(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, period]);

  if (!open) return null;

  return (
    <div class="modal modal-stats" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>📊 Token 用量与成本</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭统计"
          onClick={() => statsStore.setOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <div class="stats-period-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              class={`stats-period-btn${p.value === period ? " active" : ""}`}
              data-period={p.value}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {loading && stats === null ? (
          <div class="stats-empty">加载中…</div>
        ) : !stats ? (
          <div class="stats-empty">暂无数据</div>
        ) : (
          <StatsBody stats={stats} />
        )}
      </div>
    </div>
  );
}

// ── Body (once stats are loaded) ──────────────────────────────────────────

function StatsBody({ stats: s }: { stats: TokenStats }) {
  // S14-agent: derive a one-line "最近 vision" trace + latency badge.
  const routingTrace = formatRoutingTrace(s.recent_routing_decision ?? null);
  const latencyBadge = formatLatencyMs(s.recent_elapsed_ms);

  const costTotalUsd = s.period_cost_total_usd ?? 0;
  const hasRealCost = costTotalUsd > 0;
  const costValue = hasRealCost ? costTotalUsd : s.total_cost;
  const costLabel = hasRealCost ? "本月 Cost" : "预估成本";
  const unknownBuckets = s.unknown_model_buckets ?? 0;
  const baseSub = hasRealCost
    ? `${s.by_model.length} 个模型`
    : `基于 ${s.by_model.length} 个模型`;
  const costSub = unknownBuckets > 0
    ? `${baseSub} · ${unknownBuckets} 个未识别`
    : baseSub;

  const fallbackPct = Math.round((s.fallback_hit_rate ?? 0) * 100);
  const avgLatencyMs = s.avg_latency_ms ?? 0;
  const avgLatencySec = avgLatencyMs > 0
    ? (avgLatencyMs / 1000).toFixed(1)
    : "0.0";
  const thresholdCount = s.cost_threshold_count ?? 0;

  return (
    <>
      {/* 6 cards in 3×2 grid (design spec) */}
      <div class="stats-grid">
        <div class="stats-card">
          <div class="stats-card-label">总 Token</div>
          <div class="stats-card-value">
            {formatTokens(s.total_input_tokens + s.total_output_tokens)}
          </div>
          <div class="stats-card-sub">
            ↑ {formatTokens(s.total_input_tokens)} / ↓ {formatTokens(s.total_output_tokens)}
          </div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">{costLabel}</div>
          <div class="stats-card-value">{formatCost(costValue)}</div>
          <div class="stats-card-sub">{costSub}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">消息 / 会话</div>
          <div class="stats-card-value">{s.total_messages}</div>
          <div class="stats-card-sub">{s.total_sessions} 个会话</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">图片 Token</div>
          <div class="stats-card-value">{formatTokens(s.total_image_tokens ?? 0)}</div>
          <div class="stats-card-sub">{routingTrace || "vision 附件输入"}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">Fallback 命中率</div>
          <div class="stats-card-value">{fallbackPct}%</div>
          <div class="stats-card-sub">平均延迟 {avgLatencySec}s</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">Cost Threshold</div>
          <div class="stats-card-value">{thresholdCount}</div>
          <div class="stats-card-sub">
            {thresholdCount > 0 ? "预算超支次数" : "本周期无超支"}
          </div>
        </div>
      </div>
      <div class="stats-chart-section">
        <h3>每日 Token 用量</h3>
        <ChartSvg daily={s.daily} />
      </div>
      <SortableModelTable byModel={s.by_model} />
      <div class="stats-models-section">
        <h3>By Rule</h3>
        <table class="stats-models-table">
          <thead>
            <tr>
              <th>规则</th>
              <th>命中数</th>
              <th>成本 (¥)</th>
            </tr>
          </thead>
          <tbody>
            {(s.by_rule ?? []).length === 0 ? (
              <tr>
                <td colspan={3} class="stats-empty">暂无 routing_decision 数据</td>
              </tr>
            ) : (
              (s.by_rule ?? []).map((r) => (
                <tr key={r.rule_id}>
                  <td>{escapeHtml(r.rule_id)}</td>
                  <td>{r.hit_count}</td>
                  <td>{formatCost(r.cost_total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Sortable model table ─────────────────────────────────────────────────

type SortKey = "model" | "message_count" | "input_tokens" | "output_tokens" | "cost";
type SortDir = "asc" | "desc";

interface ModelBucket {
  model: string;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

function SortableModelTable({ byModel }: { byModel: ModelBucket[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const arr = [...byModel];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "model") cmp = a.model.localeCompare(b.model);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [byModel, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "model" ? "asc" : "desc");
    }
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div class="stats-models-section">
      <h3>按模型分列</h3>
      <table class="stats-models-table">
        <thead>
          <tr>
            <th class="sortable" onClick={() => toggleSort("model")}>模型{arrow("model")}</th>
            <th class="sortable" onClick={() => toggleSort("message_count")}>消息{arrow("message_count")}</th>
            <th class="sortable" onClick={() => toggleSort("input_tokens")}>Input{arrow("input_tokens")}</th>
            <th class="sortable" onClick={() => toggleSort("output_tokens")}>Output{arrow("output_tokens")}</th>
            <th class="sortable" onClick={() => toggleSort("cost")}>成本 (¥){arrow("cost")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colspan={5} class="stats-empty">暂无数据</td>
            </tr>
          ) : (
            sorted.map((m) => {
              const isUnknown = !m.model.trim() || m.model === "unknown";
              return (
                <tr key={m.model}>
                  <td>{escapeHtml(m.model)}</td>
                  <td>{m.message_count}</td>
                  <td>{formatTokens(m.input_tokens)}</td>
                  <td>{formatTokens(m.output_tokens)}</td>
                  <td>{isUnknown ? "—" : formatCost(m.cost)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Chart SVG ─────────────────────────────────────────────────────────────
//
// Ported from main.ts renderChartSvg(). We generate SVG as a string and
// dangerouslySetInnerHTML it because the `<rect>` elements are data-
// driven (one per day in `daily`) and Preact's JSX rendering of a
// variable-length array of `<rect>`s adds more overhead than
// innerHTML for this case. The string is built from typed `daily`
// data only — no user input flows in here.

function ChartSvg({ daily }: { daily: DailyBucket[] }) {
  if (daily.length === 0) {
    return <div class="stats-empty">本周期内无消息</div>;
  }
  const { layout, points } = layoutChart(
    daily as DailyBucketLike[],
    DEFAULT_CHART_LAYOUT,
  );

  // Y-axis tick lines: 0, 1/4, 1/2, 3/4, max.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yVal = layout.yMax * f;
    const yPx =
      layout.padding.top +
      (layout.height - layout.padding.top - layout.padding.bottom) *
        (1 - f);
    return (
      <g>
        <line
          x1={layout.padding.left}
          y1={yPx.toFixed(1)}
          x2={layout.width - layout.padding.right}
          y2={yPx.toFixed(1)}
          stroke="var(--border)"
          stroke-dasharray="2 3"
        />
        <text
          x={layout.padding.left - 6}
          y={(yPx + 3).toFixed(1)}
          text-anchor="end"
          font-size="10"
          fill="var(--text-muted)"
        >
          {formatTokens(yVal)}
        </text>
      </g>
    );
  });

  // Bars: input (bottom) + output (stacked on top).
  const bars = points.map((p, idx) => {
    const inY = layout.height - layout.padding.bottom - p.inputH;
    const outY = inY - p.outputH;
    const innerW = layout.width - layout.padding.left - layout.padding.right;
    const barW = Math.max(2, Math.min(40, (innerW / points.length) * 0.7));
    const x = p.x;
    const src = daily[idx];
    // Shared tooltip text — attached to BOTH the input and output
    // rects so hovering either half shows the day's totals. Without
    // the second <title> (alpha-22 manual Tauri verification), users
    // hovering the lighter "output" half saw no tooltip because the
    // input rect's <title> only fired on its own hover region.
    const tooltipText = `${p.date}: ${formatTokens(p.total)} (input ${formatTokens(src.input_tokens)} / output ${formatTokens(src.output_tokens)})`;
    return (
      <g>
        <rect
          x={x.toFixed(1)}
          y={inY.toFixed(1)}
          width={barW.toFixed(1)}
          height={p.inputH.toFixed(1)}
          fill="var(--primary)"
          opacity="0.85"
        >
          <title>{tooltipText}</title>
        </rect>
        <rect
          x={x.toFixed(1)}
          y={outY.toFixed(1)}
          width={barW.toFixed(1)}
          height={p.outputH.toFixed(1)}
          fill="var(--primary)"
          opacity="0.45"
        >
          <title>{tooltipText}</title>
        </rect>
        <text
          x={(x + barW / 2).toFixed(1)}
          y={(layout.height - layout.padding.bottom + 12).toFixed(1)}
          text-anchor="middle"
          font-size="9"
          fill="var(--text-muted)"
        >
          {p.date.slice(5)}
        </text>
      </g>
    );
  });

  // Legend.
  const legend = (
    <g transform={`translate(${layout.padding.left}, 4)`}>
      <rect width="10" height="10" fill="var(--primary)" opacity="0.85" />
      <text x="14" y="9" font-size="11" fill="var(--text-secondary)">
        Input
      </text>
      <rect x="60" width="10" height="10" fill="var(--primary)" opacity="0.45" />
      <text x="74" y="9" font-size="11" fill="var(--text-secondary)">
        Output
      </text>
    </g>
  );

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      class="stats-chart"
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks}
      {bars}
      {legend}
    </svg>
  );
}