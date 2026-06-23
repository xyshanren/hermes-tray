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
}
