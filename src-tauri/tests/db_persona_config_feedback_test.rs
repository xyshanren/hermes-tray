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
