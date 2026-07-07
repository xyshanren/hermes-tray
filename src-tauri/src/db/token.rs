//! Token estimation + cost tracking (T-Q-S9).
//!
//! We don't have a per-model tokenizer in the binary, so the
//! `estimate_tokens` function uses a deliberately rough heuristic:
//! `len_chars / 4`. This is the most-cited approximation for
//! OpenAI-compatible tokenizers (BPE for English averages ~4 chars/token,
//! Chinese ~1.5-2 chars/token, code ~3-4 chars/token). It's off by
//! ~20-30% in worst case but stable enough for cost projections.
//!
//! Cost calc uses a hand-curated price table. Models not in the table
//! fall back to a single default rate ($0.001/1k tokens, conservative
//! for the high end).
//!
//! Real per-message usage from the gateway is NOT captured in this
//! version — that's a future T-Q-S9.x enhancement. For now, the chart
//! is a best-effort projection, not a bill.

use std::collections::HashMap;

/// Rough token estimate. `len_chars / 4` is the most-cited heuristic
/// for OpenAI-compatible BPE tokenizers.
pub fn estimate_tokens(text: &str) -> i64 {
    if text.is_empty() {
        return 0;
    }
    // `char_indices().count()` counts Unicode scalar values, not bytes.
    // For token estimation we want approximate grapheme density, which
    // is closer to char count than byte count for the common case
    // (ASCII / CJK). Bytes are used only for the divide — dividing a
    // tiny int by 4 to get 0 would over-discount, so we use chars.
    let chars = text.chars().count() as i64;
    (chars / 4).max(1) // min 1 for non-empty
}

/// Per-1K-token pricing in USD. Both fields inclusive of any discount;
/// output tokens are typically 2-4x more expensive than input.
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    pub input_per_1k: f64,
    pub output_per_1k: f64,
}

impl ModelPricing {
    /// Cost in USD for `input_tokens` input + `output_tokens` output.
    pub fn cost(&self, input_tokens: i64, output_tokens: i64) -> f64 {
        let i = input_tokens as f64 / 1000.0 * self.input_per_1k;
        let o = output_tokens as f64 / 1000.0 * self.output_per_1k;
        i + o
    }
}

/// Hand-curated pricing table for the most common models. Numbers are
/// in USD per 1K tokens (as of 2026-06). Update as needed; not auto-
/// synced from provider APIs.
///
/// `lookup_pricing` falls back to `DEFAULT_PRICING` for unknown models
/// so the chart still renders something useful.
fn pricing_table() -> HashMap<&'static str, ModelPricing> {
    let mut m = HashMap::new();
    // Hermes-agent (local — free)
    m.insert(
        "hermes-agent",
        ModelPricing {
            input_per_1k: 0.0,
            output_per_1k: 0.0,
        },
    );
    // DeepSeek (cheap)
    m.insert(
        "deepseek-chat",
        ModelPricing {
            input_per_1k: 0.00027,
            output_per_1k: 0.0011,
        },
    );
    m.insert(
        "deepseek-coder",
        ModelPricing {
            input_per_1k: 0.00027,
            output_per_1k: 0.0011,
        },
    );
    // OpenAI
    m.insert(
        "gpt-4o",
        ModelPricing {
            input_per_1k: 0.0025,
            output_per_1k: 0.01,
        },
    );
    m.insert(
        "gpt-4o-mini",
        ModelPricing {
            input_per_1k: 0.00015,
            output_per_1k: 0.0006,
        },
    );
    m.insert(
        "gpt-4-turbo",
        ModelPricing {
            input_per_1k: 0.01,
            output_per_1k: 0.03,
        },
    );
    m.insert(
        "gpt-3.5-turbo",
        ModelPricing {
            input_per_1k: 0.0005,
            output_per_1k: 0.0015,
        },
    );
    // Anthropic
    m.insert(
        "claude-3-5-sonnet",
        ModelPricing {
            input_per_1k: 0.003,
            output_per_1k: 0.015,
        },
    );
    m.insert(
        "claude-3-haiku",
        ModelPricing {
            input_per_1k: 0.00025,
            output_per_1k: 0.00125,
        },
    );
    // Google
    m.insert(
        "gemini-1.5-pro",
        ModelPricing {
            input_per_1k: 0.00125,
            output_per_1k: 0.005,
        },
    );
    m.insert(
        "gemini-1.5-flash",
        ModelPricing {
            input_per_1k: 0.000075,
            output_per_1k: 0.0003,
        },
    );
    m
}

const DEFAULT_PRICING: ModelPricing = ModelPricing {
    input_per_1k: 0.001,
    output_per_1k: 0.003,
};

/// Look up pricing for a model id. Falls back to `DEFAULT_PRICING` on miss.
pub fn lookup_pricing(model: &str) -> ModelPricing {
    pricing_table()
        .get(model)
        .copied()
        .unwrap_or(DEFAULT_PRICING)
}

/// Convenience: cost for given (model, input_tokens, output_tokens).
pub fn cost_for_model(model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    lookup_pricing(model).cost(input_tokens, output_tokens)
}

// ── Aggregation result types ─────────────────────────────────────────────────

/// Daily token/cost bucket — drives the stats chart.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct DailyBucket {
    /// YYYY-MM-DD in local time (or UTC if simpler).
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost: f64,
}

/// Per-model breakdown.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct ModelBucket {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost: f64,
    pub message_count: i64,
}

/// v0.1.5 S12: per-rule breakdown. `rule_id` is the routing_decision.rule_id
/// the agent S12 emitted; hits are how many messages in the period were
/// routed by that rule; cost_total is the sum of those messages'
/// `cost_estimate_usd` (USD). Sorted by hit_count DESC so the busiest
/// rules surface first.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct RuleBucket {
    pub rule_id: String,
    pub hit_count: i64,
    pub cost_total: f64,
}

/// Aggregate stats for a given period. Returned by the `token_stats`
/// Tauri command and consumed by the frontend stats modal.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct TokenStats {
    pub period: String, // "day" | "week" | "month" | "all"
    pub start_unix_ms: i64,
    pub end_unix_ms: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost: f64,
    pub total_messages: i64,
    pub total_sessions: i64,
    pub daily: Vec<DailyBucket>,
    pub by_model: Vec<ModelBucket>,
    /// S14-agent: total image-part token cost across the period. Read from
    /// `messages.metadata.image_tokens` via `json_extract`. Powers the
    /// "图片 token" sub-stat in the stats modal so the user can see how
    /// much of their spend went to vision.
    #[serde(default)]
    pub total_image_tokens: i64,
    /// S14-agent: routing decision from the most recent message that
    /// carries a `routing_decision` blob. Surfaces "vision fallback to X"
    /// style traces in the stats modal.
    #[serde(default)]
    pub recent_routing_decision: Option<String>,
    /// S14-agent: wall-clock latency (ms) from the most recent
    /// `elapsed_ms` blob.
    #[serde(default)]
    pub recent_elapsed_ms: Option<i64>,
    // ── v0.1.5 S12 cost-aware routing aggregates ───────────────────────────
    /// S12: real USD cost total across the period. Sum of
    /// `messages.cost_estimate_usd` for messages with a real cost
    /// (replaces the pre-S12 char/4 cost projection in `total_cost`).
    /// This is the **authoritative** cost; `total_cost` is the projected
    /// fallback for messages that don't have a real cost yet (pre-S12
    /// DBs).
    #[serde(default)]
    pub period_cost_total_usd: f64,
    /// S12: fallback hit rate in [0.0, 1.0]. Computed as
    /// `count(routing_decision.fallback_used = true) /
    /// count(routing_decision IS NOT NULL)`. 0.0 when no messages in
    /// the period carry a routing decision.
    #[serde(default)]
    pub fallback_hit_rate: f64,
    /// S12: average wall-clock latency (ms) across the period, computed
    /// from `messages.metadata.elapsed_ms` via `json_extract`. 0.0 when
    /// no messages in the period carry `elapsed_ms`.
    #[serde(default)]
    pub avg_latency_ms: f64,
    /// S12: count of messages where the S12 cost-aware fallback flagged
    /// a budget threshold breach (`cost_threshold_exceeded = 1`). Powers
    /// the "Cost Threshold 触发" tile — surfaces silent budget overruns.
    #[serde(default)]
    pub cost_threshold_count: i64,
    /// S12: per-rule breakdown. `rule_id` from
    /// `messages.metadata.routing_decision.rule_id`. Sorted by
    /// `hit_count DESC` so the busiest rules surface first.
    #[serde(default)]
    pub by_rule: Vec<RuleBucket>,
    // ── v0.2-alpha-23 (manual Tauri verification) additions ────────────────
    /// Count of `by_model` buckets whose model name is "unknown" or
    /// empty — i.e. messages whose pricing can't be looked up. The
    /// frontend stats modal shows a small caveat under the "预估成本"
    /// card so users know the total is conservative (those messages
    /// are token-counted but cost-zeroed, not silently priced at
    /// DEFAULT_PRICING).
    #[serde(default)]
    pub unknown_model_buckets: i64,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_empty_returns_zero() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn estimate_short_text_returns_at_least_one() {
        // "hi" is 2 chars; divide by 4 = 0, but we floor to 1.
        assert_eq!(estimate_tokens("hi"), 1);
    }

    #[test]
    fn estimate_long_english_text() {
        // "The quick brown fox" = 19 chars -> 19/4 = 4
        assert_eq!(estimate_tokens("The quick brown fox"), 4);
    }

    #[test]
    fn estimate_cjk_text_is_denser() {
        // 8 CJK chars -> 8/4 = 2
        // (Real BPE would give ~6-8 — known underestimate, expected)
        assert_eq!(estimate_tokens("你好世界中文测试"), 2);
    }

    #[test]
    fn estimate_code_text() {
        // 24 chars of code -> 6 tokens
        let s = "fn main() { println!() }";
        assert_eq!(estimate_tokens(s), s.chars().count() as i64 / 4);
    }

    #[test]
    fn estimate_unicode_emoji() {
        // Emoji can be multi-codepoint; we just count chars.
        let s = "🎉🎉🎉🎉";
        let expected = (s.chars().count() as i64 / 4).max(1);
        assert_eq!(estimate_tokens(s), expected);
    }

    #[test]
    fn model_pricing_cost_is_linear() {
        let p = ModelPricing {
            input_per_1k: 0.001,
            output_per_1k: 0.003,
        };
        // 1k input + 1k output = 0.001 + 0.003 = 0.004
        assert!((p.cost(1000, 1000) - 0.004).abs() < 1e-9);
        // 0 input + 5k output = 0 + 0.015
        assert!((p.cost(0, 5000) - 0.015).abs() < 1e-9);
    }

    #[test]
    fn lookup_known_models_returns_table_pricing() {
        // gpt-4o-mini: 0.00015 / 0.0006 per 1k
        let p = lookup_pricing("gpt-4o-mini");
        assert!((p.input_per_1k - 0.00015).abs() < 1e-9);
        assert!((p.output_per_1k - 0.0006).abs() < 1e-9);
    }

    #[test]
    fn lookup_unknown_model_returns_default() {
        let p = lookup_pricing("nonexistent-model-xyz");
        assert!((p.input_per_1k - DEFAULT_PRICING.input_per_1k).abs() < 1e-9);
        assert!((p.output_per_1k - DEFAULT_PRICING.output_per_1k).abs() < 1e-9);
    }

    #[test]
    fn hermes_agent_local_is_free() {
        let p = lookup_pricing("hermes-agent");
        assert_eq!(p.input_per_1k, 0.0);
        assert_eq!(p.output_per_1k, 0.0);
        assert_eq!(cost_for_model("hermes-agent", 1_000_000, 1_000_000), 0.0);
    }

    #[test]
    fn cost_for_model_composes_correctly() {
        // 10k input + 5k output on gpt-4o-mini
        // = 10 * 0.00015 + 5 * 0.0006
        // = 0.0015 + 0.003
        // = 0.0045
        let c = cost_for_model("gpt-4o-mini", 10_000, 5_000);
        assert!((c - 0.0045).abs() < 1e-9);
    }
}
