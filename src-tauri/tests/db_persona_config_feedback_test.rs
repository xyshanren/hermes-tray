//! Integration tests for PersonaDAO + ConfigDAO + FeedbackDAO (T-Q-S1.3).
//!
//! `cargo test --test db_persona_config_feedback_test` runs these.

use hermes_tray_tauri_lib::db::dao::{ConfigDAO, FeedbackDAO, Persona, PersonaDAO, SessionDAO};
use hermes_tray_tauri_lib::db::pool::open_pool;

/// Spin up a fresh isolated DB for one test, returning both the bare pool
/// and a `Db` facade.
fn fresh_db() -> (
    hermes_tray_tauri_lib::db::DbPool,
    hermes_tray_tauri_lib::db::pool::Db,
) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("test.db");
    let pool = open_pool(&path).expect("open_pool");
    Box::leak(Box::new(tmp));
    let db = hermes_tray_tauri_lib::db::pool::Db::new(pool.clone());
    (pool, db)
}

fn make_persona(id: &str, name: &str, builtin: bool) -> Persona {
    Persona {
        id: id.to_string(),
        name: name.to_string(),
        description: Some(format!("desc for {name}")),
        system_prompt: format!("system prompt for {name}"),
        avatar: Some("🦀".to_string()),
        created_at: 0,
        updated_at: 0,
        is_builtin: builtin,
    }
}

#[test]
fn persona_crud_full_cycle() {
    let (_pool, dao) = fresh_db();

    let created = dao
        .persona()
        .create(&make_persona("p1", "Engineer", false))
        .expect("create");
    assert_eq!(created.name, "Engineer");
    assert!(!created.is_builtin);
    assert!(created.created_at > 0);

    let fetched = dao.persona().get("p1").expect("get");
    assert_eq!(fetched.name, "Engineer");

    // Update — we re-build the struct with a new name + bumped updated_at.
    let mut updated = fetched.clone();
    updated.name = "Senior Engineer".to_string();
    let result = dao.persona().update(&updated).expect("update");
    assert_eq!(result.name, "Senior Engineer");
    assert!(result.updated_at >= created.updated_at);

    // Delete + verify NotFound on second delete.
    dao.persona().delete("p1").expect("delete");
    let err = dao.persona().delete("p1").unwrap_err();
    assert!(matches!(
        err,
        hermes_tray_tauri_lib::db::DbError::NotFound(_)
    ));
}

#[test]
fn persona_builtin_delete_is_rejected() {
    let (_pool, dao) = fresh_db();

    dao.persona()
        .create(&make_persona("builtin-1", "Default Assistant", true))
        .expect("create");

    let err = dao.persona().delete("builtin-1").unwrap_err();
    assert!(
        matches!(err, hermes_tray_tauri_lib::db::DbError::Invalid(_)),
        "expected DbError::Invalid, got {err:?}"
    );

    // Persona's still there.
    let still = dao.persona().get("builtin-1").expect("get");
    assert_eq!(still.name, "Default Assistant");
    assert!(still.is_builtin);

    // get_builtin should include it.
    let builtins = dao.persona().get_builtin().expect("get_builtin");
    assert_eq!(builtins.len(), 1);
    assert_eq!(builtins[0].id, "builtin-1");
}

#[test]
fn config_set_upserts_and_bumps_version() {
    let (_pool, dao) = fresh_db();

    let v1 = dao.config().set("wsl_distro", "Ubuntu-22.04").expect("set");
    assert_eq!(v1.value, "Ubuntu-22.04");
    assert_eq!(v1.version, 1);

    let v2 = dao
        .config()
        .set("wsl_distro", "Ubuntu-24.04.4")
        .expect("set");
    assert_eq!(v2.value, "Ubuntu-24.04.4");
    assert_eq!(v2.version, 2, "version should bump on update");

    // Independent keys don't bump each other's version.
    let other = dao.config().set("gateway_port", "8642").expect("set");
    assert_eq!(other.version, 1);
}

#[test]
fn config_list_all_returns_sorted() {
    let (_pool, dao) = fresh_db();

    dao.config().set("zeta", "z").unwrap();
    dao.config().set("alpha", "a").unwrap();
    dao.config().set("mu", "m").unwrap();

    let all = dao.config().list_all().expect("list_all");
    let keys: Vec<&str> = all.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, vec!["alpha", "mu", "zeta"], "keys should be sorted");

    // Get returns None for missing key.
    let missing = dao.config().get("nonexistent").expect("get missing");
    assert!(missing.is_none());

    // Delete works.
    dao.config().delete("alpha").expect("delete");
    let all_after = dao.config().list_all().expect("list_all");
    assert_eq!(all_after.len(), 2);
}

#[test]
fn feedback_count_thumbs_separates_up_and_down() {
    let (_pool, dao) = fresh_db();
    // Need a real session for FK.
    let session = dao.session().create("for-feedback", None).unwrap();

    // Submit 2 up + 3 down.
    for _ in 0..2 {
        dao.feedback()
            .submit(&session.id, None, 1, Some("good"))
            .expect("submit up");
    }
    for _ in 0..3 {
        dao.feedback()
            .submit(&session.id, None, 0, Some("bad"))
            .expect("submit down");
    }
    // One invalid thumb — should fail cleanly.
    let err = dao
        .feedback()
        .submit(&session.id, None, 99, None)
        .unwrap_err();
    assert!(matches!(
        err,
        hermes_tray_tauri_lib::db::DbError::Invalid(_)
    ));

    let (up, down) = dao.feedback().count_thumbs(&session.id).expect("count");
    assert_eq!(up, 2);
    assert_eq!(down, 3);

    // list_for_session returns all 5.
    let all = dao.feedback().list_for_session(&session.id).expect("list");
    assert_eq!(all.len(), 5);

    // Session with no feedback returns (0, 0).
    let empty_session = dao.session().create("no-feedback", None).unwrap();
    let (up_e, down_e) = dao
        .feedback()
        .count_thumbs(&empty_session.id)
        .expect("count empty");
    assert_eq!((up_e, down_e), (0, 0));
}

// ── T-Q-S7 tests: seed_builtin_personas + default_persona_id persistence ──────
//
// Validates the integration between:
//   - `BUILTIN_PERSONAS` constant (data shape)
//   - `seed_builtin_personas` (idempotent insert)
//   - ConfigDAO used by the Tauri commands `db_config_get` / `db_config_set`
//     (default_persona_id persistence used by the persona picker on relaunch).
//
// Tauri command wrappers themselves are thin pass-throughs to the DAOs
// and aren't directly callable from tests (they need `State<'_, Db>`).
// Coverage at the DAO level is sufficient — frontend smoke tests would
// exercise the command wiring.

use hermes_tray_tauri_lib::db::pool::BUILTIN_PERSONAS;

#[test]
fn seed_builtin_personas_inserts_three_on_empty_db() {
    let (_pool, db) = fresh_db();
    hermes_tray_tauri_lib::db::pool::seed_builtin_personas(&db);

    let list = db.persona().list().expect("list");
    assert_eq!(list.len(), 3, "expected 3 builtin personas seeded");
    let ids: Vec<&str> = list.iter().map(|p| p.id.as_str()).collect();
    assert!(ids.contains(&"builtin:default"));
    assert!(ids.contains(&"builtin:code-reviewer"));
    assert!(ids.contains(&"builtin:translator"));
    for p in &list {
        assert!(p.is_builtin, "seeded personas should be marked builtin");
        assert!(!p.system_prompt.is_empty(), "system_prompt should be non-empty");
    }
}

#[test]
fn seed_builtin_personas_is_idempotent() {
    let (_pool, db) = fresh_db();
    hermes_tray_tauri_lib::db::pool::seed_builtin_personas(&db);
    // Second call: same DB, must not duplicate or overwrite.
    hermes_tray_tauri_lib::db::pool::seed_builtin_personas(&db);
    let list = db.persona().list().expect("list");
    assert_eq!(list.len(), 3, "second seed must be a no-op");
}

#[test]
fn seed_builtin_personas_does_not_clobber_user_persona() {
    let (_pool, db) = fresh_db();
    // User creates a persona with the same id as a builtin (e.g. via migration).
    let p = make_persona("builtin:default", "User-edited Default", false);
    db.persona().create(&p).expect("create");
    // Seed runs — should respect existing row and not overwrite.
    hermes_tray_tauri_lib::db::pool::seed_builtin_personas(&db);
    let got = db.persona().get("builtin:default").expect("get");
    assert_eq!(got.name, "User-edited Default", "user row must survive seed");
}

#[test]
fn builtin_personas_constant_has_consistent_shape() {
    // Sanity: every builtin entry has id / name / description / system_prompt
    // / avatar (5-tuple) and uses the "builtin:" prefix on the id.
    for (id, name, desc, prompt, avatar) in BUILTIN_PERSONAS {
        assert!(id.starts_with("builtin:"), "id must use 'builtin:' prefix: {id}");
        assert!(!name.is_empty());
        assert!(!desc.is_empty());
        assert!(!prompt.is_empty());
        assert!(!avatar.is_empty());
    }
    // IDs must be unique (otherwise seed's WHERE NOT EXISTS guard breaks).
    let mut ids: Vec<&str> = BUILTIN_PERSONAS.iter().map(|(id, ..)| *id).collect();
    let total = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), total, "builtin persona ids must be unique");
}

#[test]
fn default_persona_id_round_trips_via_config_dao() {
    // The Tauri commands `db_config_get` / `db_config_set` are thin
    // pass-throughs to `ConfigDAO::get` / `set`. This test covers the
    // end-to-end shape of what the frontend expects.
    let (_pool, db) = fresh_db();

    // 1. Initial state: missing key (matches `loadDefaultPersonaId()` in
    //    main.ts which falls back to null).
    let initial = db.config().get("default_persona_id").expect("get initial");
    assert!(initial.is_none());

    // 2. User picks a persona → set() writes a string value.
    let v1 = db
        .config()
        .set("default_persona_id", "builtin:code-reviewer")
        .expect("set 1");
    assert_eq!(v1.value, "builtin:code-reviewer");
    assert_eq!(v1.version, 1);

    // 3. App relaunch → get() returns the saved value.
    let saved = db.config().get("default_persona_id").expect("get saved");
    let saved = saved.expect("value should exist after set");
    assert_eq!(saved.value, "builtin:code-reviewer");

    // 4. User picks a different persona → set() upserts and bumps version.
    let v2 = db
        .config()
        .set("default_persona_id", "builtin:translator")
        .expect("set 2");
    assert_eq!(v2.version, 2, "version should bump on update");
    assert_eq!(v2.value, "builtin:translator");
}
