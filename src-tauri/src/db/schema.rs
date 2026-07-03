//! Migration runner.
//!
//! Applies SQL migrations to the database, recording each applied
//! version in `schema_version`.
//!
//! Strategy:
//! 1. Read `schema_version` table; find the current max version
//! 2. For each entry in the `MIGRATIONS` const array with version >
//!    current, execute + record
//!
//! **Migrations are embedded at compile time via `include_str!`** so the
//! release binary does not depend on the working directory containing
//! a `migrations/` subfolder. The previous fs::read_dir approach
//! silently failed when the user launched the MSI-installed binary
//! from a Start Menu shortcut (cwd != install dir) and the app
//! panicked at startup with "系统找不到指定的路径". Embedding the
//! SQL avoids that whole class of problem.
//!
//! Files MUST be named `NNNN_description.sql` (NNNN = zero-padded version).
//! Add a new const entry below when adding a migration.

use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

const CURRENT_SCHEMA_VERSION: i64 = 4;

/// Embedded migrations in version order. The version number is the
/// leading digits of the original filename (e.g. `0001_initial.sql` -> 1).
/// Adding a migration = appending a new entry here AND bumping
/// `CURRENT_SCHEMA_VERSION`.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_initial.sql")),
    (
        2,
        include_str!("../../migrations/0002_add_project_context.sql"),
    ),
    (
        3,
        include_str!("../../migrations/0003_add_persona_model.sql"),
    ),
    // v0.1.5: S12 cost metadata — `cost_estimate_usd` REAL (per-message
    // real cost from agent S12 SSE usage) + `cost_threshold_exceeded`
    // INTEGER (0/1; whether S12 cost-aware fallback flagged this turn).
    // Replaces the older `json_extract(metadata, '$.cost_estimate_usd')`
    // path so the stats modal aggregates are O(1) per row instead of
    // re-parsing the JSON blob.
    (
        4,
        include_str!("../../migrations/0004_add_cost_metadata.sql"),
    ),
];

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

    for (version, sql) in MIGRATIONS {
        if *version > current_version && *version <= CURRENT_SCHEMA_VERSION {
            log::info!("Applying migration v{version} (embedded)");
            conn.execute_batch(sql)
                .map_err(|e| DbError::Migration(format!("apply v{version} (embedded): {e}")))?;
            // Record that this migration has been applied.
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO schema_version (version, applied_at, comment) VALUES (?1, ?2, ?3)",
                rusqlite::params![version, now, format!("embedded v{version}")],
            )?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_array_is_sorted_and_complete() {
        // Regression guard: MIGRATIONS must be in ascending order and the
        // highest version must equal CURRENT_SCHEMA_VERSION. If a
        // maintainer adds a migration but forgets to bump
        // CURRENT_SCHEMA_VERSION, this test fails.
        let mut prev = 0;
        for (v, _sql) in MIGRATIONS {
            assert!(
                *v > prev,
                "MIGRATIONS not in ascending order: {prev} -> {v}"
            );
            prev = *v;
        }
        assert_eq!(
            MIGRATIONS.last().map(|(v, _)| *v),
            Some(CURRENT_SCHEMA_VERSION),
            "CURRENT_SCHEMA_VERSION must equal the highest entry in MIGRATIONS"
        );
    }

    #[test]
    fn migrations_array_contains_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for (v, _) in MIGRATIONS {
            assert!(seen.insert(*v), "duplicate migration version: {v}");
        }
    }
}
