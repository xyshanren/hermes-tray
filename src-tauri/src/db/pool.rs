//! r2d2 SQLite connection pool + init_db entry point.
//!
//! Opens `%APPDATA%\com.hermes.tray\sessions.db` (Windows) or
//! `~/.config/com.hermes.tray/sessions.db` (Linux), enables WAL mode,
//! runs migrations, and hands back a [`DbPool`].
//!
//! [`Db`] is the DAO facade wrapping the pool — commands use
//! `db.session()` / `db.message()` / etc.

use std::path::Path;

use r2d2_sqlite::SqliteConnectionManager;
use tauri::Manager;

use crate::db::schema;

pub type DbPool = r2d2::Pool<SqliteConnectionManager>;

/// Initialize the DB pool and run all pending migrations.
///
/// # Errors
/// Returns `DbError::Io` if the parent directory cannot be created,
/// `DbError::Pool` if r2d2 fails to build the pool,
/// `DbError::Migration` if any SQL migration fails.
pub fn init_db(app: &tauri::AppHandle) -> Result<DbPool, crate::db::DbError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::db::DbError::Invalid(format!("app_config_dir: {e}")))?;
    std::fs::create_dir_all(&config_dir)?;
    let db_path = config_dir.join("sessions.db");
    let pool = open_pool(&db_path)?;
    schema::run_migrations(&pool)?;
    Ok(pool)
}

/// Open the pool without a Tauri AppHandle. Used by tests + migration CLI.
/// Runs migrations automatically so the DB is ready to use.
pub fn open_pool(db_path: &Path) -> Result<DbPool, crate::db::DbError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        // WAL mode: concurrent readers + single writer; safe across Tauri
        // commands and the FTS5 indexer thread.
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
    });
    let pool = r2d2::Pool::builder().max_size(10).build(manager)?;
    // Apply pending migrations. Idempotent — schema_version table records
    // what's been applied so it's safe to call on every open.
    crate::db::schema::run_migrations(&pool)?;
    Ok(pool)
}

/// DAO facade — every command reaches the DB through this.
pub struct Db {
    pool: DbPool,
}

impl Db {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &DbPool {
        &self.pool
    }

    /// Borrow the connection pool as a `SessionDAO`.
    pub fn session(&self) -> crate::db::session::SessionDao<'_> {
        crate::db::session::SessionDao::new(&self.pool)
    }

    /// Borrow the connection pool as a `MessageDAO`.
    pub fn message(&self) -> crate::db::message::MessageDao<'_> {
        crate::db::message::MessageDao::new(&self.pool)
    }

    /// Borrow the connection pool as a `PersonaDAO`.
    pub fn persona(&self) -> crate::db::persona::PersonaDao<'_> {
        crate::db::persona::PersonaDao::new(&self.pool)
    }

    /// Borrow the connection pool as a `ConfigDAO`.
    pub fn config(&self) -> crate::db::config::ConfigDao<'_> {
        crate::db::config::ConfigDao::new(&self.pool)
    }

    /// Borrow the connection pool as a `FeedbackDAO`.
    pub fn feedback(&self) -> crate::db::feedback::FeedbackDao<'_> {
        crate::db::feedback::FeedbackDao::new(&self.pool)
    }
}
