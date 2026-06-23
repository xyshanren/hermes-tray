//! DAO traits + domain types.
//!
//! Domain types (`Session`, `Message`, `Persona`, etc.) are plain data
//! classes; the DAO traits define the operations commands invoke.
//!
//! Implementations live in `session.rs` / `message.rs` / etc. and are
//! constructed via [`crate::db::pool::Db`].
//!
//! [`crate::db::pool::Db`]: crate::db::pool::Db

use serde::{Deserialize, Serialize};

use crate::db::DbResult;

// ============================================================================
// Domain types
// ============================================================================

/// Top-level conversation container.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub persona_id: Option<String>,
    pub project_dir: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_msg_at: Option<i64>,
    pub msg_count: i64,
    pub total_tokens: i64,
    pub model: Option<String>,
    pub metadata: Option<String>,
}

/// Chat message within a session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tokens: i64,
    pub created_at: i64,
    pub tool_calls: Option<String>,
    pub metadata: Option<String>,
}

/// Assistant role definition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Persona {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub avatar: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_builtin: bool,
}

/// Configuration key-value entry. `value` is JSON-encoded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
    pub version: i64,
}

/// User feedback (thumbs + comment).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Feedback {
    pub id: String,
    pub session_id: String,
    pub msg_id: Option<String>,
    pub thumb: i64,
    pub comment: Option<String>,
    pub created_at: i64,
}

/// FTS5 search hit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchHit {
    pub message_id: String,
    pub session_id: String,
    pub snippet: String,
    pub rank: f64,
}

// ============================================================================
// Update / patch types
// ============================================================================

/// Partial update for a Session — only set fields are applied.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionPatch {
    pub title: Option<String>,
    pub persona_id: Option<Option<String>>, // Some(Some(x)) = set, Some(None) = clear, None = no change
    pub project_dir: Option<Option<String>>,
    pub model: Option<Option<String>>,
    pub metadata: Option<String>,
}

// ============================================================================
// DAO traits
// ============================================================================

/// Session CRUD + FTS search.
pub trait SessionDAO: Send + Sync {
    fn list(&self, limit: i64, offset: i64) -> DbResult<Vec<Session>>;
    fn get(&self, id: &str) -> DbResult<Session>;
    fn create(&self, title: &str, persona_id: Option<&str>) -> DbResult<Session>;
    fn update(&self, id: &str, patch: SessionPatch) -> DbResult<Session>;
    fn delete(&self, id: &str) -> DbResult<()>;
    fn search(&self, query: &str, limit: i64) -> DbResult<Vec<SearchHit>>;
    fn touch(&self, id: &str) -> DbResult<()>;
}

/// Message append / list / search.
pub trait MessageDAO: Send + Sync {
    fn append(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
    ) -> DbResult<Message>;
    fn list_by_session(&self, session_id: &str, limit: i64, offset: i64) -> DbResult<Vec<Message>>;
    fn get(&self, id: &str) -> DbResult<Message>;
    fn delete(&self, id: &str) -> DbResult<()>;
    fn count_tokens(&self, session_id: &str) -> DbResult<i64>;
}

/// Persona CRUD.
pub trait PersonaDAO: Send + Sync {
    fn list(&self) -> DbResult<Vec<Persona>>;
    fn get(&self, id: &str) -> DbResult<Persona>;
    fn create(&self, persona: &Persona) -> DbResult<Persona>;
    fn update(&self, persona: &Persona) -> DbResult<Persona>;
    fn delete(&self, id: &str) -> DbResult<()>;
    fn get_builtin(&self) -> DbResult<Vec<Persona>>;
}

/// Key-value config store (replaces config.json).
pub trait ConfigDAO: Send + Sync {
    fn get(&self, key: &str) -> DbResult<Option<ConfigEntry>>;
    fn set(&self, key: &str, value: &str) -> DbResult<ConfigEntry>;
    fn delete(&self, key: &str) -> DbResult<()>;
    fn list_all(&self) -> DbResult<Vec<ConfigEntry>>;
}

/// User feedback (RLAIF data).
pub trait FeedbackDAO: Send + Sync {
    fn submit(
        &self,
        session_id: &str,
        msg_id: Option<&str>,
        thumb: i64,
        comment: Option<&str>,
    ) -> DbResult<Feedback>;
    fn list_for_session(&self, session_id: &str) -> DbResult<Vec<Feedback>>;
    fn delete(&self, id: &str) -> DbResult<()>;
    fn count_thumbs(&self, session_id: &str) -> DbResult<(i64, i64)>; // (up, down)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_serde_round_trips() {
        let s = Session {
            id: "s1".to_string(),
            title: "Test".to_string(),
            persona_id: Some("p1".to_string()),
            project_dir: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_001_000,
            last_msg_at: Some(1_700_000_001_000),
            msg_count: 3,
            total_tokens: 256,
            model: Some("deepseek-v4".to_string()),
            metadata: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(s, parsed);
    }

    #[test]
    fn message_serde_round_trips() {
        let m = Message {
            id: "m1".to_string(),
            session_id: "s1".to_string(),
            role: "user".to_string(),
            content: "hello".to_string(),
            tokens: 1,
            created_at: 1_700_000_000_000,
            tool_calls: None,
            metadata: None,
        };
        let json = serde_json::to_string(&m).unwrap();
        let parsed: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(m, parsed);
    }

    #[test]
    fn session_patch_default_is_empty() {
        let p = SessionPatch::default();
        assert!(p.title.is_none());
        assert!(p.persona_id.is_none());
        assert!(p.metadata.is_none());
    }

    #[test]
    fn session_patch_can_distinguish_set_vs_clear() {
        // Some(Some(x)) = set, Some(None) = clear, None = no change
        let p = SessionPatch {
            persona_id: Some(Some("p1".to_string())),
            project_dir: Some(None),
            ..Default::default()
        };
        match p.persona_id {
            Some(Some(_)) => {}
            _ => panic!("expected Some(Some(_))"),
        }
        match p.project_dir {
            Some(None) => {}
            _ => panic!("expected Some(None)"),
        }
        assert!(p.title.is_none(), "title stays untouched");
    }
}