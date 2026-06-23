//! Session DAO — implementation provided by builder in T-Q-S1.2.
//!
//! Skeleton file: defines the [`SessionDao`] type and wires up the
//! [`SessionDAO`](crate::db::dao::SessionDAO) trait. Builder fills in
//! the SQL bodies and writes the unit tests.

use rusqlite::params;
use uuid::Uuid;

use crate::db::dao::{SearchHit, Session, SessionDAO, SessionPatch};
use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

/// Session DAO — borrows the pool for the lifetime of the call.
pub struct SessionDao<'a> {
    pool: &'a DbPool,
}

impl<'a> SessionDao<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    /// Generate a new uuid v4 string for session.id.
    fn new_id() -> String {
        Uuid::new_v4().to_string()
    }
}

impl<'a> SessionDAO for SessionDao<'a> {
    fn list(&self, limit: i64, offset: i64) -> DbResult<Vec<Session>> {
        // TODO(T-Q-S1.2 builder): SELECT id, title, persona_id, project_dir,
        //   created_at, updated_at, last_msg_at, msg_count, total_tokens,
        //   model, metadata FROM sessions
        //   ORDER BY COALESCE(last_msg_at, created_at) DESC
        //   LIMIT ?1 OFFSET ?2;
        let _ = (limit, offset);
        Err(DbError::NotFound(
            "SessionDAO::list not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn get(&self, id: &str) -> DbResult<Session> {
        let _ = (params![id], id);
        Err(DbError::NotFound(format!(
            "SessionDAO::get not yet implemented (T-Q-S1.2): {id}"
        )))
    }

    fn create(&self, title: &str, persona_id: Option<&str>) -> DbResult<Session> {
        // TODO(T-Q-S1.2 builder): INSERT INTO sessions (id, title, persona_id,
        //   created_at, updated_at) VALUES (?, ?, ?, ?, ?); then SELECT row back.
        let _ = (title, persona_id);
        let _ = Self::new_id();
        Err(DbError::NotFound(
            "SessionDAO::create not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn update(&self, id: &str, patch: SessionPatch) -> DbResult<Session> {
        // TODO(T-Q-S1.2 builder): build dynamic UPDATE based on which
        //   SessionPatch fields are Some(...). Distinguish "set" (Some(Some(x)))
        //   from "clear" (Some(None)) from "no change" (None).
        let _ = (id, patch);
        Err(DbError::NotFound(
            "SessionDAO::update not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        // TODO(T-Q-S1.2 builder): DELETE FROM sessions WHERE id = ?;
        //   ON DELETE CASCADE handles messages + session_tags.
        let _ = id;
        Err(DbError::NotFound(
            "SessionDAO::delete not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn search(&self, query: &str, limit: i64) -> DbResult<Vec<SearchHit>> {
        // TODO(T-Q-S1.2 builder): JOIN messages_fts ↔ messages ↔ sessions,
        //   ORDER BY rank, LIMIT ?.
        let _ = (query, limit);
        Err(DbError::NotFound(
            "SessionDAO::search not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn touch(&self, id: &str) -> DbResult<()> {
        // TODO(T-Q-S1.2 builder): UPDATE sessions SET last_msg_at = ?, updated_at = ? WHERE id = ?;
        let _ = id;
        Err(DbError::NotFound(
            "SessionDAO::touch not yet implemented (T-Q-S1.2)".into(),
        ))
    }
}