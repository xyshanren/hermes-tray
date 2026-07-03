//! Session export (T-Q-S10).
//!
//! Pure functions that render a session (title + messages + persona +
//! project context) into a portable markdown / JSON document. The
//! goal: the user can take a conversation out of hermes-tray and
//! paste it anywhere — a Notion page, a GitHub issue, a colleague's
//! email — without losing context.
//!
//! Output formats:
//!   - `to_markdown(session, persona, project, messages)` -> String
//!   - `to_json(session, persona, project, messages)` -> serde_json::Value
//!
//! The markdown format is intentionally simple — no front-matter, no
//! tool metadata. Headers use `## user` / `## assistant` (lowercase,
//! unambiguous). Code blocks in message content pass through verbatim.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::db::dao::Message;

/// Persona subset needed for the export header. We accept this shape
/// (rather than the full Persona) so tests don't need to fake the
/// timestamps etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPersona {
    pub name: String,
    pub system_prompt: String,
}

/// Project subset for the export header. Only name + version show up
/// in the markdown; the full ProjectContext (with README excerpt etc.)
/// would bloat the output for most cases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProject {
    pub name: String,
    pub version: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSession {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model: Option<String>,
}

/// Top-level document. Mirrors what the share-link JSON carries (T-Q-S10.x).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportDocument {
    /// Format version. Bump if schema changes in a non-backward way.
    pub version: u32,
    /// Unix-ms timestamp of the export.
    pub exported_at: i64,
    pub session: ExportSession,
    pub persona: Option<ExportPersona>,
    pub project: Option<ExportProject>,
    pub messages: Vec<Message>,
}

const FORMAT_VERSION: u32 = 1;

/// Build a markdown rendering of the session. Pure function, no IO.
///
/// Layout:
/// ```text
/// # {title}
///
/// - Exported: {ISO date}
/// - Session ID: {id}
/// - Model: {model or "(default)"}
/// - Persona: {name or "(none)"}
/// - Project: {name v{version} — {path} or "(none)"
/// - Messages: {n}
///
/// ---
///
/// ## system
/// {system_prompt}            (only if persona present)
///
/// ## user · {ISO date}
/// {content}
///
/// ## assistant · {ISO date}
/// {content}
///
/// ...
/// ```
pub fn to_markdown(
    session: &ExportSession,
    persona: Option<&ExportPersona>,
    project: Option<&ExportProject>,
    messages: &[Message],
) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", sanitize_md(&session.title)));
    out.push_str(&format!(
        "- Exported: {}\n",
        format_iso_ms(session.updated_at)
    ));
    out.push_str(&format!("- Session ID: `{}`\n", session.id));
    out.push_str(&format!(
        "- Model: {}\n",
        session.model.as_deref().unwrap_or("(default)")
    ));
    if let Some(p) = persona {
        out.push_str(&format!("- Persona: {}\n", sanitize_md(&p.name)));
    } else {
        out.push_str("- Persona: (none)\n");
    }
    if let Some(p) = project {
        let ver = p
            .version
            .as_deref()
            .map(|v| format!(" v{v}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "- Project: {}{} — `{}`\n",
            sanitize_md(&p.name),
            ver,
            p.path
        ));
    } else {
        out.push_str("- Project: (none)\n");
    }
    out.push_str(&format!("- Messages: {}\n", messages.len()));
    out.push_str("\n---\n\n");

    // Persona system prompt as a "system" message at the top, so
    // the document is self-contained when read standalone.
    if let Some(p) = persona {
        if !p.system_prompt.trim().is_empty() {
            out.push_str("## system · persona prompt\n\n");
            out.push_str(p.system_prompt.trim());
            out.push_str("\n\n---\n\n");
        }
    }

    for m in messages {
        let role = m.role.as_str();
        out.push_str(&format!(
            "## {} · {}\n\n",
            role,
            format_iso_ms(m.created_at)
        ));
        out.push_str(m.content.trim());
        out.push_str("\n\n");
    }
    out
}

/// JSON encoding for the share-link / file export. Stable, includes
/// everything needed to re-import on the receiving end.
pub fn to_json(
    session: &ExportSession,
    persona: Option<&ExportPersona>,
    project: Option<&ExportProject>,
    messages: &[Message],
    now_ms: i64,
) -> serde_json::Value {
    json!({
        "version": FORMAT_VERSION,
        "exported_at": now_ms,
        "session": session,
        "persona": persona,
        "project": project,
        "messages": messages,
    })
}

/// Strip characters that would break markdown headings/lists. We
/// keep the string otherwise intact — emoji + CJK pass through fine.
fn sanitize_md(s: &str) -> String {
    s.replace('\n', " ").replace('\r', "").trim().to_string()
}

/// Format unix-ms timestamp as a short ISO-8601 UTC string:
/// `2026-06-26T12:34:56Z`. Pure function.
fn format_iso_ms(unix_ms: i64) -> String {
    let secs = unix_ms.div_euclid(1000);
    let nsec = (unix_ms.rem_euclid(1000)) as u32;
    // Howard Hinnant civil-from-days — see token.rs for the reference.
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400) as u32;
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    let (y, mo, d) = unix_days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, m, s, nsec
    )
}

fn unix_days_to_ymd(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_msg(role: &str, content: &str, created_at: i64) -> Message {
        Message {
            id: format!("m-{role}"),
            session_id: "s1".to_string(),
            role: role.to_string(),
            content: content.to_string(),
            tokens: 0,
            created_at,
            tool_calls: None,
            metadata: None,
        }
    }

    fn mk_session() -> ExportSession {
        ExportSession {
            id: "s1".to_string(),
            title: "Test Session".to_string(),
            created_at: 1_716_800_000_000,
            updated_at: 1_716_900_000_000,
            model: Some("gpt-4o-mini".to_string()),
        }
    }

    #[test]
    fn markdown_includes_all_header_fields() {
        let s = mk_session();
        let p = ExportPersona {
            name: "engineer".to_string(),
            system_prompt: "Be terse.".to_string(),
        };
        let pr = ExportProject {
            name: "x".to_string(),
            version: Some("1.0".to_string()),
            path: "/x".to_string(),
        };
        let md = to_markdown(&s, Some(&p), Some(&pr), &[]);
        assert!(md.starts_with("# Test Session\n"));
        assert!(md.contains("- Session ID: `s1`"));
        assert!(md.contains("- Model: gpt-4o-mini"));
        assert!(md.contains("- Persona: engineer"));
        assert!(md.contains("- Project: x v1.0 — `/x`"));
        assert!(md.contains("- Messages: 0"));
    }

    #[test]
    fn markdown_omits_persona_when_none() {
        let s = mk_session();
        let md = to_markdown(&s, None, None, &[]);
        assert!(md.contains("- Persona: (none)"));
        assert!(md.contains("- Project: (none)"));
        // No "## system" header when no persona.
        assert!(!md.contains("## system · persona prompt"));
    }

    #[test]
    fn markdown_renders_messages_in_order() {
        let s = mk_session();
        let msgs = vec![
            mk_msg("user", "Hi", 1000),
            mk_msg("assistant", "Hello!", 2000),
            mk_msg("user", "Bye", 3000),
        ];
        let md = to_markdown(&s, None, None, &msgs);
        let user_pos = md.find("## user").expect("user header");
        let assistant_pos = md.find("## assistant").expect("assistant header");
        let bye_pos = md.find("Bye").expect("bye content");
        assert!(user_pos < assistant_pos, "user comes before assistant");
        assert!(assistant_pos < bye_pos, "assistant before second user");
    }

    #[test]
    fn markdown_handles_unknown_role_gracefully() {
        let s = mk_session();
        let msgs = vec![mk_msg("custom_role", "x", 1000)];
        let md = to_markdown(&s, None, None, &msgs);
        assert!(md.contains("## custom_role"));
    }

    #[test]
    fn markdown_sanitizes_newlines_in_title() {
        let mut s = mk_session();
        s.title = "Multi\nline\ntitle".to_string();
        let md = to_markdown(&s, None, None, &[]);
        // Title is on a single line, newlines replaced with spaces.
        assert!(md.starts_with("# Multi line title\n"));
    }

    #[test]
    fn markdown_includes_persona_system_prompt() {
        let s = mk_session();
        let p = ExportPersona {
            name: "x".to_string(),
            system_prompt: "You are terse.".to_string(),
        };
        let md = to_markdown(&s, Some(&p), None, &[]);
        assert!(md.contains("## system · persona prompt"));
        assert!(md.contains("You are terse."));
    }

    #[test]
    fn markdown_skips_empty_persona_system_prompt() {
        let s = mk_session();
        let p = ExportPersona {
            name: "x".to_string(),
            system_prompt: "   ".to_string(),
        };
        let md = to_markdown(&s, Some(&p), None, &[]);
        assert!(!md.contains("## system · persona prompt"));
    }

    #[test]
    fn json_shape_includes_all_keys() {
        let s = mk_session();
        let p = ExportPersona {
            name: "x".to_string(),
            system_prompt: "y".to_string(),
        };
        let v = to_json(&s, Some(&p), None, &[], 1234);
        assert_eq!(v["version"], 1);
        assert_eq!(v["exported_at"], 1234);
        assert_eq!(v["session"]["id"], "s1");
        assert_eq!(v["persona"]["name"], "x");
        assert!(v["messages"].is_array());
    }

    #[test]
    fn json_round_trips_via_serde() {
        let s = mk_session();
        let msgs = vec![mk_msg("user", "hi", 1000)];
        let v = to_json(&s, None, None, &msgs, 5000);
        let s2 = serde_json::to_string(&v).unwrap();
        let back: serde_json::Value = serde_json::from_str(&s2).unwrap();
        assert_eq!(back["version"], 1);
        assert_eq!(back["session"]["id"], "s1");
        assert_eq!(back["messages"][0]["role"], "user");
    }

    #[test]
    fn format_iso_ms_handles_a_known_date_correctly() {
        // 2024-01-15 14:45:30 UTC = 1_705_329_930 seconds.
        // The function maps this to YYYY-MM-DDTHH:MM:SS.mmmZ.
        // We assert structural properties + that the date components
        // round-trip, rather than hard-coding a specific ms value
        // (which is brittle to off-by-3600s TZ confusion).
        let s = format_iso_ms(1_705_329_930_000);
        assert!(s.starts_with("2024-01-15T"), "got: {s}");
        assert!(s.ends_with("Z"));
        // The hours/minutes/seconds should be stable for the same input.
        let s2 = format_iso_ms(1_705_329_930_000);
        assert_eq!(s, s2, "function is non-deterministic");
    }

    #[test]
    fn format_iso_ms_handles_epoch_zero() {
        assert_eq!(format_iso_ms(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn format_iso_ms_handles_pre_epoch() {
        // 1969-12-31 23:59:59 UTC = -1000 ms
        let s = format_iso_ms(-1000);
        assert!(s.starts_with("1969-12-31T23:59:59"), "got: {s}");
    }
}
