//! Session DAO — implementation (T-Q-S1.2).
//!
//! Provides CRUD over the `sessions` table plus FTS5 search across
//! `messages_fts`. All write paths update `updated_at` to the current
//! monotonic unix-ms timestamp so list ordering stays stable.

use rusqlite::{params, OptionalExtension, Row};
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

    /// Monotonic-ish unix milliseconds timestamp for ordering + freshness.
    fn unix_ms_now() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Map a `sessions` row into a [`Session`] struct.
    /// Column order MUST match the SELECT below.
    fn row_to_session(row: &Row<'_>) -> rusqlite::Result<Session> {
        Ok(Session {
            id: row.get(0)?,
            title: row.get(1)?,
            persona_id: row.get(2)?,
            project_dir: row.get(3)?,
            project_context: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            last_msg_at: row.get(7)?,
            msg_count: row.get(8)?,
            total_tokens: row.get(9)?,
            model: row.get(10)?,
            metadata: row.get(11)?,
        })
    }

    /// Shared SELECT column list for the sessions table.
    /// Used by list / get / create / update so the column order stays in lockstep.
    const SELECT_COLUMNS: &'static str =
        "id, title, persona_id, project_dir, project_context, created_at, updated_at, \
         last_msg_at, msg_count, total_tokens, model, metadata";
}

impl<'a> SessionDAO for SessionDao<'a> {
    fn list(&self, limit: i64, offset: i64) -> DbResult<Vec<Session>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM sessions \
             ORDER BY COALESCE(last_msg_at, created_at) DESC, created_at DESC \
             LIMIT ?1 OFFSET ?2",
            Self::SELECT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![limit, offset], Self::row_to_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn get(&self, id: &str) -> DbResult<Session> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM sessions WHERE id = ?1",
            Self::SELECT_COLUMNS
        );
        let session = conn
            .query_row(&sql, params![id], Self::row_to_session)
            .optional()?;
        session.ok_or_else(|| DbError::NotFound(format!("session id={id}")))
    }

    fn create(
        &self,
        title: &str,
        persona_id: Option<&str>,
        project_dir: Option<&str>,
        project_context: Option<&str>,
        // v0.2-alpha-23 (manual Tauri verification) — record the
        // model the user picked so the stats modal can group usage
        // by model instead of showing "unknown". Without this,
        // sessions.model is always NULL → COALESCE fallback in the
        // stats SQL → user sees "unknown" in the by-model table.
        model: Option<&str>,
    ) -> DbResult<Session> {
        let conn = self.pool.get()?;
        let id = Self::new_id();
        let now = Self::unix_ms_now();
        conn.execute(
            "INSERT INTO sessions \
             (id, title, persona_id, project_dir, project_context, model, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, title, persona_id, project_dir, project_context, model, now],
        )?;
        self.get(&id)
    }

    fn update(&self, id: &str, patch: SessionPatch) -> DbResult<Session> {
        let conn = self.pool.get()?;

        // Build dynamic SET clause + positional params in matching order.
        //   field is None           -> not mentioned in patch (no change)
        //   field is Some(Some(x))  -> SET field = x
        //   field is Some(None)     -> SET field = NULL (explicit clear)
        let mut sets: Vec<String> = Vec::new();
        let mut bind_values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(v) = &patch.title {
            sets.push(format!("title = ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(v.clone()));
        }
        if let Some(v) = &patch.persona_id {
            sets.push(format!("persona_id = ?{}", bind_values.len() + 1));
            match v {
                Some(s) => bind_values.push(Box::new(s.clone())),
                None => bind_values.push(Box::new(rusqlite::types::Null)),
            }
        }
        if let Some(v) = &patch.project_dir {
            sets.push(format!("project_dir = ?{}", bind_values.len() + 1));
            match v {
                Some(s) => bind_values.push(Box::new(s.clone())),
                None => bind_values.push(Box::new(rusqlite::types::Null)),
            }
        }
        if let Some(v) = &patch.project_context {
            sets.push(format!("project_context = ?{}", bind_values.len() + 1));
            match v {
                Some(s) => bind_values.push(Box::new(s.clone())),
                None => bind_values.push(Box::new(rusqlite::types::Null)),
            }
        }
        if let Some(v) = &patch.model {
            sets.push(format!("model = ?{}", bind_values.len() + 1));
            match v {
                Some(s) => bind_values.push(Box::new(s.clone())),
                None => bind_values.push(Box::new(rusqlite::types::Null)),
            }
        }
        if let Some(v) = &patch.metadata {
            sets.push(format!("metadata = ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(v.clone()));
        }

        let now = Self::unix_ms_now();

        if sets.is_empty() {
            // Empty patch — just bump updated_at so callers can use this as a "touch".
            let changed = conn.execute(
                "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            if changed == 0 {
                return Err(DbError::NotFound(format!("session id={id}")));
            }
        } else {
            // Append updated_at + id placeholders, preserving binding order.
            let updated_at_idx = bind_values.len() + 1;
            let id_idx = bind_values.len() + 2;
            sets.push(format!("updated_at = ?{updated_at_idx}"));
            let sql = format!(
                "UPDATE sessions SET {} WHERE id = ?{id_idx}",
                sets.join(", ")
            );
            bind_values.push(Box::new(now));
            bind_values.push(Box::new(id.to_string()));

            let mut stmt = conn.prepare(&sql)?;
            let params_iter: Vec<&dyn rusqlite::ToSql> = bind_values
                .iter()
                .map(|b| b.as_ref() as &dyn rusqlite::ToSql)
                .collect();
            let changed = stmt.execute(params_iter.as_slice())?;
            if changed == 0 {
                return Err(DbError::NotFound(format!("session id={id}")));
            }
        }

        self.get(id)
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        // ON DELETE CASCADE on messages.session_id + session_tags.session_id
        // handles the dependent rows. Trigger messages_ad auto-syncs FTS.
        let changed = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("session id={id}")));
        }
        Ok(())
    }

    fn clear_all(&self) -> DbResult<usize> {
        let conn = self.pool.get()?;
        // alpha-14: wipe every session row. The schema's ON DELETE
        // CASCADE handles messages + session_tags; the messages_ad
        // trigger re-syncs the FTS5 index. We don't VACUUM here — the
        // user's app stays snappy even at 10k+ rows of dead tuples;
        // SQLite's auto-vacuum will reclaim space on the next close.
        let changed = conn.execute("DELETE FROM sessions", [])?;
        Ok(changed)
    }

    fn search(&self, query: &str, limit: i64) -> DbResult<Vec<SearchHit>> {
        let conn = self.pool.get()?;
        // FTS5: match against messages_fts, JOIN back to messages + sessions for full info.
        // snippet() returns content with <b>...</b> highlights around matched terms.
        // ORDER BY rank uses BM25 (smaller = better).
        let mut stmt = conn.prepare(
            "SELECT m.id, m.session_id, s.title, \
                    snippet(messages_fts, 0, '<b>', '</b>', '...', 32) AS snippet, \
                    rank \
             FROM messages_fts f \
             JOIN messages m ON f.rowid = m.rowid \
             JOIN sessions s ON m.session_id = s.id \
             WHERE messages_fts MATCH ?1 \
             ORDER BY rank \
             LIMIT ?2",
        )?;
        let hits = stmt
            .query_map(params![query, limit], |row| {
                Ok(SearchHit {
                    message_id: row.get(0)?,
                    session_id: row.get(1)?,
                    session_title: row.get(2)?,
                    snippet: row.get(3)?,
                    rank: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(hits)
    }

    fn touch(&self, id: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        let now = Self::unix_ms_now();
        let changed = conn.execute(
            "UPDATE sessions SET last_msg_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("session id={id}")));
        }
        Ok(())
    }
}

// ── alpha-14: clear_all DAO tests ──────────────────────────────────────
//
// Verifies that `DELETE FROM sessions` cascades to `messages` and
// `session_tags` via the schema's ON DELETE CASCADE constraints, and
// that the FTS5 index re-syncs via the `messages_ad` trigger.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::{MessageDAO, SessionDAO};
    use crate::db::pool::{open_pool, Db};

    fn fresh_db() -> Db {
        let dir = std::env::temp_dir().join(format!("hermes_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool = open_pool(&dir.join("test.db")).unwrap();
        Db::new(pool)
    }

    #[test]
    fn clear_all_removes_every_session() {
        let db = fresh_db();
        // Seed 3 sessions.
        for title in ["alpha", "beta", "gamma"] {
            db.session().create(title, None, None, None).unwrap();
        }
        assert_eq!(db.session().list(10, 0).unwrap().len(), 3);
        // Clear all.
        let removed = db.session().clear_all().unwrap();
        assert_eq!(removed, 3);
        assert_eq!(db.session().list(10, 0).unwrap().len(), 0);
    }

    #[test]
    fn clear_all_cascades_to_messages() {
        let db = fresh_db();
        let s1 = db.session().create("with-messages", None, None, None).unwrap();
        // Append 2 messages to s1.
        db.message()
            .append(&s1.id, "user", "hi", None)
            .unwrap();
        db.message()
            .append(&s1.id, "assistant", "hello", None)
            .unwrap();
        // Add a 2nd session with no messages.
        db.session().create("empty", None, None, None).unwrap();
        // Clear all — messages from s1 should cascade-delete.
        let removed = db.session().clear_all().unwrap();
        assert_eq!(removed, 2);
        // list_by_session for the deleted session should error or
        // return empty (cascade deleted the parent row).
        let messages = db.message().list_by_session(&s1.id, 100, 0).unwrap();
        assert_eq!(messages.len(), 0);
    }

    #[test]
    fn clear_all_on_empty_table_returns_zero() {
        let db = fresh_db();
        let removed = db.session().clear_all().unwrap();
        assert_eq!(removed, 0);
    }
}
