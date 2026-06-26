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

// ── Builtin personas (T-Q-S7) ───────────────────────────────────────────────────
//
// Seeded on first DB init so the persona picker is never empty. Each entry
// is also a usable session template — the system_prompt is the assistant
// brief for that role. Idempotent: skips if the persona id already exists
// (so a user-installed persona with the same id is preserved).
//
// IDs are stable strings (not random uuids) so the frontend can refer to
// them by name. Re-running on existing DBs is a no-op via the `WHERE NOT EXISTS`
// guard.

pub const BUILTIN_PERSONAS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "builtin:default",
        "通用助手",
        "平衡的默认助手，适合日常问答与一般任务",
        "你是一个有帮助、无害、诚实的助手。回答简洁准确，不确定时说不知道。",
        "🤖",
    ),
    (
        "builtin:code-reviewer",
        "代码审查",
        "Strict reviewer — finds bugs, security issues, and style problems",
        "You are a senior code reviewer. For every code change: (1) list bugs by severity, (2) flag security issues, (3) suggest concrete refactors with diffs, (4) call out missing tests. Be terse, no flattery.",
        "🔍",
    ),
    (
        "builtin:translator",
        "中英翻译",
        "Bilingual translator — natural, idiomatic, preserves tone",
        "你是中英双语翻译。在两种语言间做地道、保留原文语气和专业术语的翻译。直译优先于意译，但不译错。",
        "🌐",
    ),
];

/// Idempotent: insert any missing builtin personas. Called from `init_db`
/// after migrations.
pub fn seed_builtin_personas(db: &Db) {
    for (id, name, description, system_prompt, avatar) in BUILTIN_PERSONAS {
        let conn = match db.pool().get() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let already: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM personas WHERE id = ?1)",
                [id],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if already {
            continue;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let _ = conn.execute(
            "INSERT INTO personas (id, name, description, system_prompt, avatar, \
             created_at, updated_at, is_builtin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1)",
            rusqlite::params![id, name, description, system_prompt, avatar, now],
        );
    }
}
