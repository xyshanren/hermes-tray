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

        // T-Q-S9: estimate tokens upfront. We use a rough char/4 heuristic
        // (see token::estimate_tokens) — gateway-accurate usage capture is
        // a future enhancement. `0` for empty content is acceptable.
        let tokens = crate::db::token::estimate_tokens(content);

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO messages (id, session_id, role, content, tokens, created_at, tool_calls) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, role, content, tokens, now, tool_calls],
        )?;
        // Bump session counters + last_msg_at + total_tokens within the
        // same transaction so the message and the counters are either
        // both visible or both absent. T-Q-S9: also bump total_tokens
        // so cost charts work without an extra SELECT SUM() at read time.
        tx.execute(
            "UPDATE sessions \
             SET msg_count = msg_count + 1, \
                 total_tokens = total_tokens + ?1, \
                 last_msg_at = ?2, \
                 updated_at  = ?2 \
             WHERE id = ?3",
            params![tokens, now, session_id],
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
        // Look up session_id + tokens first so we can decrement counters
        // atomically. T-Q-S9: also subtract tokens from the session total
        // so `sessions.total_tokens` stays in sync with `SUM(messages.tokens)`.
        let row: Option<(String, i64)> = tx
            .query_row(
                "SELECT session_id, tokens FROM messages WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (session_id, msg_tokens) = match row {
            Some(r) => r,
            None => return Err(DbError::NotFound(format!("message id={id}"))),
        };
        let changed = tx.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("message id={id}")));
        }
        // Floor at 0 to defend against pre-existing drift (e.g. a manually
        // edited DB or a delete-before-this-feature message with tokens=0).
        tx.execute(
            "UPDATE sessions \
             SET msg_count = MAX(msg_count - 1, 0), \
                 total_tokens = MAX(total_tokens - ?1, 0) \
             WHERE id = ?2",
            params![msg_tokens, session_id],
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
