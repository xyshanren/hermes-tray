//! Tauri commands exposing DB layer (T-Q-S2).
//!
//! Each command takes `State<Db>` as the first arg, which is managed by
//! `tauri::Builder::manage()` in `lib.rs::run()`.

use tauri::State;

use crate::db::dao::{Message, MessageDAO, SearchHit, Session, SessionDAO, SessionPatch};
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
) -> Result<Session, String> {
    db.session()
        .create(title, persona_id)
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
