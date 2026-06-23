//! Feedback DAO — user thumbs + comments (RLAIF data).
//! Implementation provided by builder in T-Q-S1.3.

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
}

impl<'a> FeedbackDAO for FeedbackDao<'a> {
    fn submit(
        &self,
        session_id: &str,
        msg_id: Option<&str>,
        thumb: i64,
        comment: Option<&str>,
    ) -> DbResult<Feedback> {
        // TODO(T-Q-S1.3 builder): INSERT INTO feedback (id, session_id, msg_id, thumb,
        //   comment, created_at) VALUES (?, ?, ?, ?, ?, ?);
        let _ = (session_id, msg_id, thumb, comment);
        let _ = Self::new_id();
        Err(DbError::NotFound(
            "FeedbackDAO::submit not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn list_for_session(&self, session_id: &str) -> DbResult<Vec<Feedback>> {
        // TODO(T-Q-S1.3 builder): SELECT ... FROM feedback WHERE session_id = ?
        //   ORDER BY created_at DESC;
        let _ = session_id;
        Err(DbError::NotFound(
            "FeedbackDAO::list_for_session not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let _ = id;
        Err(DbError::NotFound(
            "FeedbackDAO::delete not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn count_thumbs(&self, session_id: &str) -> DbResult<(i64, i64)> {
        // TODO(T-Q-S1.3 builder): SELECT thumb, COUNT(*) FROM feedback
        //   WHERE session_id = ? GROUP BY thumb;
        let _ = session_id;
        Err(DbError::NotFound(
            "FeedbackDAO::count_thumbs not yet implemented (T-Q-S1.3)".into(),
        ))
    }
}