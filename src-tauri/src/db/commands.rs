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
use crate::db::token::{cost_for_model, DailyBucket, ModelBucket, TokenStats};
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
) -> Result<Session, String> {
    db.session()
        .create(title, persona_id, project_dir, project_context)
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

    let mut stmt = conn
        .prepare(
            "SELECT m.session_id, m.role, m.tokens, m.created_at, COALESCE(s.model, 'unknown') \
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
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (session_id, role, tokens, created_at, model) = row.map_err(|e| e.to_string())?;
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
    }

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
    let mut by_model_vec: Vec<ModelBucket> = by_model
        .into_iter()
        .map(|(model, (in_t, out_t, count))| ModelBucket {
            cost: cost_for_model(&model, in_t, out_t),
            input_tokens: in_t,
            output_tokens: out_t,
            model,
            message_count: count,
        })
        .collect();
    by_model_vec.sort_by(|a, b| {
        b.cost
            .partial_cmp(&a.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let total_cost = by_model_vec.iter().map(|m| m.cost).sum();

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
#[tauri::command]
pub fn message_record_usage(
    db: State<'_, Db>,
    id: &str,
    prompt_tokens: i64,
    completion_tokens: i64,
    image_tokens: i64,
    routing_decision_json: Option<&str>,
    elapsed_ms: Option<i64>,
) -> Result<Message, String> {
    db.message()
        .record_usage(
            id,
            prompt_tokens,
            completion_tokens,
            image_tokens,
            routing_decision_json,
            elapsed_ms,
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
