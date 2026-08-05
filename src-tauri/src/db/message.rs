//! Message DAO — implementation (T-Q-S1.2).
//!
//! Each successful append runs in a transaction that:
//! 1. Validates `role` against the schema CHECK constraint.
//! 2. Inserts the new `messages` row (FTS5 trigger `messages_ai`
//!    automatically mirrors it into `messages_fts`).
//! 3. Bumps `sessions.msg_count` and refreshes `last_msg_at` via
//!    `sessions.updated_at` so list ordering reflects activity.
//!
//! Delete mirrors the inverse: decrements `msg_count` and relies on the
//! `messages_ad` trigger to remove the FTS entry.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::db::dao::{Message, MessageAttachment, MessageDAO, SessionDAO};
use crate::db::pool::DbPool;
use crate::db::session::SessionDao;
use crate::db::{DbError, DbResult};

/// Merge S14 vision + S12 cost metadata into an existing messages.metadata
/// JSON blob.
///
/// The `existing` field is whatever the message already has (could be a
/// `pendingAttachment` index from T-Q-S14, or null). We always preserve
/// existing keys, then add:
///   - `image_tokens` (i64)  — the S14 image-part token count from the agent
///   - `routing_decision` (object or string) — S14 vision + S12 routing
///     decision; v0.1.5 also injects `cost_estimate_usd` and
///     `cost_threshold_exceeded` *inside* this object so legacy
///     json_extract(routing_decision.cost_threshold_exceeded) readers
///     still see the flag.
///   - `elapsed_ms` (i64) — wall-clock latency for the request
///   - `cost_estimate_usd` (f64) — top-level mirror of the S12 cost
///     field, also persisted to the dedicated column.
///
/// If `existing` is not valid JSON, we treat it as a plain string and
/// stash it under `_legacy` to avoid silently dropping prior metadata.
fn merge_usage_metadata(
    existing: Option<&str>,
    image_tokens: i64,
    routing_decision_json: Option<&str>,
    elapsed_ms: Option<i64>,
    cost_estimate_usd: f64,
    cost_threshold_exceeded: bool,
) -> DbResult<String> {
    let mut base: serde_json::Value = match existing {
        None | Some("") => serde_json::Value::Object(serde_json::Map::new()),
        Some(s) => match serde_json::from_str::<serde_json::Value>(s) {
            Ok(v) if v.is_object() => v,
            Ok(v) => {
                // Prior metadata was a non-object JSON value — wrap it.
                let mut m = serde_json::Map::new();
                m.insert("_legacy".to_string(), v);
                serde_json::Value::Object(m)
            }
            Err(_) => {
                // Prior metadata was not JSON at all — preserve as a string
                // under `_legacy` so callers can still see it.
                let mut m = serde_json::Map::new();
                m.insert(
                    "_legacy".to_string(),
                    serde_json::Value::String(s.to_string()),
                );
                serde_json::Value::Object(m)
            }
        },
    };

    let obj = base
        .as_object_mut()
        .expect("merge_usage_metadata: base must be an object");
    obj.insert("image_tokens".to_string(), serde_json::json!(image_tokens));
    if let Some(rd) = routing_decision_json {
        // Parse and re-serialise so downstream readers always get a JSON
        // object even if the agent pushed a stringified form.
        let mut rd_value: serde_json::Value =
            serde_json::from_str(rd).unwrap_or_else(|_| serde_json::Value::String(rd.to_string()));
        // v0.1.5 S12: inject cost fields *inside* routing_decision so the
        // legacy json_extract(routing_decision.cost_threshold_exceeded)
        // path in pre-v0.1.5 stats queries still sees the flag.
        if let Some(rd_obj) = rd_value.as_object_mut() {
            rd_obj.insert(
                "cost_estimate_usd".to_string(),
                serde_json::json!(cost_estimate_usd),
            );
            rd_obj.insert(
                "cost_threshold_exceeded".to_string(),
                serde_json::json!(cost_threshold_exceeded),
            );
        } else {
            // routing_decision was a string (not an object) — wrap it
            // so we can attach the cost fields cleanly. The original
            // string is preserved under `_raw`.
            let mut wrapper = serde_json::Map::new();
            wrapper.insert("_raw".to_string(), rd_value);
            wrapper.insert(
                "cost_estimate_usd".to_string(),
                serde_json::json!(cost_estimate_usd),
            );
            wrapper.insert(
                "cost_threshold_exceeded".to_string(),
                serde_json::json!(cost_threshold_exceeded),
            );
            rd_value = serde_json::Value::Object(wrapper);
        }
        obj.insert("routing_decision".to_string(), rd_value);
    } else {
        // No routing_decision was passed (e.g. a pre-S14 path) but the
        // S12 fields still need to live somewhere on the message.
        // Build a stub routing_decision containing only the cost fields
        // so downstream code can always read cost_threshold_exceeded
        // out of metadata.routing_decision.
        let mut stub = serde_json::Map::new();
        stub.insert(
            "cost_estimate_usd".to_string(),
            serde_json::json!(cost_estimate_usd),
        );
        stub.insert(
            "cost_threshold_exceeded".to_string(),
            serde_json::json!(cost_threshold_exceeded),
        );
        obj.insert(
            "routing_decision".to_string(),
            serde_json::Value::Object(stub),
        );
    }
    if let Some(ms) = elapsed_ms {
        obj.insert("elapsed_ms".to_string(), serde_json::json!(ms));
    }
    // Top-level mirror so future code that reads
    // `metadata.cost_estimate_usd` doesn't have to dig into
    // routing_decision. Overwritten by the routing_decision write above
    // if both keys exist (routing_decision wins, see above).
    obj.insert(
        "cost_estimate_usd".to_string(),
        serde_json::json!(cost_estimate_usd),
    );

    serde_json::to_string(&base).map_err(|e| DbError::Invalid(format!("serialize metadata: {e}")))
}

pub struct MessageDao<'a> {
    pool: &'a DbPool,
}

impl<'a> MessageDao<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    /// Monotonic-ish unix milliseconds timestamp for ordering + freshness.
    fn unix_ms_now() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Allowed values for `messages.role` (mirrors schema CHECK constraint).
    const ALLOWED_ROLES: &'static [&'static str] = &["user", "assistant", "system", "tool"];

    fn row_to_message(row: &Row<'_>) -> rusqlite::Result<Message> {
        Ok(Message {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            tokens: row.get(4)?,
            created_at: row.get(5)?,
            tool_calls: row.get(6)?,
            metadata: row.get(7)?,
        })
    }

    /// Shared SELECT column list for the messages table.
    const SELECT_COLUMNS: &'static str =
        "id, session_id, role, content, tokens, created_at, tool_calls, metadata";

    fn row_to_attachment(row: &Row<'_>) -> rusqlite::Result<MessageAttachment> {
        let mime: String = row.get(3)?;
        let data: Vec<u8> = row.get(5)?;
        Ok(MessageAttachment {
            id: row.get(0)?,
            message_id: row.get(1)?,
            name: row.get(2)?,
            data_url: format!("data:{mime};base64,{}", BASE64_STANDARD.encode(data)),
            mime,
            size: row.get(4)?,
            sort_idx: row.get(6)?,
        })
    }

    const ATTACHMENT_SELECT_COLUMNS: &'static str =
        "id, message_id, name, mime, size, data, sort_idx";

    fn get_attachment(&self, id: &str) -> DbResult<MessageAttachment> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM message_attachments WHERE id = ?1",
            Self::ATTACHMENT_SELECT_COLUMNS
        );
        conn.query_row(&sql, params![id], Self::row_to_attachment)
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("message attachment id={id}")))
    }
}

impl<'a> MessageDAO for MessageDao<'a> {
    fn append(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
    ) -> DbResult<Message> {
        // Validate role before touching the DB — produces a clean
        // DbError::Invalid instead of relying on the SQLite CHECK
        // constraint error message (which is opaque).
        if !Self::ALLOWED_ROLES.contains(&role) {
            return Err(DbError::Invalid(format!(
                "role must be one of {:?}, got {:?}",
                Self::ALLOWED_ROLES,
                role
            )));
        }

        let mut conn = self.pool.get()?;
        let id = Self::new_id();
        let now = Self::unix_ms_now();

        // T-Q-S9: estimate tokens upfront. We use a rough char/4 heuristic
        // (see token::estimate_tokens) — gateway-accurate usage capture is
        // a future enhancement. `0` for empty content is acceptable.
        let tokens = crate::db::token::estimate_tokens(content);

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO messages (id, session_id, role, content, tokens, created_at, tool_calls) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, role, content, tokens, now, tool_calls],
        )?;
        // Bump session counters + last_msg_at + total_tokens within the
        // same transaction so the message and the counters are either
        // both visible or both absent. T-Q-S9: also bump total_tokens
        // so cost charts work without an extra SELECT SUM() at read time.
        tx.execute(
            "UPDATE sessions \
             SET msg_count = msg_count + 1, \
                 total_tokens = total_tokens + ?1, \
                 last_msg_at = ?2, \
                 updated_at  = ?2 \
             WHERE id = ?3",
            params![tokens, now, session_id],
        )?;
        tx.commit()?;

        // Verify the session actually existed (msg_count update silently
        // affects 0 rows if id was unknown). We re-fetch via SessionDao to
        // keep the two DAOs in lockstep, then SELECT the message back.
        let _ = SessionDao::new(self.pool).get(session_id)?;
        self.get(&id)
    }

    fn list_by_session(&self, session_id: &str, limit: i64, offset: i64) -> DbResult<Vec<Message>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM messages \
             WHERE session_id = ?1 \
             ORDER BY created_at ASC, id ASC \
             LIMIT ?2 OFFSET ?3",
            Self::SELECT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![session_id, limit, offset], Self::row_to_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn get(&self, id: &str) -> DbResult<Message> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM messages WHERE id = ?1",
            Self::SELECT_COLUMNS
        );
        let msg = conn
            .query_row(&sql, params![id], Self::row_to_message)
            .optional()?;
        msg.ok_or_else(|| DbError::NotFound(format!("message id={id}")))
    }

    fn attach(
        &self,
        id: &str,
        message_id: &str,
        name: &str,
        mime: &str,
        size: i64,
        data: &[u8],
        sort_idx: i64,
    ) -> DbResult<MessageAttachment> {
        if !mime.starts_with("image/") {
            return Err(DbError::Invalid(format!(
                "attachment mime must be image/*, got {mime:?}"
            )));
        }
        if data.len() > 10 * 1024 * 1024 {
            return Err(DbError::Invalid("attachment exceeds 10 MiB limit".into()));
        }
        if size < 0 || size as usize != data.len() {
            return Err(DbError::Invalid(format!(
                "attachment size mismatch: declared {size}, decoded {}",
                data.len()
            )));
        }
        if sort_idx < 0 {
            return Err(DbError::Invalid(
                "attachment sort_idx must be non-negative".into(),
            ));
        }

        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO message_attachments \
             (id, message_id, name, mime, size, data, sort_idx) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, message_id, name, mime, size, data, sort_idx],
        )?;
        self.get_attachment(id)
    }

    fn list_attachments(&self, message_id: &str) -> DbResult<Vec<MessageAttachment>> {
        let conn = self.pool.get()?;
        let sql = format!(
            "SELECT {} FROM message_attachments \
             WHERE message_id = ?1 ORDER BY sort_idx ASC, id ASC",
            Self::ATTACHMENT_SELECT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![message_id], Self::row_to_attachment)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn record_usage(
        &self,
        id: &str,
        prompt_tokens: i64,
        completion_tokens: i64,
        image_tokens: i64,
        routing_decision_json: Option<&str>,
        elapsed_ms: Option<i64>,
        cost_estimate_usd: f64,
        cost_threshold_exceeded: bool,
    ) -> DbResult<Message> {
        // T-Q-S9 v2 + S14 vision + S12 cost metadata: replace the char/4
        // heuristic token estimate with the real upstream usage. We persist:
        //   - `tokens` = prompt + completion (the real total, NOT the heuristic)
        //   - `cost_estimate_usd` (REAL column) + `cost_threshold_exceeded`
        //     (INTEGER 0/1 column) for first-class aggregation in the
        //     stats modal — replaces the slower json_extract path.
        //   - `metadata` = merged JSON blob: existing metadata + S14/S12
        //     fields (`image_tokens`, `routing_decision`, `elapsed_ms`,
        //     `cost_estimate_usd`).
        //
        // The session's `total_tokens` counter is adjusted by the delta so
        // the cost chart in the stats modal stays consistent with the
        // message-level numbers. Negative deltas (real < heuristic, rare
        // for short replies with reasoning) are floored at 0.
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;

        // 1. Read existing message so we know the current tokens + session_id
        //    + existing metadata blob. Done inside the transaction so the
        //    row doesn't disappear between read and write.
        let existing: Option<(i64, String, Option<String>)> = tx
            .query_row(
                "SELECT tokens, session_id, metadata FROM messages WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let (old_tokens, session_id, existing_metadata) =
            existing.ok_or_else(|| DbError::NotFound(format!("message id={id}")))?;

        // 2. Build the merged metadata JSON. We accept arbitrary user-supplied
        //    routing_decision JSON (the S14 agent pushes a structured dict;
        //    unknown shapes are passed through verbatim so the stats modal
        //    can render what it knows and ignore the rest). v0.1.5 S12
        //    cost fields are also injected into the routing_decision
        //    object so the legacy `json_extract(metadata, '$.routing_decision.cost_threshold_exceeded')`
        //    path keeps working.
        let new_metadata = merge_usage_metadata(
            existing_metadata.as_deref(),
            image_tokens,
            routing_decision_json,
            elapsed_ms,
            cost_estimate_usd,
            cost_threshold_exceeded,
        )?;
        let new_tokens = prompt_tokens.saturating_add(completion_tokens);
        let delta = new_tokens.saturating_sub(old_tokens);
        // S12 stores the cost threshold flag as INTEGER 0/1 in SQLite.
        // Passing a bool into rusqlite::params! is supported (it goes
        // through ToSql) but we cast to i32 explicitly to avoid any
        // driver-version surprise.
        let threshold_int: i32 = if cost_threshold_exceeded { 1 } else { 0 };

        // 3. Update the message row (tokens + metadata + the 2 new
        //    S12 columns). All six values are written in a single
        //    UPDATE so the row stays consistent under concurrent
        //    readers.
        tx.execute(
            "UPDATE messages SET \
                tokens = ?1, \
                metadata = ?2, \
                cost_estimate_usd = ?3, \
                cost_threshold_exceeded = ?4 \
             WHERE id = ?5",
            params![
                new_tokens,
                new_metadata,
                cost_estimate_usd,
                threshold_int,
                id,
            ],
        )?;

        // 4. Adjust the session counter by the delta. Floor at 0 to defend
        //    against the rare case where the real usage is lower than the
        //    heuristic (long reasoning with no input text).
        tx.execute(
            "UPDATE sessions \
             SET total_tokens = MAX(total_tokens + ?1, 0) \
             WHERE id = ?2",
            params![delta, session_id],
        )?;
        tx.commit()?;

        self.get(id)
    }

    fn delete(&self, id: &str) -> DbResult<()> {
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;
        // Look up session_id + tokens first so we can decrement counters
        // atomically. T-Q-S9: also subtract tokens from the session total
        // so `sessions.total_tokens` stays in sync with `SUM(messages.tokens)`.
        let row: Option<(String, i64)> = tx
            .query_row(
                "SELECT session_id, tokens FROM messages WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (session_id, msg_tokens) = match row {
            Some(r) => r,
            None => return Err(DbError::NotFound(format!("message id={id}"))),
        };
        let changed = tx.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("message id={id}")));
        }
        // Floor at 0 to defend against pre-existing drift (e.g. a manually
        // edited DB or a delete-before-this-feature message with tokens=0).
        tx.execute(
            "UPDATE sessions \
             SET msg_count = MAX(msg_count - 1, 0), \
                 total_tokens = MAX(total_tokens - ?1, 0) \
             WHERE id = ?2",
            params![msg_tokens, session_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn count_tokens(&self, session_id: &str) -> DbResult<i64> {
        let conn = self.pool.get()?;
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(tokens), 0) FROM messages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        Ok(total)
    }
}
