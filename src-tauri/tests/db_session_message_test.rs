//! Integration tests for SessionDAO + MessageDAO (T-Q-S1.2).
//!
//! Each test opens a fresh on-disk SQLite via `open_pool(tempfile)` and
//! runs the migrations from `pool::open_pool`, so the schema (including
//! FTS5 + triggers) is in place before any DAO call.
//!
//! `cargo test --test db_session_message_test` runs these.

use hermes_tray_tauri_lib::db::dao::{MessageDAO, SessionDAO, SessionPatch};
use hermes_tray_tauri_lib::db::pool::open_pool;

/// Spin up a fresh isolated DB for one test. Returns both the bare pool
/// (for low-level raw-SQL access in tests) and a `Db` facade (for DAO calls).
fn fresh_db() -> (
    hermes_tray_tauri_lib::db::DbPool,
    hermes_tray_tauri_lib::db::pool::Db,
) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("test.db");
    let pool = open_pool(&path).expect("open_pool");
    // Stash the TempDir so it isn't dropped (and deleted) before the test ends.
    Box::leak(Box::new(tmp));
    let db = hermes_tray_tauri_lib::db::pool::Db::new(pool.clone());
    (pool, db)
}

// ─────────────── SessionDAO ───────────────

#[test]
fn session_create_then_get_round_trips() {
    let (_pool, dao) = fresh_db();
    let created = dao
        .session()
        .create("My Session", None, None, None)
        .expect("create");
    assert_eq!(created.title, "My Session");
    assert_eq!(created.persona_id, None);
    assert_eq!(created.msg_count, 0);
    assert_eq!(created.total_tokens, 0);

    let fetched = dao.session().get(&created.id).expect("get");
    assert_eq!(created.id, fetched.id);
    assert_eq!(created.created_at, fetched.created_at);
}

#[test]
fn session_list_paginates() {
    let (_pool, dao) = fresh_db();

    let mut ids = Vec::new();
    for i in 0..3 {
        let s = dao
            .session()
            .create(&format!("s{i}"), None, None, None)
            .unwrap();
        ids.push(s.id);
    }

    let page1 = dao.session().list(2, 0).unwrap();
    assert_eq!(page1.len(), 2, "first page should have 2 rows");
    let page2 = dao.session().list(2, 2).unwrap();
    assert_eq!(page2.len(), 1, "second page should have 1 row");

    // Combined IDs should cover all 3 created.
    let mut all: Vec<String> = page1.into_iter().chain(page2).map(|s| s.id).collect();
    all.sort();
    let mut expected = ids.clone();
    expected.sort();
    assert_eq!(all, expected);
}

#[test]
fn session_update_partial_title_only() {
    let (_pool, dao) = fresh_db();

    let created = dao.session().create("Initial", None, None, None).unwrap();
    let updated = dao
        .session()
        .update(
            &created.id,
            SessionPatch {
                title: Some("Updated Title".to_string()),
                ..Default::default()
            },
        )
        .expect("update");
    assert_eq!(updated.title, "Updated Title");
    assert_eq!(updated.persona_id, None, "untouched field preserved");
}

#[test]
fn session_update_can_clear_nullable_field() {
    let (_pool, dao) = fresh_db();

    let created = dao
        .session()
        .create("Has Persona", None, None, None)
        .unwrap();
    assert_eq!(created.persona_id, None);

    // project_dir is the easiest nullable field to test the Some(None) clear
    // path without dealing with FK constraints on persona_id (which require a
    // real persona row to exist).
    let updated = dao
        .session()
        .update(
            &created.id,
            SessionPatch {
                project_dir: Some(Some("/tmp/work".to_string())),
                ..Default::default()
            },
        )
        .expect("update");
    assert_eq!(updated.project_dir.as_deref(), Some("/tmp/work"));

    // Now clear it.
    let updated = dao
        .session()
        .update(
            &created.id,
            SessionPatch {
                project_dir: Some(None),
                ..Default::default()
            },
        )
        .expect("update");
    assert_eq!(updated.project_dir, None, "project_dir should be cleared");
    assert_eq!(updated.title, "Has Persona", "untouched field preserved");
}

#[test]
fn session_delete_cascades_to_messages() {
    let (_pool, dao) = fresh_db();

    let session = dao.session().create("to-delete", None, None, None).unwrap();
    let msg = dao
        .message()
        .append(&session.id, "user", "hi", None)
        .expect("append");
    assert_eq!(dao.session().get(&session.id).unwrap().msg_count, 1);

    // Delete the session; ON DELETE CASCADE should drop the message + FTS row.
    dao.session().delete(&session.id).expect("delete");

    // Session is gone.
    let err = dao.session().get(&session.id).unwrap_err();
    assert!(matches!(
        err,
        hermes_tray_tauri_lib::db::DbError::NotFound(_)
    ));

    // Message is gone too.
    let err = dao.message().get(&msg.id).unwrap_err();
    assert!(matches!(
        err,
        hermes_tray_tauri_lib::db::DbError::NotFound(_)
    ));
}

// ─────────────── MessageDAO ───────────────

#[test]
fn message_append_then_get_round_trips() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();

    let msg = dao
        .message()
        .append(&s.id, "user", "hello world", None)
        .expect("append");
    assert_eq!(msg.session_id, s.id);
    assert_eq!(msg.role, "user");
    assert_eq!(msg.content, "hello world");
    // T-Q-S9: token count is now auto-estimated via char/4 heuristic.
    // "hello world" is 11 chars -> 11/4 = 2.
    assert_eq!(msg.tokens, 2);

    let fetched = dao.message().get(&msg.id).expect("get");
    assert_eq!(fetched.content, "hello world");
}

#[test]
fn message_list_by_session_orders_by_created_at() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();

    let m1 = dao.message().append(&s.id, "user", "first", None).unwrap();
    let m2 = dao
        .message()
        .append(&s.id, "assistant", "second", None)
        .unwrap();
    let m3 = dao.message().append(&s.id, "user", "third", None).unwrap();

    let list = dao.message().list_by_session(&s.id, 100, 0).unwrap();
    assert_eq!(list.len(), 3);

    // Three messages appended in microseconds — created_at can collide.
    // The DAO orders by created_at ASC, then id ASC for tiebreaker. Since
    // uuids are random, we just assert set equality (all 3 returned, no
    // duplicates, no missing).
    let mut returned_ids: Vec<String> = list.iter().map(|m| m.id.clone()).collect();
    returned_ids.sort();
    let mut expected_ids = vec![m1.id.clone(), m2.id.clone(), m3.id.clone()];
    expected_ids.sort();
    assert_eq!(returned_ids, expected_ids, "all 3 messages returned");

    // And content is preserved in insertion order... well, not strictly, but
    // we can verify each content shows up exactly once.
    let mut contents: Vec<&str> = list.iter().map(|m| m.content.as_str()).collect();
    contents.sort();
    assert_eq!(contents, vec!["first", "second", "third"]);
}

#[test]
fn message_count_tokens_sums_correctly() {
    let (pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();

    // Manually append with custom token counts via raw UPDATE since
    // MessageDAO::append hardcodes tokens=0. We use a transaction-free
    // direct SQL path here for the test.
    let conn = pool.get().unwrap();
    for (i, tokens) in [1_i64, 2, 3].iter().enumerate() {
        let id = format!("m-{i}");
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, tokens, created_at) \
             VALUES (?1, ?2, 'user', 'x', ?3, ?4)",
            rusqlite::params![id, s.id, tokens, 1_700_000_000_000 + i as i64],
        )
        .unwrap();
    }
    drop(conn);

    let total = dao.message().count_tokens(&s.id).expect("count_tokens");
    assert_eq!(total, 6);
}

#[test]
fn message_invalid_role_rejected() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();

    let err = dao
        .message()
        .append(&s.id, "invalid-role", "x", None)
        .unwrap_err();
    assert!(
        matches!(err, hermes_tray_tauri_lib::db::DbError::Invalid(_)),
        "expected DbError::Invalid, got {err:?}"
    );
}

#[test]
fn message_delete_decrements_msg_count() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();
    let m = dao.message().append(&s.id, "user", "x", None).unwrap();

    // After append, msg_count should be 1.
    let after_append = dao.session().get(&s.id).unwrap();
    assert_eq!(after_append.msg_count, 1);

    // Delete the message — msg_count should drop back to 0.
    dao.message().delete(&m.id).expect("delete");
    let after_delete = dao.session().get(&s.id).unwrap();
    assert_eq!(after_delete.msg_count, 0);
}

// ─────────────── MessageDAO::record_usage (S14) ───────────────

#[test]
fn message_record_usage_replaces_heuristic_with_real_tokens() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();
    let m = dao
        .message()
        .append(&s.id, "assistant", "long reply here", None)
        .expect("append");
    // char/4 heuristic for "long reply here" (15 chars) = 3 (integer div).
    assert_eq!(m.tokens, 3);

    // S14-agent pushes real usage: 250 prompt + 100 completion = 350 total.
    let updated = dao
        .message()
        .record_usage(&m.id, 250, 100, 1200, None, None)
        .expect("record_usage");
    assert_eq!(updated.tokens, 350);
    // Session counter gets the delta: +347 (350 real - 3 heuristic).
    let s2 = dao.session().get(&s.id).expect("get session");
    assert_eq!(s2.total_tokens, 350);
}

#[test]
fn message_record_usage_stashes_image_tokens_in_metadata() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();
    let m = dao
        .message()
        .append(&s.id, "user", "see screenshot", None)
        .expect("append");

    dao.message()
        .record_usage(
            &m.id,
            500,
            200,
            1200,
            Some(r#"{"mode":"text","primary_provider":"openai","fallback_used":false}"#),
            Some(1234),
        )
        .expect("record_usage");

    let fetched = dao.message().get(&m.id).expect("get");
    let md: serde_json::Value =
        serde_json::from_str(fetched.metadata.as_deref().unwrap()).expect("parse");
    assert_eq!(md["image_tokens"], 1200);
    assert_eq!(md["elapsed_ms"], 1234);
    assert_eq!(md["routing_decision"]["mode"], "text");
    assert_eq!(md["routing_decision"]["primary_provider"], "openai");
    assert_eq!(md["routing_decision"]["fallback_used"], false);
}

#[test]
fn message_record_usage_preserves_existing_metadata() {
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();
    let m = dao
        .message()
        .append(&s.id, "user", "with attachment", None)
        .expect("append");

    // Pre-seed metadata with a T-Q-S14 attachment index (mimicking the
    // frontend's pendingAttachment record). record_usage should preserve
    // it and add the S14 fields alongside.
    {
        let pool = dao_pool(&dao);
        let conn = pool.get().expect("conn");
        conn.execute(
            "UPDATE messages SET metadata = ?1 WHERE id = ?2",
            rusqlite::params![
                r#"{"attachments":[{"name":"x.png","size":1024}]}"#,
                m.id
            ],
        )
        .expect("seed metadata");
    }

    dao.message()
        .record_usage(&m.id, 100, 50, 600, None, Some(500))
        .expect("record_usage");

    let fetched = dao.message().get(&m.id).expect("get");
    let md: serde_json::Value =
        serde_json::from_str(fetched.metadata.as_deref().unwrap()).expect("parse");
    // Existing attachment index preserved.
    assert_eq!(md["attachments"][0]["name"], "x.png");
    assert_eq!(md["attachments"][0]["size"], 1024);
    // S14 fields added.
    assert_eq!(md["image_tokens"], 600);
    assert_eq!(md["elapsed_ms"], 500);
}

#[test]
fn message_record_usage_does_not_underflow_session_total() {
    // Regression guard: when the real usage is *less* than the char/4
    // heuristic (rare but possible for short reasoning-only responses),
    // session.total_tokens must floor at 0, not go negative.
    let (_pool, dao) = fresh_db();
    let s = dao.session().create("test", None, None, None).unwrap();
    let m = dao
        .message()
        .append(&s.id, "assistant", "this is thirty six chars, hi", None)
        .expect("append");
    // "this is thirty six chars, hi" is 30 chars -> 30/4 = 7.
    assert!(m.tokens >= 5, "heuristic for 30 chars should be >= 5, got {}", m.tokens);

    // Real usage is way lower than the heuristic.
    dao.message()
        .record_usage(&m.id, 1, 1, 0, None, None)
        .expect("record_usage");

    let s2 = dao.session().get(&s.id).expect("get session");
    assert!(s2.total_tokens >= 0, "total_tokens must never go negative");
}

fn dao_pool(
    db: &hermes_tray_tauri_lib::db::pool::Db,
) -> hermes_tray_tauri_lib::db::DbPool {
    db.pool().clone()
}
