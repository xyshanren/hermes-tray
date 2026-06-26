//! Migration runner.
//!
//! Reads `migrations/0001_initial.sql` etc. and applies any new files
//! to the database, recording each applied version in `schema_version`.
//!
//! Strategy:
//! 1. Read `schema_version` table; find the current max version
//! 2. List all `*.sql` files in `migrations/` (relative to CARGO_MANIFEST_DIR)
//! 3. For each file with version > current, execute + record
//!
//! Files MUST be named `NNNN_description.sql` (NNNN = zero-padded version).

use std::fs;

use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

const CURRENT_SCHEMA_VERSION: i64 = 3;

/// Apply all pending migrations. Idempotent — safe to call on every startup.
pub fn run_migrations(pool: &DbPool) -> DbResult<()> {
    let conn = pool.get()?;

    // Bootstrap schema_version so we can record what we apply next.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
             version    INTEGER PRIMARY KEY,
             applied_at INTEGER NOT NULL,
             comment    TEXT
         );",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let migrations_dir = migrations_dir();
    let mut entries: Vec<(i64, String)> = fs::read_dir(&migrations_dir)
        .map_err(|e| DbError::Migration(format!("read_dir({}): {e}", migrations_dir.display())))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            let version = parse_version_from_filename(&name)?;
            Some((version, entry.path().to_string_lossy().to_string()))
        })
        .collect();
    entries.sort_by_key(|(v, _)| *v);

    for (version, path) in entries {
        if version > current_version && version <= CURRENT_SCHEMA_VERSION {
            let sql = fs::read_to_string(&path)
                .map_err(|e| DbError::Migration(format!("read {path}: {e}")))?;
            log::info!("Applying migration v{version} from {path}");
            conn.execute_batch(&sql)
                .map_err(|e| DbError::Migration(format!("apply v{version} ({path}): {e}")))?;
            // Record that this migration has been applied.
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO schema_version (version, applied_at, comment) VALUES (?1, ?2, ?3)",
                rusqlite::params![version, now, format!("migrations/{path}")],
            )?;
        }
    }

    Ok(())
}

/// Locate the migrations directory.
///
/// In production builds the SQL is embedded via `include_str!` so we don't
/// depend on the working directory. In tests we fall back to a known path.
fn migrations_dir() -> std::path::PathBuf {
    // CARGO_MANIFEST_DIR points at src-tauri/ during `cargo test`
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(manifest_dir).join("migrations")
}

/// Parse the leading numeric prefix from `0001_initial.sql` -> `1`.
fn parse_version_from_filename(name: &str) -> Option<i64> {
    let prefix: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
    if prefix.is_empty() {
        return None;
    }
    prefix.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_from_filename_handles_padded_numbers() {
        assert_eq!(parse_version_from_filename("0001_initial.sql"), Some(1));
        assert_eq!(parse_version_from_filename("0042_fts.sql"), Some(42));
        assert_eq!(parse_version_from_filename("9999.sql"), Some(9999));
    }

    #[test]
    fn parse_version_from_filename_rejects_non_numeric() {
        assert_eq!(parse_version_from_filename("initial.sql"), None);
        assert_eq!(parse_version_from_filename("README.md"), None);
        assert_eq!(parse_version_from_filename(""), None);
    }

    #[test]
    fn parse_version_from_filename_rejects_garbage_prefix() {
        assert_eq!(parse_version_from_filename("a001_foo.sql"), None);
        assert_eq!(parse_version_from_filename("_0001.sql"), None);
    }
}
