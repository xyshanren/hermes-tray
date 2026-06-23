//! Config DAO — key-value store (replaces config.json).
//! Implementation provided by builder in T-Q-S1.3.

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
}

impl<'a> ConfigDAO for ConfigDao<'a> {
    fn get(&self, key: &str) -> DbResult<Option<ConfigEntry>> {
        // TODO(T-Q-S1.3 builder): SELECT key, value, updated_at, version FROM config WHERE key = ?;
        let _ = key;
        Err(DbError::NotFound(
            "ConfigDAO::get not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn set(&self, key: &str, value: &str) -> DbResult<ConfigEntry> {
        // TODO(T-Q-S1.3 builder): INSERT INTO config (key, value, updated_at, version)
        //   VALUES (?, ?, ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value,
        //   updated_at = excluded.updated_at, version = version + 1;
        let _ = (key, value);
        Err(DbError::NotFound(
            "ConfigDAO::set not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn delete(&self, key: &str) -> DbResult<()> {
        let _ = key;
        Err(DbError::NotFound(
            "ConfigDAO::delete not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn list_all(&self) -> DbResult<Vec<ConfigEntry>> {
        Err(DbError::NotFound(
            "ConfigDAO::list_all not yet implemented (T-Q-S1.3)".into(),
        ))
    }
}
