//! Persona DAO — implementation provided by builder in T-Q-S1.3.

use uuid::Uuid;

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

    fn new_id() -> String {
        Uuid::new_v4().to_string()
    }
}

impl<'a> PersonaDAO for PersonaDao<'a> {
    fn list(&self) -> DbResult<Vec<Persona>> {
        // TODO(T-Q-S1.3 builder): SELECT ... FROM personas ORDER BY is_builtin DESC, name ASC;
        Err(DbError::NotFound(
            "PersonaDAO::list not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn get(&self, id: &str) -> DbResult<Persona> {
        let _ = id;
        Err(DbError::NotFound(format!(
            "PersonaDAO::get not yet implemented (T-Q-S1.3): {id}"
        )))
    }

    fn create(&self, persona: &Persona) -> DbResult<Persona> {
        // TODO(T-Q-S1.3 builder): INSERT INTO personas (id, name, description, system_prompt,
        //   avatar, created_at, updated_at, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        let _ = persona;
        let _ = Self::new_id();
        Err(DbError::NotFound(
            "PersonaDAO::create not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn update(&self, persona: &Persona) -> DbResult<Persona> {
        let _ = persona;
        Err(DbError::NotFound(
            "PersonaDAO::update not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        // TODO(T-Q-S1.3 builder): reject delete on is_builtin = 1;
        //   otherwise DELETE FROM personas WHERE id = ?;
        let _ = id;
        Err(DbError::NotFound(
            "PersonaDAO::delete not yet implemented (T-Q-S1.3)".into(),
        ))
    }

    fn get_builtin(&self) -> DbResult<Vec<Persona>> {
        // TODO(T-Q-S1.3 builder): SELECT ... FROM personas WHERE is_builtin = 1 ORDER BY name;
        Err(DbError::NotFound(
            "PersonaDAO::get_builtin not yet implemented (T-Q-S1.3)".into(),
        ))
    }
}
