//! Feedback DAO — user thumbs + comments (RLAIF data, T-Q-S1.3).
//!
//! `thumb` is constrained to 0 (down) or 1 (up); we validate client-side
//! before hitting the DB so the error is `DbError::Invalid` rather than
//! a SQLite CHECK failure with an opaque message.

use rusqlite::{OptionalExtension, Row};
use uuid::Uuid;

use crate::db::dao::{Feedback, FeedbackDAO};
use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

pub struct FeedbackDao<'a> {
    pool: &'a DbPool,
}

impl<'a> FeedbackDao<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    fn unix_ms_now() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    const SELECT_COLUMNS: &'static str = "id, session_id, msg_id, thumb, comment, created_at";

    fn row_to_feedback(row: &Row<'_>) -> rusqlite::Result<Feedback> {
        Ok(Feedback {
            id: row.get(0)?,
            session_id: row.get(1)?,
            msg_id: row.get(2)?,
            thumb: row.get(3)?,
            comment: row.get(4)?,
            created_at: row.get(5)?,
        })
    }
}

impl<'a> FeedbackDAO for FeedbackDao<'a> {
    fn submit(
        &self,
        session_id: &str,
        msg_id: Option<&str>,
        thumb: i64,
        comment: Option<&str>,
    ) -> DbResult<Feedback> {
        if thumb != 0 && thumb != 1 {
            return Err(DbError::Invalid(format!(
                "thumb must be 0 or 1, got {thumb}"
            )));
        }

        let conn = self.pool.get()?;
        let id = Self::new_id();
        let now = Self::unix_ms_now();
        conn.execute(
            "INSERT INTO feedback (id, session_id, msg_id, thumb, comment, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, session_id, msg_id, thumb, comment, now],
        )?;

        // Fetch the row back so the caller gets the assigned id + timestamp.
        let sql = format!(
            "SELECT {} FROM feedback WHERE id = ?1",
            Self::SELECT_COLUMNS
        );
        let fb = conn
            .query_row(&sql, [&id], Self::row_to_feedback)
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("feedback id={id} after submit")))?;
        Ok(fb)
    }

    fn list_for_session(&self, session_id: &str) -> DbResult<Vec<Feedback>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM feedback WHERE session_id = ?1 ORDER BY created_at DESC",
            Self::SELECT_COLUMNS
        );
        let rows = conn
            .prepare(&sql)?
            .query_map([session_id], Self::row_to_feedback)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        let changed = conn.execute("DELETE FROM feedback WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("feedback id={id}")));
        }
        Ok(())
    }

    fn count_thumbs(&self, session_id: &str) -> DbResult<(i64, i64)> {
        let conn = self.pool.get()?;
        // GROUP BY thumb yields 0..2 rows; we fold into (up, down) so callers
        // never need to special-case missing buckets.
        let mut up: i64 = 0;
        let mut down: i64 = 0;
        let mut stmt = conn
            .prepare("SELECT thumb, COUNT(*) FROM feedback WHERE session_id = ?1 GROUP BY thumb")?;
        let rows = stmt.query_map([session_id], |row| {
            let thumb: i64 = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((thumb, count))
        })?;
        for row in rows {
            let (thumb, count) = row?;
            if thumb == 1 {
                up = count;
            } else {
                down = count;
            }
        }
        Ok((up, down))
    }
}
