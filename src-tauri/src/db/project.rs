//! Project context scanner (T-Q-S8).
//!
//! Reads a project directory and produces a compact `ProjectContext`
//! suitable for injection into the LLM system prompt. Pure functions
//! take a path and return data — no DB access. The caller is responsible
//! for persisting the result.
//!
//! What we scan (first hit wins per category, all are best-effort):
//!   - `README.md` / `README.zh.md` / `readme.md` — first 2KB excerpt
//!   - `package.json` — name, version, description, scripts
//!   - `Cargo.toml` — [package] name, version, description
//!   - `pyproject.toml` — [project] name, version, description
//!   - `go.mod` — first line (module path)
//!   - `.git/config` — remote.origin.url
//!   - Top-level file extensions — language guess
//!
//! Limits (deliberate, to keep system prompt manageable):
//!   - README excerpt: 2 KB
//!   - Final rendered markdown: 4 KB
//!   - File extension scan: top-level dir only, capped at 200 entries
//!
//! Failure mode: any single file failing to read is silently ignored —
//! partial context is still useful. Only the path itself failing to
//! stat produces an error.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Scan output — what the frontend persists into `sessions.project_context`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectContext {
    /// Absolute path the user picked. Echoed back so the UI can show it.
    pub project_dir: String,
    /// Display name — basename of dir, or manifest name if found.
    pub name: String,
    /// Optional version string from the manifest.
    pub version: Option<String>,
    /// Optional description from the manifest.
    pub description: Option<String>,
    /// First 2 KB of README (markdown). None if no README found.
    pub readme_excerpt: Option<String>,
    /// Detected languages (sorted, deduped). E.g. `["rust", "typescript"]`.
    pub languages: Vec<String>,
    /// True if a `.git/` directory is present at the project root.
    pub has_git: bool,
    /// `remote.origin.url` from `.git/config`, if present.
    pub git_remote: Option<String>,
    /// Files we actually read. Useful for diagnostics + tests.
    pub files_scanned: Vec<String>,
    /// Rendered markdown summary (≤4 KB) ready for system-prompt injection.
    pub summary_markdown: String,
    /// Unix-ms timestamp of when this scan ran.
    pub scanned_at: i64,
}

/// Hard limits — see module docs.
const README_MAX_BYTES: usize = 2048;
const SUMMARY_MAX_BYTES: usize = 4096;
const DIR_SCAN_CAP: usize = 200;

/// Read the manifest for the given project and return a `ProjectContext`.
///
/// # Errors
/// Returns `Err` only if `path` cannot be stat'd (does not exist, is
/// not a directory, or permission denied). Per-file read failures are
/// silently tolerated and reflected as missing fields in the result.
pub fn scan_project(path: &Path) -> Result<ProjectContext, String> {
    let meta = fs::metadata(path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }

    let project_dir = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let mut files_scanned: Vec<String> = Vec::new();

    // Manifest first — gives us the canonical name (overrides dir basename).
    let manifest = read_manifest(path, &mut files_scanned);

    // README.
    let readme = read_readme(path, &mut files_scanned);

    // Git.
    let has_git = path.join(".git").is_dir();
    let git_remote = if has_git {
        read_git_remote(&path.join(".git").join("config"))
    } else {
        None
    };

    // Languages from top-level extensions.
    let languages = detect_languages(path);

    // Name resolution: manifest.name > dir basename > "unknown".
    let dir_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    let name = manifest
        .as_ref()
        .and_then(|m| m.name.clone())
        .unwrap_or(dir_name);

    let summary = render_summary(&SummaryInputs {
        name: &name,
        version: manifest.as_ref().and_then(|m| m.version.as_deref()),
        description: manifest.as_ref().and_then(|m| m.description.as_deref()),
        readme_excerpt: readme.as_deref(),
        languages: &languages,
        has_git,
        git_remote: git_remote.as_deref(),
        project_dir: &project_dir,
    });

    // Pull the version/description out of the manifest Option before
    // moving it into the ProjectContext below. `manifest` itself can
    // then be dropped (no further use).
    let (version, description) = match manifest {
        Some(m) => (m.version, m.description),
        None => (None, None),
    };

    Ok(ProjectContext {
        project_dir,
        name,
        version,
        description,
        readme_excerpt: readme,
        languages,
        has_git,
        git_remote,
        files_scanned,
        summary_markdown: summary,
        scanned_at: unix_ms_now(),
    })
}

#[derive(Default, Debug)]
struct ManifestInfo {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
}

/// Try common manifest files in priority order. First hit wins per
/// field — we don't merge across ecosystems.
fn read_manifest(root: &Path, files_scanned: &mut Vec<String>) -> Option<ManifestInfo> {
    // Priority: package.json (most metadata) > Cargo.toml > pyproject.toml > go.mod
    if let Some(p) = first_existing(root, &["package.json", "Package.json"]) {
        if let Ok(s) = fs::read_to_string(&p) {
            files_scanned.push(p.display().to_string());
            return Some(parse_package_json(&s));
        }
    }
    if let Some(p) = first_existing(root, &["Cargo.toml"]) {
        if let Ok(s) = fs::read_to_string(&p) {
            files_scanned.push(p.display().to_string());
            return Some(parse_cargo_toml(&s));
        }
    }
    if let Some(p) = first_existing(root, &["pyproject.toml"]) {
        if let Ok(s) = fs::read_to_string(&p) {
            files_scanned.push(p.display().to_string());
            return Some(parse_pyproject_toml(&s));
        }
    }
    if let Some(p) = first_existing(root, &["go.mod"]) {
        if let Ok(s) = fs::read_to_string(&p) {
            files_scanned.push(p.display().to_string());
            return Some(parse_go_mod(&s));
        }
    }
    None
}

fn first_existing(root: &Path, names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .map(|n| root.join(n))
        .find(|p| p.is_file())
}

fn read_readme(root: &Path, files_scanned: &mut Vec<String>) -> Option<String> {
    let candidates = [
        "README.md",
        "README.zh.md",
        "README.MD",
        "readme.md",
        "Readme.md",
    ];
    for name in candidates {
        let p = root.join(name);
        if p.is_file() {
            if let Ok(s) = fs::read_to_string(&p) {
                files_scanned.push(p.display().to_string());
                return Some(truncate_chars(&s, README_MAX_BYTES));
            }
        }
    }
    None
}

fn read_git_remote(git_config: &Path) -> Option<String> {
    let s = fs::read_to_string(git_config).ok()?;
    // Look for the [remote "origin"] section, then url = ...
    let mut in_origin = false;
    for line in s.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_origin = trimmed == "[remote \"origin\"]";
            continue;
        }
        if in_origin && trimmed.starts_with("url") {
            if let Some((_, v)) = trimmed.split_once('=') {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// Top-level extension → language map. Limited to the most common
/// ecosystems — we don't need to be exhaustive, just useful.
fn extension_to_language(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "rs" => Some("rust"),
        "py" => Some("python"),
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "go" => Some("go"),
        "java" => Some("java"),
        "kt" | "kts" => Some("kotlin"),
        "swift" => Some("swift"),
        "c" | "h" => Some("c"),
        "cc" | "cpp" | "cxx" | "hpp" => Some("cpp"),
        "cs" => Some("csharp"),
        "rb" => Some("ruby"),
        "php" => Some("php"),
        "sh" | "bash" => Some("shell"),
        "lua" => Some("lua"),
        "r" => Some("r"),
        "scala" | "sc" => Some("scala"),
        "ex" | "exs" => Some("elixir"),
        "dart" => Some("dart"),
        "vue" => Some("vue"),
        "svelte" => Some("svelte"),
        _ => None,
    }
}

fn detect_languages(root: &Path) -> Vec<String> {
    let mut langs: BTreeSet<String> = BTreeSet::new();
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    for (i, entry) in entries.enumerate() {
        if i >= DIR_SCAN_CAP {
            break;
        }
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_file() {
            continue;
        }
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if let Some(lang) = extension_to_language(ext) {
            langs.insert(lang.to_string());
        }
    }
    langs.into_iter().collect()
}

// ── Manifest parsers ──────────────────────────────────────────────────────────
//
// Deliberately minimal — we just regex-grep for the fields we care about.
// Real TOML/JSON parsers are overkill for a 2KB summary and add failure
// modes we don't need. If the file isn't parseable we return an empty
// ManifestInfo (the rest of the scan still works).

fn parse_package_json(s: &str) -> ManifestInfo {
    ManifestInfo {
        name: json_string_field(s, "name"),
        version: json_string_field(s, "version"),
        description: json_string_field(s, "description"),
    }
}

fn json_string_field(s: &str, field: &str) -> Option<String> {
    // Naive scan: look for `"field"\s*:\s*"..."`. Handles escapes via
    // byte-level walk; no Unicode edge cases.
    let needle = format!("\"{field}\"");
    let bytes = s.as_bytes();
    let needle_bytes = needle.as_bytes().to_vec(); // bind lifetime explicitly
    let mut i = 0;
    while i + needle_bytes.len() < bytes.len() {
        if &bytes[i..i + needle_bytes.len()] == needle_bytes.as_slice() {
            // Skip past the key + optional whitespace + colon + optional ws.
            let mut j = i + needle_bytes.len();
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                j += 1;
            }
            if j >= bytes.len() || bytes[j] != b':' {
                i += 1;
                continue;
            }
            j += 1;
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                j += 1;
            }
            if j >= bytes.len() || bytes[j] != b'"' {
                return None;
            }
            j += 1;
            // Walk to closing quote, respecting backslash escapes.
            let start = j;
            while j < bytes.len() {
                match bytes[j] {
                    b'\\' if j + 1 < bytes.len() => j += 2,
                    b'"' => return Some(s[start..j].to_string()),
                    _ => j += 1,
                }
            }
            return None;
        }
        i += 1;
    }
    None
}

fn parse_cargo_toml(s: &str) -> ManifestInfo {
    ManifestInfo {
        name: toml_string_field(s, "name"),
        version: toml_string_field(s, "version"),
        description: toml_string_field(s, "description"),
    }
}

fn toml_string_field(s: &str, field: &str) -> Option<String> {
    // Look for `field = "value"` at start-of-line (whitespace-tolerant).
    // Only matches the first occurrence — sufficient for the [package] section.
    for line in s.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with(field) {
            continue;
        }
        let rest = trimmed[field.len()..].trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        let after_eq = rest[1..].trim_start();
        if !after_eq.starts_with('"') {
            continue;
        }
        // Find closing quote.
        let bytes = after_eq.as_bytes();
        let mut j = 1;
        while j < bytes.len() {
            match bytes[j] {
                b'\\' if j + 1 < bytes.len() => j += 2,
                b'"' => return Some(after_eq[1..j].to_string()),
                _ => j += 1,
            }
        }
        return None;
    }
    None
}

fn parse_pyproject_toml(s: &str) -> ManifestInfo {
    // PEP 621 uses [project] table; Poetry uses [tool.poetry]. We accept either
    // by scanning for either section header then extracting from there.
    let info = toml_string_field(s, "name");
    let version = toml_string_field(s, "version");
    let description = toml_string_field(s, "description");
    ManifestInfo {
        name: info,
        version,
        description,
    }
}

fn parse_go_mod(s: &str) -> ManifestInfo {
    // First non-comment, non-blank line is the module path.
    for line in s.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("//") {
            continue;
        }
        if let Some(rest) = t.strip_prefix("module ") {
            return ManifestInfo {
                name: Some(rest.trim().to_string()),
                version: None,
                description: None,
            };
        }
    }
    ManifestInfo::default()
}

// ── Summary rendering ────────────────────────────────────────────────────────

struct SummaryInputs<'a> {
    name: &'a str,
    version: Option<&'a str>,
    description: Option<&'a str>,
    readme_excerpt: Option<&'a str>,
    languages: &'a [String],
    has_git: bool,
    git_remote: Option<&'a str>,
    project_dir: &'a str,
}

fn render_summary(i: &SummaryInputs<'_>) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", i.name));
    if let Some(v) = i.version {
        out.push_str(&format!("**Version**: {v}\n\n"));
    }
    if let Some(d) = i.description {
        if !d.is_empty() {
            out.push_str(&format!("{d}\n\n"));
        }
    }
    out.push_str(&format!("**Path**: `{}`\n\n", i.project_dir));
    if !i.languages.is_empty() {
        out.push_str(&format!("**Languages**: {}\n\n", i.languages.join(", ")));
    }
    if i.has_git {
        if let Some(r) = i.git_remote {
            out.push_str(&format!("**Git remote**: {r}\n\n"));
        } else {
            out.push_str("**Git**: yes (no remote)\n\n");
        }
    }
    if let Some(readme) = i.readme_excerpt {
        out.push_str("## README excerpt\n\n");
        // First strip leading markdown heading (we already have a title).
        let trimmed = readme.trim_start_matches('#').trim_start();
        out.push_str(trimmed);
        out.push_str("\n");
    }
    truncate_chars(&out, SUMMARY_MAX_BYTES)
}

fn truncate_chars(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Walk back from the limit to a char boundary.
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = s[..end].to_string();
    out.push_str("…\n[truncated]");
    out
}

fn unix_ms_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(dir: &Path, name: &str, body: &str) {
        let p = dir.join(name);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, body).unwrap();
    }

    #[test]
    fn scan_project_errors_on_nonexistent_path() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("does-not-exist");
        let err = scan_project(&p).unwrap_err();
        assert!(err.contains("stat"), "unexpected error: {err}");
    }

    #[test]
    fn scan_project_errors_on_file_not_directory() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("a-file.txt");
        fs::write(&f, "x").unwrap();
        let err = scan_project(&f).unwrap_err();
        assert!(err.contains("not a directory"), "unexpected error: {err}");
    }

    #[test]
    fn scan_empty_directory_returns_minimal_context() {
        let dir = tempdir().unwrap();
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, dir.path().file_name().unwrap().to_str().unwrap());
        assert!(ctx.version.is_none());
        assert!(ctx.description.is_none());
        assert!(ctx.readme_excerpt.is_none());
        assert!(ctx.languages.is_empty());
        assert!(!ctx.has_git);
        assert!(ctx.git_remote.is_none());
        assert!(ctx.files_scanned.is_empty());
        assert!(ctx.summary_markdown.contains("# "));
    }

    #[test]
    fn scan_reads_package_json() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "package.json",
            r#"{
  "name": "demo-app",
  "version": "1.2.3",
  "description": "A demo Node app",
  "scripts": { "test": "vitest" }
}"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, "demo-app");
        assert_eq!(ctx.version.as_deref(), Some("1.2.3"));
        assert_eq!(ctx.description.as_deref(), Some("A demo Node app"));
        assert!(ctx.files_scanned.iter().any(|f| f.ends_with("package.json")));
    }

    #[test]
    fn scan_reads_cargo_toml() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "Cargo.toml",
            r#"[package]
name = "hermes-tray"
version = "0.2.0"
description = "Local-first Hermes chat tray"

[dependencies]
serde = "1"
"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, "hermes-tray");
        assert_eq!(ctx.version.as_deref(), Some("0.2.0"));
        assert_eq!(
            ctx.description.as_deref(),
            Some("Local-first Hermes chat tray")
        );
    }

    #[test]
    fn scan_reads_pyproject_toml() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "pyproject.toml",
            r#"[project]
name = "fiddle-mate"
version = "0.1.0"
description = "Music trainer"
"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, "fiddle-mate");
        assert_eq!(ctx.version.as_deref(), Some("0.1.0"));
    }

    #[test]
    fn scan_reads_go_mod() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "go.mod",
            "// some comment\nmodule github.com/xyshanren/demo\n\ngo 1.22\n",
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, "github.com/xyshanren/demo");
        assert!(ctx.version.is_none());
    }

    #[test]
    fn scan_truncates_long_readme() {
        let dir = tempdir().unwrap();
        let big = "a".repeat(README_MAX_BYTES * 2);
        write(dir.path(), "README.md", &format!("# Big README\n\n{big}"));
        let ctx = scan_project(dir.path()).unwrap();
        let readme = ctx.readme_excerpt.unwrap();
        // Truncated form is base + "…\n[truncated]" (16 ASCII bytes).
        assert!(readme.len() <= README_MAX_BYTES + 20, "len = {}", readme.len());
        assert!(readme.starts_with('#'));
        assert!(readme.contains("truncated"));
    }

    #[test]
    fn scan_detects_languages_from_extensions() {
        let dir = tempdir().unwrap();
        write(dir.path(), "main.rs", "fn main() {}");
        write(dir.path(), "app.ts", "console.log(1)");
        write(dir.path(), "test.py", "print(1)");
        write(dir.path(), "README.md", "# readme");
        let ctx = scan_project(dir.path()).unwrap();
        assert!(ctx.languages.contains(&"rust".to_string()));
        assert!(ctx.languages.contains(&"typescript".to_string()));
        assert!(ctx.languages.contains(&"python".to_string()));
        // README.md is .md — not in our language map, that's fine.
        assert!(!ctx.languages.contains(&"md".to_string()));
    }

    #[test]
    fn scan_detects_git_remote() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            ".git/config",
            r#"[core]
    repositoryformatversion = 0

[remote "origin"]
    url = git@github.com:xyshanren/hermes-tray.git
    fetch = +refs/heads/*:refs/remotes/origin/*
"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert!(ctx.has_git);
        assert_eq!(
            ctx.git_remote.as_deref(),
            Some("git@github.com:xyshanren/hermes-tray.git")
        );
    }

    #[test]
    fn scan_summary_includes_key_sections() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "package.json",
            r#"{"name":"x","version":"0.0.1","description":"hi"}"#,
        );
        write(dir.path(), "main.rs", "fn main() {}");
        write(
            dir.path(),
            ".git/config",
            "[remote \"origin\"]\n    url = git@example.com:x.git\n",
        );
        write(dir.path(), "README.md", "# X\n\nHello world.");
        let ctx = scan_project(dir.path()).unwrap();
        assert!(ctx.summary_markdown.contains("# x"));
        assert!(ctx.summary_markdown.contains("**Version**: 0.0.1"));
        assert!(ctx.summary_markdown.contains("**Path**"));
        assert!(ctx.summary_markdown.contains("**Languages**"));
        assert!(ctx.summary_markdown.contains("rust"));
        assert!(ctx.summary_markdown.contains("README excerpt"));
        assert!(ctx.summary_markdown.contains("Hello world."));
    }

    #[test]
    fn scan_manifest_priority_package_json_first() {
        // If both package.json and Cargo.toml are present, package.json wins.
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "package.json",
            r#"{"name":"from-npm","version":"1.0.0"}"#,
        );
        write(
            dir.path(),
            "Cargo.toml",
            r#"[package]
name = "from-cargo"
version = "0.5.0"
"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        assert_eq!(ctx.name, "from-npm");
        assert_eq!(ctx.version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn scan_survives_malformed_manifest() {
        // Bad JSON in package.json should not block the rest of the scan.
        // The parser returns Some(ManifestInfo::default()) (empty but
        // present), so we don't try Cargo.toml. The dir basename
        // becomes the project name — which is fine: the key property is
        // that the scan didn't error and the README/Cargo.toml would
        // be read if no manifest matched.
        let dir = tempdir().unwrap();
        write(dir.path(), "package.json", "{ this is not json");
        write(
            dir.path(),
            "Cargo.toml",
            r#"[package]
name = "fallback"
version = "0.1.0"
"#,
        );
        let ctx = scan_project(dir.path()).unwrap();
        // name should NOT be "fallback" — package.json takes priority even
        // when unparseable (returns empty ManifestInfo). The scan then
        // falls back to the dir basename.
        let dir_name = dir.path().file_name().unwrap().to_str().unwrap();
        assert_eq!(ctx.name, dir_name);
        // The Cargo.toml file was NOT scanned (priority chain short-circuits).
        assert!(!ctx.files_scanned.iter().any(|f| f.ends_with("Cargo.toml")));
    }

    #[test]
    fn truncate_chars_respects_utf8_boundaries() {
        // 4-byte emoji at the boundary must not be split.
        let s = "abc🎉def";
        // Cut at byte 4 (inside emoji) — must back up to byte 3.
        let t = truncate_chars(s, 4);
        assert!(t.starts_with("abc"));
        assert!(t.contains("truncated"));
    }

    #[test]
    fn json_string_field_handles_escapes() {
        let s = r#"{"name":"a\"b","version":"1.0"}"#;
        assert_eq!(json_string_field(s, "name").as_deref(), Some("a\\\"b"));
        assert_eq!(json_string_field(s, "version").as_deref(), Some("1.0"));
        assert_eq!(json_string_field(s, "missing"), None);
    }
}
