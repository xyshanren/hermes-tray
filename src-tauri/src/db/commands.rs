//! Tauri commands exposing DB layer (T-Q-S2).
//!
//! Each command takes `State<Db>` as the first arg, which is managed by
//! `tauri::Builder::manage()` in `lib.rs::run()`.

use tauri::State;

use crate::db::dao::{
    ConfigDAO, ConfigEntry, Message, MessageDAO, Persona, PersonaDAO, ProjectContext, SearchHit,
    Session, SessionDAO, SessionPatch,
};
use crate::db::export::{to_json, to_markdown, ExportPersona, ExportProject, ExportSession};
use crate::db::project::scan_project;
use crate::db::token::{cost_for_model, DailyBucket, ModelBucket, RuleBucket, TokenStats};
use crate::db::Db;

// ── Session commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn session_list(db: State<'_, Db>, limit: i64, offset: i64) -> Result<Vec<Session>, String> {
    db.session().list(limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_get(db: State<'_, Db>, id: &str) -> Result<Session, String> {
    db.session().get(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_create(
    db: State<'_, Db>,
    title: &str,
    persona_id: Option<&str>,
    // T-Q-S8: project context. Both fields are coupled — frontend should
    // call `project_scan` first, then pass the JSON result as
    // `project_context`. Pass `project_dir: null` for project-less sessions.
    project_dir: Option<&str>,
    project_context: Option<&str>,
    // v0.2-alpha-23 (manual Tauri verification) — record the model the
    // user picked so the stats modal's by-model breakdown shows the
    // real name instead of "unknown". Frontend passes
    // `state.currentModel` from main.ts; null when no model has been
    // resolved yet (e.g. first boot before /v1/models returns).
    model: Option<&str>,
) -> Result<Session, String> {
    db.session()
        .create(title, persona_id, project_dir, project_context, model)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_update(db: State<'_, Db>, id: &str, patch: SessionPatch) -> Result<Session, String> {
    db.session().update(id, patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_delete(db: State<'_, Db>, id: &str) -> Result<(), String> {
    db.session().delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_search(
    db: State<'_, Db>,
    query: &str,
    limit: i64,
) -> Result<Vec<SearchHit>, String> {
    db.session().search(query, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_touch(db: State<'_, Db>, id: &str) -> Result<(), String> {
    db.session().touch(id).map_err(|e| e.to_string())
}

// ── Project scan command (T-Q-S8) ─────────────────────────────────────────────
//
// Standalone, no DB access. Frontend invokes this BEFORE `session_create`
// so it can pass the JSON result as `project_context`. The result is
// not persisted by this command — that's `session_create`'s job.

#[tauri::command]
pub fn project_scan(path: String) -> Result<ProjectContext, String> {
    scan_project(std::path::Path::new(&path))
}

// ── Token stats command (T-Q-S9) ──────────────────────────────────────────────
//
// Aggregates per-day + per-model token counts and computes cost
// projections. Period argument controls the date range:
//   - "day"   — last 24h
//   - "week"  — last 7 days
//   - "month" — last 30 days
//   - "all"   — since DB creation
//
// We use local-time YYYY-MM-DD buckets (UTC for simplicity, since the
// hermes-tray runs on a single user machine and the user is unlikely
// to care about TZ-perfect charts). The frontend can re-bucket
// client-side if it wants per-TZ.
//
// User-role messages count as input tokens; assistant-role as output
// tokens. This matches OpenAI/Anthropic's billing convention.

#[tauri::command]
pub fn token_stats(db: State<'_, Db>, period: String) -> Result<TokenStats, String> {
    compute_token_stats(&db, &period)
}

fn compute_token_stats(db: &Db, period: &str) -> Result<TokenStats, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let start_ms = match period {
        "day" => now_ms - 24 * 60 * 60 * 1000,
        "week" => now_ms - 7 * 24 * 60 * 60 * 1000,
        "month" => now_ms - 30 * 24 * 60 * 60 * 1000,
        "all" => 0,
        _ => 0,
    };
    let period_label = match period {
        "day" => "day",
        "week" => "week",
        "month" => "month",
        _ => "all",
    };

    let conn = db.pool().get().map_err(|e| e.to_string())?;

    // Per-day + per-role aggregation. We bucket by UTC date
    // (created_at / 86400000 since epoch).
    let mut daily_map: std::collections::BTreeMap<String, (i64, i64)> =
        std::collections::BTreeMap::new();
    let mut by_model: std::collections::HashMap<String, (i64, i64, i64)> =
        std::collections::HashMap::new();
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut total_msgs: i64 = 0;
    let mut total_sessions: std::collections::HashSet<String> = std::collections::HashSet::new();
    // S14-agent: image_tokens is stored on messages.metadata (JSON blob).
    // We pull it via json_extract and sum across the period. The most
    // recent routing_decision + elapsed_ms come from the latest message
    // that has them set (LIMIT 1 by created_at DESC).
    let mut total_image_tokens: i64 = 0;
    let mut recent_routing: Option<String> = None;
    let mut recent_elapsed: Option<i64> = None;
    // v0.1.5 S12 aggregates — collected from the same scan to keep the
    // whole stats render to one DB round-trip. The boolean flag
    // `fallback_used` and the `elapsed_ms` value are read from the
    // metadata JSON blob; `cost_estimate_usd` and
    // `cost_threshold_exceeded` come from the dedicated S12 columns.
    let mut cost_total: f64 = 0.0;
    let mut fallback_hits: i64 = 0;
    let mut routing_count: i64 = 0;
    let mut latency_sum_ms: f64 = 0.0;
    let mut latency_count: i64 = 0;
    let mut cost_threshold_count: i64 = 0;

    let mut stmt = conn
        .prepare(
            "SELECT m.session_id, m.role, m.tokens, m.created_at, COALESCE(s.model, 'unknown'), \
                    COALESCE(json_extract(m.metadata, '$.image_tokens'), 0), \
                    COALESCE(m.cost_estimate_usd, 0.0), \
                    COALESCE(m.cost_threshold_exceeded, 0), \
                    json_extract(m.metadata, '$.routing_decision.fallback_used'), \
                    json_extract(m.metadata, '$.elapsed_ms') \
             FROM messages m \
             LEFT JOIN sessions s ON s.id = m.session_id \
             WHERE m.created_at >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([start_ms], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (
            session_id,
            role,
            tokens,
            created_at,
            model,
            image_tokens,
            msg_cost,
            msg_threshold,
            msg_fallback,
            msg_elapsed,
        ) = row.map_err(|e| e.to_string())?;
        // UTC date bucket. Unix epoch days = created_at / 86_400_000.
        let day_unix = created_at / 86_400_000;
        let date = unix_days_to_ymd(day_unix);

        let (mut in_t, mut out_t) = daily_map.get(&date).copied().unwrap_or((0, 0));
        if role == "user" {
            in_t += tokens;
        } else if role == "assistant" {
            out_t += tokens;
        }
        daily_map.insert(date, (in_t, out_t));

        if role == "user" {
            total_input += tokens;
        } else if role == "assistant" {
            total_output += tokens;
        }
        total_msgs += 1;
        total_sessions.insert(session_id);

        let entry = by_model.entry(model).or_insert((0, 0, 0));
        if role == "user" {
            entry.0 += tokens;
        } else {
            entry.1 += tokens;
        }
        entry.2 += 1;

        // S14: image_tokens is always a user-attachment cost (the model's
        // input side), so sum unconditionally across roles.
        total_image_tokens = total_image_tokens.saturating_add(image_tokens);

        // v0.1.5 S12 aggregates.
        cost_total += msg_cost;
        if msg_threshold != 0 {
            cost_threshold_count += 1;
        }
        if let Some(fb) = msg_fallback {
            // Only count messages that actually carry a routing_decision
            // blob (fallback_used is null when there's no routing). This
            // makes the hit-rate denominator a true "of the routed
            // messages" number, not "of every message ever".
            routing_count += 1;
            if fb != 0 {
                fallback_hits += 1;
            }
        }
        if let Some(ms) = msg_elapsed {
            latency_sum_ms += ms as f64;
            latency_count += 1;
        }
    }

    // S14: pick the most recent routing_decision + elapsed_ms blob from
    // any message in the period. We do a separate query (not joined into
    // the main loop) because we only need the latest row, and parsing
    // json_extract on every row would be wasted work.
    let mut routing_stmt = conn
        .prepare(
            "SELECT m.metadata, m.created_at \
             FROM messages m \
             WHERE m.created_at >= ?1 \
               AND json_extract(m.metadata, '$.routing_decision') IS NOT NULL \
             ORDER BY m.created_at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    if let Ok(row) = routing_stmt.query_row([start_ms], |row| {
        let metadata: Option<String> = row.get(0)?;
        Ok(metadata.unwrap_or_default())
    }) {
        if !row.is_empty() {
            // Stash the raw JSON string; the frontend parses and renders.
            // We deliberately pass through the entire metadata blob so
            // new fields the agent adds later (e.g. tool_call routing)
            // show up automatically.
            recent_routing = Some(row);
        }
    }
    let mut elapsed_stmt = conn
        .prepare(
            "SELECT json_extract(metadata, '$.elapsed_ms') \
             FROM messages \
             WHERE created_at >= ?1 \
               AND json_extract(metadata, '$.elapsed_ms') IS NOT NULL \
             ORDER BY created_at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    if let Ok(v) = elapsed_stmt.query_row([start_ms], |row| row.get::<_, Option<i64>>(0)) {
        recent_elapsed = v;
    }

    // v0.1.5 S12: per-rule breakdown. group by routing_decision.rule_id
    // and aggregate hit_count + cost_total. The COALESCE catches the
    // pre-S12 messages (no rule_id in metadata) and buckets them under
    // "no_rule" so they don't pollute the stats. NULL rule_id values
    // (e.g. routing_decision blob present but rule_id missing) are
    // bucketed under "unknown".
    let mut rule_stmt = conn
        .prepare(
            "SELECT COALESCE(json_extract(m.metadata, '$.routing_decision.rule_id'), 'no_rule') AS rule_id, \
                    COUNT(*) AS hit_count, \
                    COALESCE(SUM(m.cost_estimate_usd), 0.0) AS cost_total \
             FROM messages m \
             WHERE m.created_at >= ?1 \
               AND json_extract(m.metadata, '$.routing_decision') IS NOT NULL \
             GROUP BY rule_id \
             ORDER BY hit_count DESC, cost_total DESC",
        )
        .map_err(|e| e.to_string())?;
    let by_rule: Vec<RuleBucket> = rule_stmt
        .query_map([start_ms], |row| {
            Ok(RuleBucket {
                rule_id: row.get::<_, String>(0)?,
                hit_count: row.get::<_, i64>(1)?,
                cost_total: row.get::<_, f64>(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    // Convert to sorted Vec<DailyBucket> and add cost.
    let daily: Vec<DailyBucket> = daily_map
        .into_iter()
        .map(|(date, (in_t, out_t))| DailyBucket {
            date,
            input_tokens: in_t,
            output_tokens: out_t,
            cost: cost_for_model("all", in_t, out_t), // aggregated cost uses default
        })
        .collect();

    // Per-model breakdown — costs differ per model, so each bucket
    // uses its own pricing.
    //
    // v0.2-alpha-23 (manual Tauri verification) — model "unknown"
    // (or any empty/whitespace string) means we don't know which
    // pricing table row to apply, so we MUST NOT silently fall back
    // to DEFAULT_PRICING (which would produce a misleading number
    // for messages from pre-S14 sessions whose model column is
    // NULL). For unknown models we show the token counts (still
    // useful for budgeting) and zero the cost — the frontend can
    // decide to render the cell as "—" instead of "$0.00" if it
    // wants a clearer visual.
    let is_pricing_known = |model: &str| -> bool {
        !model.trim().is_empty() && model != "unknown"
    };
    let mut by_model_vec: Vec<ModelBucket> = by_model
        .into_iter()
        .map(|(model, (in_t, out_t, count))| {
            let cost = if is_pricing_known(&model) {
                cost_for_model(&model, in_t, out_t)
            } else {
                0.0
            };
            ModelBucket {
                cost,
                input_tokens: in_t,
                output_tokens: out_t,
                model,
                message_count: count,
            }
        })
        .collect();
    by_model_vec.sort_by(|a, b| {
        b.cost
            .partial_cmp(&a.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let total_cost = by_model_vec.iter().map(|m| m.cost).sum();

    // v0.2-alpha-23 (manual Tauri verification) — count the
    // buckets whose model couldn't be priced (model == "unknown" or
    // empty). The frontend stats modal uses this to render a small
    // caveat under the "预估成本" card. The cost for those buckets is
    // already 0.0 (see the is_pricing_known filter above), so they
    // don't affect total_cost — but their tokens DO count toward the
    // total token tile, which is what the user actually wants for
    // budgeting.
    let unknown_model_buckets = by_model_vec
        .iter()
        .filter(|m| m.model.trim().is_empty() || m.model == "unknown")
        .count() as i64;

    // v0.1.5 S12 aggregates — derived from the per-row scan above.
    // fallback_hit_rate is "of messages that actually carried a
    // routing_decision" (not of all messages) so the percentage
    // reflects routing behavior, not "the user just had a bunch of
    // pre-S12 messages that we never tried to route".
    let fallback_hit_rate = if routing_count > 0 {
        fallback_hits as f64 / routing_count as f64
    } else {
        0.0
    };
    let avg_latency_ms = if latency_count > 0 {
        latency_sum_ms / latency_count as f64
    } else {
        0.0
    };

    Ok(TokenStats {
        period: period_label.to_string(),
        start_unix_ms: start_ms,
        end_unix_ms: now_ms,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cost,
        total_messages: total_msgs,
        total_sessions: total_sessions.len() as i64,
        daily,
        by_model: by_model_vec,
        total_image_tokens,
        recent_routing_decision: recent_routing,
        recent_elapsed_ms: recent_elapsed,
        period_cost_total_usd: cost_total,
        fallback_hit_rate,
        avg_latency_ms,
        cost_threshold_count,
        by_rule,
        unknown_model_buckets,
    })
}

// ── Session export commands (T-Q-S10) ─────────────────────────────────────────
//
// Render a session to a portable markdown / JSON document. Pure: we
// re-read session + messages from the DB and pass them through the
// `export` module's pure functions. The frontend handles the actual
// copy-to-clipboard / download / share-link.

#[tauri::command]
pub fn export_session_markdown(db: State<'_, Db>, session_id: &str) -> Result<String, String> {
    let (session_export, persona, project, messages) = load_export_bundle(&db, session_id)?;
    Ok(to_markdown(
        &session_export,
        persona.as_ref(),
        project.as_ref(),
        &messages,
    ))
}

#[tauri::command]
pub fn export_session_json(
    db: State<'_, Db>,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    let (session_export, persona, project, messages) = load_export_bundle(&db, session_id)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(to_json(
        &session_export,
        persona.as_ref(),
        project.as_ref(),
        &messages,
        now_ms,
    ))
}

/// Everything an export needs in a single query: session metadata,
/// the (optional) persona + project that were active when the
/// session was created, and the full message list. Tuple-shaped
/// (rather than a struct) because the export endpoints consume
/// the fields positionally, but the type alias keeps clippy
/// happy (avoids `very complex type`).
type ExportBundle = (
    ExportSession,
    Option<ExportPersona>,
    Option<ExportProject>,
    Vec<Message>,
);

/// Shared lookup: session + (optional) persona + (optional) project + messages.
/// Used by both `export_session_markdown` and `export_session_json`.
fn load_export_bundle(db: &Db, session_id: &str) -> Result<ExportBundle, String> {
    // Session
    let s = db.session().get(session_id).map_err(|e| e.to_string())?;
    // Messages — no pagination; the export wants the full conversation.
    // Sessions with thousands of messages will produce a large output;
    // we accept that for MVP and document the limit.
    let messages = db
        .message()
        .list_by_session(session_id, 1_000_000, 0)
        .map_err(|e| e.to_string())?;
    // Persona (optional)
    let persona = s
        .persona_id
        .as_deref()
        .and_then(|pid| db.persona().get(pid).ok())
        .map(|p| ExportPersona {
            name: p.name,
            system_prompt: p.system_prompt,
        });
    // Project (optional) — parse the cached JSON for name + version + path.
    let project = s
        .project_context
        .as_deref()
        .and_then(|json| serde_json::from_str::<ProjectContext>(json).ok())
        .map(|p| ExportProject {
            name: p.name,
            version: p.version,
            path: p.project_dir,
        });
    let export_session = ExportSession {
        id: s.id,
        title: s.title,
        created_at: s.created_at,
        updated_at: s.updated_at,
        model: s.model,
    };
    Ok((export_session, persona, project, messages))
}

/// Convert Unix days (days since 1970-01-01) to YYYY-MM-DD. Used for
/// the chart's X-axis labels. Pure function for testability.
fn unix_days_to_ymd(days: i64) -> String {
    // Civil-from-days algorithm (Howard Hinnant, public domain).
    // https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

// ── Message commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn message_append(
    db: State<'_, Db>,
    session_id: &str,
    role: &str,
    content: &str,
    tool_calls: Option<&str>,
) -> Result<Message, String> {
    db.message()
        .append(session_id, role, content, tool_calls)
        .map_err(|e| e.to_string())
}

/// S14-agent integration: replace the char/4 heuristic token estimate with
/// the real upstream usage and stash vision metadata on the message.
/// `routing_decision_json` is a JSON-serialised dict produced by the
/// hermes-agent S14 routing_decision (mode/primary/resolved/fallback_*).
///
/// v0.1.5 S12: also persist the real `cost_estimate_usd` and the
/// `cost_threshold_exceeded` boolean (cost-aware fallback flag) on
/// first-class columns so the stats modal can do period-aggregate
/// SUM/COUNT/AVG without re-parsing the metadata JSON blob.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn message_record_usage(
    db: State<'_, Db>,
    id: &str,
    prompt_tokens: i64,
    completion_tokens: i64,
    image_tokens: i64,
    routing_decision_json: Option<&str>,
    elapsed_ms: Option<i64>,
    cost_estimate_usd: f64,
    cost_threshold_exceeded: bool,
) -> Result<Message, String> {
    db.message()
        .record_usage(
            id,
            prompt_tokens,
            completion_tokens,
            image_tokens,
            routing_decision_json,
            elapsed_ms,
            cost_estimate_usd,
            cost_threshold_exceeded,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn message_list(
    db: State<'_, Db>,
    session_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<Message>, String> {
    db.message()
        .list_by_session(session_id, limit, offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn message_delete(db: State<'_, Db>, id: &str) -> Result<(), String> {
    db.message().delete(id).map_err(|e| e.to_string())
}

// ── Persona commands (T-Q-S7) ────────────────────────────────────────────────────
//
// Personas = assistant role definitions. The same `personas` table also
// serves as the "session template" library: a persona carries the
// system_prompt that gets injected when a new session is created from it.
// No separate templates table is needed — persona = template + role in
// one. Frontend `persona` tab uses these to list/edit/apply.

#[tauri::command]
pub fn persona_list(db: State<'_, Db>) -> Result<Vec<Persona>, String> {
    db.persona().list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn persona_get(db: State<'_, Db>, id: &str) -> Result<Persona, String> {
    db.persona().get(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn persona_create(db: State<'_, Db>, persona: Persona) -> Result<Persona, String> {
    db.persona().create(&persona).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn persona_update(db: State<'_, Db>, persona: Persona) -> Result<Persona, String> {
    db.persona().update(&persona).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn persona_delete(db: State<'_, Db>, id: &str) -> Result<(), String> {
    db.persona().delete(id).map_err(|e| e.to_string())
}

// ── DB-backed config commands (T-Q-S7) ────────────────────────────────────────
//
// These read/write the `config` table (NOT the legacy `config.json` next
// to the executable). Used for per-user prefs that need to survive across
// sessions: `default_persona_id` (auto-apply to new sessions) and
// `last_active_session_id` (restore on app launch).

#[tauri::command]
pub fn db_config_get(db: State<'_, Db>, key: &str) -> Result<Option<ConfigEntry>, String> {
    db.config().get(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_config_set(db: State<'_, Db>, key: &str, value: &str) -> Result<ConfigEntry, String> {
    db.config().set(key, value).map_err(|e| e.to_string())
}

// ── alpha-14: bulk-clear commands used by the settings danger zone ──────

/// Wipe every row in the `sessions` table. ON DELETE CASCADE handles
/// `messages` and `session_tags`; the `messages_ad` trigger re-syncs
/// the FTS5 index. Returns the number of sessions removed so the UI
/// can show "已删除 N 个会话".
///
/// Frontend wires this to the settings "清除所有会话" button (with a
/// 2-step confirmation flow per AGENTS.md §4 dangerous-action rules).
#[tauri::command]
pub fn session_clear_all(db: State<'_, Db>) -> Result<usize, String> {
    db.session().clear_all().map_err(|e| e.to_string())
}

/// Wipe every row in the `config` table. The frontend's CONFIG_SCHEMA
/// (src/lib/config-schema.ts) owns per-key defaults, so any subsequent
/// `db_config_get(key)` returns None and the UI falls back to defaults
/// on reload. Returns the number of rows removed. The legacy
/// config.json file is wiped separately via `hermes_reset_config` —
/// the frontend's "重置所有设置" flow calls BOTH commands.
#[tauri::command]
pub fn db_config_reset_all(db: State<'_, Db>) -> Result<usize, String> {
    db.config().reset_all().map_err(|e| e.to_string())
}
