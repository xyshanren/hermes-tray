//! Message DAO — implementation (T-Q-S1.2).
//!
//! Each successful append runs in a transaction that:
//! 1. Validates `role` against the schema CHECK constraint.
//! 2. Inserts the new `messages` row (FTS5 trigger `messages_ai`
//!    automatically mirrors it into `messages_fts`).
//! 3. Bumps `sessions.msg_count` and refreshes `last_msg_at` via
//!    `sessions.updated_at` so list ordering reflects activity.
//!
//! Delete mirrors the inverse: decrements `msg_count` and relies on the
//! `messages_ad` trigger to remove the FTS entry.

use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::db::dao::{Message, MessageDAO, SessionDAO};
use crate::db::pool::DbPool;
use crate::db::session::SessionDao;
use crate::db::{DbError, DbResult};

pub struct MessageDao<'a> {
    pool: &'a DbPool,
}

impl<'a> MessageDao<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

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

    /// Allowed values for `messages.role` (mirrors schema CHECK constraint).
    const ALLOWED_ROLES: &'static [&'static str] = &["user", "assistant", "system", "tool"];

    fn row_to_message(row: &Row<'_>) -> rusqlite::Result<Message> {
        Ok(Message {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            tokens: row.get(4)?,
            created_at: row.get(5)?,
            tool_calls: row.get(6)?,
            metadata: row.get(7)?,
        })
    }

    /// Shared SELECT column list for the messages table.
    const SELECT_COLUMNS: &'static str =
        "id, session_id, role, content, tokens, created_at, tool_calls, metadata";
}

impl<'a> MessageDAO for MessageDao<'a> {
    fn append(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
    ) -> DbResult<Message> {
        // Validate role before touching the DB — produces a clean
        // DbError::Invalid instead of relying on the SQLite CHECK
        // constraint error message (which is opaque).
        if !Self::ALLOWED_ROLES.contains(&role) {
            return Err(DbError::Invalid(format!(
                "role must be one of {:?}, got {:?}",
                Self::ALLOWED_ROLES,
                role
            )));
        }

        let mut conn = self.pool.get()?;
        let id = Self::new_id();
        let now = Self::unix_ms_now();

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO messages (id, session_id, role, content, tokens, created_at, tool_calls) \
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            params![id, session_id, role, content, now, tool_calls],
        )?;
        // Bump session counters + last_msg_at within the same transaction so
        // the message and the counters are either both visible or both absent.
        tx.execute(
            "UPDATE sessions \
             SET msg_count = msg_count + 1, \
                 last_msg_at = ?1, \
                 updated_at  = ?1 \
             WHERE id = ?2",
            params![now, session_id],
        )?;
        tx.commit()?;

        // Verify the session actually existed (msg_count update silently
        // affects 0 rows if id was unknown). We re-fetch via SessionDao to
        // keep the two DAOs in lockstep, then SELECT the message back.
        let _ = SessionDao::new(self.pool).get(session_id)?;
        self.get(&id)
    }

    fn list_by_session(&self, session_id: &str, limit: i64, offset: i64) -> DbResult<Vec<Message>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM messages \
             WHERE session_id = ?1 \
             ORDER BY created_at ASC, id ASC \
             LIMIT ?2 OFFSET ?3",
            Self::SELECT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![session_id, limit, offset], Self::row_to_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn get(&self, id: &str) -> DbResult<Message> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM messages WHERE id = ?1",
            Self::SELECT_COLUMNS
        );
        let msg = conn
            .query_row(&sql, params![id], Self::row_to_message)
            .optional()?;
        msg.ok_or_else(|| DbError::NotFound(format!("message id={id}")))
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;
        // Look up session_id first so we can decrement msg_count atomically.
        let session_id: Option<String> = tx
            .query_row(
                "SELECT session_id FROM messages WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let session_id = match session_id {
            Some(s) => s,
            None => return Err(DbError::NotFound(format!("message id={id}"))),
        };
        let changed = tx.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("message id={id}")));
        }
        // Floor at 0 to defend against pre-existing drift (e.g. a manually
        // edited DB). Without the guard, repeated deletes could push
        // msg_count negative.
        tx.execute(
            "UPDATE sessions SET msg_count = MAX(msg_count - 1, 0) WHERE id = ?1",
            params![session_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn count_tokens(&self, session_id: &str) -> DbResult<i64> {
        let conn = self.pool.get()?;
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(tokens), 0) FROM messages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        Ok(total)
    }
}
