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
    pub project_context: Option<String>, // JSON-encoded ProjectContext
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
    /// T-Q-S12-light: optional model override. When the user picks
    /// this persona, the chat sends requests with `model: <this>`.
    /// `None` means "use the global default" (user's preference in
    /// config or what the gateway reports via /v1/models).
    pub model: Option<String>,
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

/// Project context snapshot produced by `project::scan_project` and
/// persisted into `sessions.project_context` (JSON-encoded). The actual
/// type lives in [`crate::db::project::ProjectContext`] — re-exported
/// here so DAO consumers don't need a second import.
pub use crate::db::project::ProjectContext;

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
    pub session_title: String,
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
    pub project_context: Option<Option<String>>, // Some(Some(json)) = set, Some(None) = clear
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
    /// Create a session. `project_dir` is the user-picked path (None for
    /// project-less sessions). `project_context` is the pre-computed JSON
    /// snapshot from `project::scan_project`; pass None if the user
    /// didn't pick a project or scan failed.
    fn create(
        &self,
        title: &str,
        persona_id: Option<&str>,
        project_dir: Option<&str>,
        project_context: Option<&str>,
    ) -> DbResult<Session>;
    fn update(&self, id: &str, patch: SessionPatch) -> DbResult<Session>;
    fn delete(&self, id: &str) -> DbResult<()>;
    /// alpha-14: delete EVERY row in the sessions table. The schema's
    /// `ON DELETE CASCADE` on `messages.session_id` and
    /// `session_tags.session_id` cleans up dependent rows; the
    /// `messages_ad` trigger re-syncs the FTS5 index. Returns the
    /// number of sessions removed so the UI can show "已删除 N 个会话".
    fn clear_all(&self) -> DbResult<usize>;
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
    /// Replace the char/4 heuristic token estimate with the real upstream
    /// usage (prompt_tokens + completion_tokens) and stash the S14/S12
    /// metadata (image_tokens / routing_decision / elapsed_ms /
    /// cost_estimate_usd / cost_threshold_exceeded) on the message.
    /// Adjusts the session's total_tokens by the delta so the chart stays
    /// in sync with the persisted value.
    ///
    /// v0.1.5 S12 fields:
    /// - `cost_estimate_usd` — real USD cost from agent S12 SSE
    ///   `usage.cost_estimate_usd` (real value, replaces char/4
    ///   heuristic). Persisted to dedicated `messages.cost_estimate_usd`
    ///   column AND mirrored into the metadata JSON blob for legacy
    ///   readers.
    /// - `cost_threshold_exceeded` — bool, S12 cost-aware fallback flag.
    ///   Persisted to `messages.cost_threshold_exceeded` (0/1) and
    ///   mirrored into `routing_decision.cost_threshold_exceeded` in the
    ///   metadata blob.
    // The S14 v0.1.4 signature already triggered the
    // `clippy::too_many_arguments` lint at 6 args. v0.1.5 S12 adds two
    // more (cost_estimate_usd + cost_threshold_exceeded) and pushes
    // us to 8. We can't easily collapse them into a struct without
    // breaking the Tauri IPC contract (the frontend already calls
    // `message_record_usage` with these as separate kwargs), so we
    // allow the lint explicitly. The DAO is the boundary — anything
    // below it can use structs freely.
    #[allow(clippy::too_many_arguments)]
    fn record_usage(
        &self,
        id: &str,
        prompt_tokens: i64,
        completion_tokens: i64,
        image_tokens: i64,
        routing_decision_json: Option<&str>,
        elapsed_ms: Option<i64>,
        cost_estimate_usd: f64,
        cost_threshold_exceeded: bool,
    ) -> DbResult<Message>;
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
    /// alpha-14: wipe every row in the config table. The frontend's
    /// CONFIG_SCHEMA in src/lib/config-schema.ts owns the per-key
    /// defaults, so any subsequent `db_config_get(key)` returns None
    /// and the UI falls back to defaults on reload. Returns the number
    /// of rows removed. Note: this does NOT touch the legacy
    /// `config.json` file used for wsl_distro / port / api_key — the
    /// frontend's settings-reset flow handles that separately.
    fn reset_all(&self) -> DbResult<usize>;
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
            project_context: None,
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
