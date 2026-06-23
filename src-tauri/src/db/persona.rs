//! Persona DAO — implementation (T-Q-S1.3).
//!
//! CRUD over the `personas` table. `delete()` refuses to remove
//! builtin personas (is_builtin = 1) to protect the shipped role
//! library.

use rusqlite::{OptionalExtension, Row};

use crate::db::dao::{Persona, PersonaDAO};
use crate::db::pool::DbPool;
use crate::db::{DbError, DbResult};

pub struct PersonaDao<'a> {
    pool: &'a DbPool,
}

impl<'a> PersonaDao<'a> {
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

    const SELECT_COLUMNS: &'static str =
        "id, name, description, system_prompt, avatar, created_at, updated_at, is_builtin";

    fn row_to_persona(row: &Row<'_>) -> rusqlite::Result<Persona> {
        let is_builtin_int: i64 = row.get(7)?;
        Ok(Persona {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            system_prompt: row.get(3)?,
            avatar: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            is_builtin: is_builtin_int != 0,
        })
    }
}

impl<'a> PersonaDAO for PersonaDao<'a> {
    fn list(&self) -> DbResult<Vec<Persona>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM personas ORDER BY is_builtin DESC, name ASC",
            Self::SELECT_COLUMNS
        );
        let rows = conn
            .prepare(&sql)?
            .query_map([], Self::row_to_persona)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn get(&self, id: &str) -> DbResult<Persona> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM personas WHERE id = ?1",
            Self::SELECT_COLUMNS
        );
        let persona = conn
            .query_row(&sql, [id], Self::row_to_persona)
            .optional()?;
        persona.ok_or_else(|| DbError::NotFound(format!("persona id={id}")))
    }

    fn create(&self, persona: &Persona) -> DbResult<Persona> {
        let conn = self.pool.get()?;
        let now = Self::unix_ms_now();
        conn.execute(
            "INSERT INTO personas (id, name, description, system_prompt, avatar, created_at, updated_at, is_builtin) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
            rusqlite::params![
                persona.id,
                persona.name,
                persona.description,
                persona.system_prompt,
                persona.avatar,
                now,
                persona.is_builtin as i64,
            ],
        )?;
        self.get(&persona.id)
    }

    fn update(&self, persona: &Persona) -> DbResult<Persona> {
        let conn = self.pool.get()?;
        let now = Self::unix_ms_now();
        let changed = conn.execute(
            "UPDATE personas SET name = ?1, description = ?2, system_prompt = ?3, avatar = ?4, updated_at = ?5 \
             WHERE id = ?6",
            rusqlite::params![
                persona.name,
                persona.description,
                persona.system_prompt,
                persona.avatar,
                now,
                persona.id,
            ],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("persona id={}", persona.id)));
        }
        self.get(&persona.id)
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        // Reject deleting builtin personas — they're part of the shipped library.
        let is_builtin: i64 = conn
            .query_row(
                "SELECT is_builtin FROM personas WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("persona id={id}")))?;
        if is_builtin != 0 {
            return Err(DbError::Invalid(format!(
                "cannot delete builtin persona id={id}"
            )));
        }
        let changed = conn.execute("DELETE FROM personas WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("persona id={id}")));
        }
        Ok(())
    }

    fn get_builtin(&self) -> DbResult<Vec<Persona>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM personas WHERE is_builtin = 1 ORDER BY name",
            Self::SELECT_COLUMNS
        );
        let rows = conn
            .prepare(&sql)?
            .query_map([], Self::row_to_persona)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}
