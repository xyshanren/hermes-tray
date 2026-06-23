//! Message DAO — implementation provided by builder in T-Q-S1.2.
//!
//! Skeleton file: defines [`MessageDao`] type + wires trait. Builder fills
//! SQL bodies and writes unit tests in `tests/db_message_test.rs`.

use uuid::Uuid;

use crate::db::dao::{Message, MessageDAO};
use crate::db::pool::DbPool;
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
}

impl<'a> MessageDAO for MessageDao<'a> {
    fn append(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
    ) -> DbResult<Message> {
        // TODO(T-Q-S1.2 builder): INSERT INTO messages (id, session_id, role,
        //   content, tokens, created_at, tool_calls) VALUES (?, ?, ?, ?, 0, ?, ?);
        //   Then call SessionDao::touch(session_id) to bump last_msg_at.
        let _ = (session_id, role, content, tool_calls);
        let _ = Self::new_id();
        Err(DbError::NotFound(
            "MessageDAO::append not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn list_by_session(
        &self,
        session_id: &str,
        limit: i64,
        offset: i64,
    ) -> DbResult<Vec<Message>> {
        // TODO(T-Q-S1.2 builder): SELECT ... FROM messages WHERE session_id = ?
        //   ORDER BY created_at ASC LIMIT ? OFFSET ?;
        let _ = (session_id, limit, offset);
        Err(DbError::NotFound(
            "MessageDAO::list_by_session not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn get(&self, id: &str) -> DbResult<Message> {
        let _ = id;
        Err(DbError::NotFound(format!(
            "MessageDAO::get not yet implemented (T-Q-S1.2): {id}"
        )))
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        // TODO(T-Q-S1.2 builder): DELETE FROM messages WHERE id = ?;
        //   Trigger messages_ad auto-syncs FTS.
        let _ = id;
        Err(DbError::NotFound(
            "MessageDAO::delete not yet implemented (T-Q-S1.2)".into(),
        ))
    }

    fn count_tokens(&self, session_id: &str) -> DbResult<i64> {
        // TODO(T-Q-S1.2 builder): SELECT COALESCE(SUM(tokens), 0) FROM messages WHERE session_id = ?;
        let _ = session_id;
        Err(DbError::NotFound(
            "MessageDAO::count_tokens not yet implemented (T-Q-S1.2)".into(),
        ))
    }
}