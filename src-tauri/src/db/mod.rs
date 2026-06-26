//! Hermes Tray v2 — database layer (T-Q-S1)
//!
//! Modules:
//! - [`pool`] — r2d2 connection pool + `init_db` entry point
//! - [`schema`] — migration runner, applies `migrations/*.sql` in order
//! - [`dao`] — DAO traits + domain types (Session, Message, Persona, Feedback)
//! - [`session`], [`message`], [`persona`], [`config`], [`feedback`] — DAO impls
//!
//! All DAOs are wrapped by the [`Db`] facade, so commands do:
//! ```ignore
//! db.session().list(20, 0)?;
//! db.message().append(session_id, role, content)?;
//! ```

pub mod commands;
pub mod config;
pub mod dao;
pub mod export;
pub mod feedback;
pub mod message;
pub mod persona;
pub mod pool;
pub mod project;
pub mod schema;
pub mod session;
pub mod token;

pub use dao::{
    ConfigDAO, FeedbackDAO, MessageDAO, PersonaDAO, ProjectContext, SearchHit, Session,
    SessionDAO, SessionPatch,
};
pub use pool::{init_db, Db, DbPool};
pub use token::{cost_for_model, estimate_tokens, lookup_pricing, DailyBucket, ModelBucket, ModelPricing, TokenStats};

/// Centralized error type for the DB layer.
///
/// Tauri commands convert this into a `String` via `Display`.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("migration failed: {0}")]
    Migration(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type DbResult<T> = Result<T, DbError>;
