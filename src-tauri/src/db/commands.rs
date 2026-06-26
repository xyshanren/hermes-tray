//! Tauri commands exposing DB layer (T-Q-S2).
//!
//! Each command takes `State<Db>` as the first arg, which is managed by
//! `tauri::Builder::manage()` in `lib.rs::run()`.

use tauri::State;

use crate::db::dao::{ConfigDAO, ConfigEntry, Message, MessageDAO, Persona, PersonaDAO, ProjectContext, SearchHit, Session, SessionDAO, SessionPatch};
use crate::db::project::scan_project;
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
pub fn session_update(
    db: State<'_, Db>,
    id: &str,
    patch: SessionPatch,
) -> Result<Session, String> {
    db.session()
        .update(id, patch)
        .map_err(|e| e.to_string())
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
