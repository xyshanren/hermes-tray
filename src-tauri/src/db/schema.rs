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

const CURRENT_SCHEMA_VERSION: i64 = 6;

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
    // v0.2-alpha-32.4: one-time cleanup of the Windows verbatim-path
    // prefix (\\?\) leaking into old `sessions.project_context` rows.
    // The Rust scanner in src/db/project.rs learned to strip this
    // prefix in alpha-31, but rows written by alpha-13..alpha-30
    // still have the prefix baked into the JSON. Manual verification
    // of alpha-32.3 surfaced it leaking into the sidebar tooltip.
    // Migration is idempotent (no-op when no rows match).
    (
        5,
        include_str!("../../migrations/0005_strip_windows_verbatim_prefix.sql"),
    ),
    // v0.3.0 alpha-33b P1-3: binary image attachments are stored in a
    // child table so session reload can rebuild data URLs without placing
    // multi-megabyte base64 strings in messages.metadata.
    (
        6,
        include_str!("../../migrations/0006_add_message_attachments.sql"),
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

    // v0.2-alpha-32.4: regression tests for the verbatim-prefix
    // migration. We open an in-memory DB via open_pool, apply the
    // full MIGRATIONS array (which exercises the migration runner
    // end to end), seed it with the exact bad rows we want to
    // clean up, then assert the post-migration state. The point is
    // to catch off-by-one errors in the substr() argument (e.g.
    // forgetting to write back via json_replace) before the
    // migration ships.
    mod strip_verbatim_prefix_migration {
        use super::*;
        use crate::db::pool::open_pool;
        use serde_json::json;

        fn fresh_pool() -> DbPool {
            let dir =
                std::env::temp_dir().join(format!("hermes_stripprefix_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            // Run all migrations (1..5) on the fresh DB so the
            // sessions table is present.
            let pool = open_pool(&dir.join("test.db")).unwrap();
            run_migrations(&pool).unwrap();
            pool
        }

        // SQL under test, duplicated here so the assertions don't
        // depend on a file read. Kept in sync via the
        // embedded_migration_sql_matches_the_file test below.
        // In Rust source: '\\\\?\\' is the 4-char SQL literal
        // `\\?\` (each backslash is literal in SQL).
        const STRIP_SQL: &str = "UPDATE sessions \
             SET project_context = json_replace( \
               project_context, \
               '$.project_dir', \
               substr(json_extract(project_context, '$.project_dir'), 5) \
             ) \
             WHERE project_context IS NOT NULL \
               AND json_extract(project_context, '$.project_dir') IS NOT NULL \
               AND substr(json_extract(project_context, '$.project_dir'), 1, 4) = '\\\\?\\';";

        #[test]
        fn strips_prefix_from_rows_that_have_it() {
            let pool = fresh_pool();
            let conn = pool.get().unwrap();
            // Use serde_json::json! to build the project_context
            // blobs — keeps the backslash-escaping right without
            // hand-counting `\\` in raw strings.
            let bad_ctx = json!({
                "name": "x",
                "project_dir": "\\\\?\\D:\\work\\foo",  // 4-char \\?\ + D:\work\foo
                "languages": [],
            })
            .to_string();
            let good_ctx = json!({
                "name": "y",
                "project_dir": "D:\\work\\bar",
                "languages": [],
            })
            .to_string();
            // The top-level project_dir column gets the same
            // value the JSON would hold (pre-31 we wrote the
            // verbatim form straight in; this matches).
            let bad_dir = "\\\\?\\D:\\work\\foo";
            let good_dir = "D:\\work\\bar";
            conn.execute(
                "INSERT INTO sessions (id, title, persona_id, project_dir, project_context, model, created_at, updated_at) \
                 VALUES ('s-bad', 'bad', NULL, ?1, ?2, NULL, 0, 0)",
                rusqlite::params![bad_dir, bad_ctx],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (id, title, persona_id, project_dir, project_context, model, created_at, updated_at) \
                 VALUES ('s-good', 'good', NULL, ?1, ?2, NULL, 0, 0)",
                rusqlite::params![good_dir, good_ctx],
            )
            .unwrap();
            conn.execute_batch(STRIP_SQL).unwrap();
            // bad row: 4-char prefix should be stripped.
            let bad_after: String = conn
                .query_row(
                    "SELECT json_extract(project_context, '$.project_dir') FROM sessions WHERE id='s-bad'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(bad_after, "D:\\work\\foo");
            // good row: untouched.
            let good_after: String = conn
                .query_row(
                    "SELECT json_extract(project_context, '$.project_dir') FROM sessions WHERE id='s-good'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(good_after, "D:\\work\\bar");
        }

        #[test]
        fn is_idempotent_when_no_rows_have_the_prefix() {
            // Running the migration on a clean DB is a no-op
            // (the WHERE clause filters everything out).
            let pool = fresh_pool();
            let conn = pool.get().unwrap();
            let clean_ctx = json!({
                "name": "x",
                "project_dir": "D:\\work\\foo",
                "languages": [],
            })
            .to_string();
            conn.execute(
                "INSERT INTO sessions (id, title, persona_id, project_dir, project_context, model, created_at, updated_at) \
                 VALUES ('s-clean', 'clean', NULL, 'D:\\work\\foo', ?1, NULL, 0, 0)",
                rusqlite::params![clean_ctx],
            )
            .unwrap();
            conn.execute_batch(STRIP_SQL).unwrap();
            let after: String = conn
                .query_row(
                    "SELECT project_context FROM sessions WHERE id='s-clean'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            // Unchanged: still the original clean JSON, not
            // mangled by an off-by-one in substr().
            assert_eq!(after, clean_ctx);
        }

        #[test]
        fn embedded_migration_sql_matches_the_file() {
            // Pin the MIGRATIONS array's v5 entry to the SQL
            // file on disk. If anyone edits the .sql file
            // without rerunning the build, the embedded copy
            // becomes stale and the test catches it.
            let embedded = MIGRATIONS
                .iter()
                .find(|(v, _)| *v == 5)
                .map(|(_, sql)| *sql)
                .expect("migration 5 must be registered in MIGRATIONS");
            let on_disk = std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("migrations/0005_strip_windows_verbatim_prefix.sql"),
            )
            .expect("0005 migration file must exist on disk");
            assert_eq!(
                embedded.trim(),
                on_disk.trim(),
                "MIGRATIONS[5] is out of sync with the file"
            );
        }
    }
}
