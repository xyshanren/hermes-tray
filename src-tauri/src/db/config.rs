//! Config DAO — key-value store (T-Q-S1.3).
//!
//! Replaces the v0.1.x `config.json` next to the executable. Each
//! `set()` is an UPSERT that bumps the row's `version` counter, which
//! gives us a cheap "did this key change since I last read it?" check
//! for cache invalidation in the UI layer.

use rusqlite::{OptionalExtension, Row};

use crate::db::dao::{ConfigDAO, ConfigEntry};
use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

pub struct ConfigDao<'a> {
    pool: &'a DbPool,
}

impl<'a> ConfigDao<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    fn unix_ms_now() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    fn row_to_entry(row: &Row<'_>) -> rusqlite::Result<ConfigEntry> {
        Ok(ConfigEntry {
            key: row.get(0)?,
            value: row.get(1)?,
            updated_at: row.get(2)?,
            version: row.get(3)?,
        })
    }
}

impl<'a> ConfigDAO for ConfigDao<'a> {
    fn get(&self, key: &str) -> DbResult<Option<ConfigEntry>> {
        let conn = self.pool.get()?;
        let entry = conn
            .query_row(
                "SELECT key, value, updated_at, version FROM config WHERE key = ?1",
                [key],
                Self::row_to_entry,
            )
            .optional()?;
        Ok(entry)
    }

    fn set(&self, key: &str, value: &str) -> DbResult<ConfigEntry> {
        let conn = self.pool.get()?;
        let now = Self::unix_ms_now();
        // ON CONFLICT bumps `version` by 1 — gives the UI a cheap change
        // detector ("did anything change since I cached this entry?").
        conn.execute(
            "INSERT INTO config (key, value, updated_at, version) VALUES (?1, ?2, ?3, 1) \
             ON CONFLICT(key) DO UPDATE SET \
                 value      = excluded.value, \
                 updated_at = excluded.updated_at, \
                 version    = version + 1",
            rusqlite::params![key, value, now],
        )?;
        self.get(key)?
            .ok_or_else(|| DbError::NotFound(format!("config key={key} after set")))
    }

    fn delete(&self, key: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        let changed = conn.execute("DELETE FROM config WHERE key = ?1", [key])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("config key={key}")));
        }
        Ok(())
    }

    fn list_all(&self) -> DbResult<Vec<ConfigEntry>> {
        let conn = self.pool.get()?;
        let rows = conn
            .prepare("SELECT key, value, updated_at, version FROM config ORDER BY key")?
            .query_map([], Self::row_to_entry)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn reset_all(&self) -> DbResult<usize> {
        let conn = self.pool.get()?;
        // alpha-14: wipe every config row. The frontend's CONFIG_SCHEMA
        // (src/lib/config-schema.ts) owns the per-key defaults, so any
        // subsequent db_config_get returns None and the UI falls back
        // to defaults on reload. The legacy config.json file is NOT
        // touched here — see hermes_reset_config in lib.rs for the
        // full frontend reset flow.
        let changed = conn.execute("DELETE FROM config", [])?;
        Ok(changed)
    }
}

// ── alpha-14: reset_all DAO tests ──────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::{open_pool, Db};

    fn fresh_db() -> Db {
        let dir = std::env::temp_dir().join(format!("hermes_config_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool = open_pool(&dir.join("test.db")).unwrap();
        Db::new(pool)
    }

    #[test]
    fn reset_all_wipes_every_row() {
        let db = fresh_db();
        db.config().set("theme", "dark").unwrap();
        db.config().set("currency", "USD").unwrap();
        db.config().set("auto_connect", "false").unwrap();
        assert_eq!(db.config().list_all().unwrap().len(), 3);
        let removed = db.config().reset_all().unwrap();
        assert_eq!(removed, 3);
        assert_eq!(db.config().list_all().unwrap().len(), 0);
    }

    #[test]
    fn reset_all_on_empty_table_returns_zero() {
        let db = fresh_db();
        let removed = db.config().reset_all().unwrap();
        assert_eq!(removed, 0);
    }

    #[test]
    fn after_reset_all_get_returns_none() {
        let db = fresh_db();
        db.config().set("theme", "dark").unwrap();
        db.config().reset_all().unwrap();
        // Subsequent get returns None — frontend falls back to default.
        let result = db.config().get("theme").unwrap();
        assert!(result.is_none());
    }
}
