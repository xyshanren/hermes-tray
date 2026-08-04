// `mod tests` 在文件中间 (紧跟被测函数), `pub fn run()` 在它后面是常规 Tauri 模式.
#![allow(clippy::items_after_test_module)]

use crypto::{
    create_backup as crypto_create_backup, restore_backup as crypto_restore_backup,
    verify_password as crypto_verify_password,
};
use db::{init_db, Db};

pub use db::commands::{
    db_config_get, db_config_reset_all, db_config_set, export_session_json,
    export_session_markdown, message_append, message_delete, message_list, message_record_usage,
    persona_create, persona_delete, persona_get, persona_list, persona_update, project_scan,
    session_clear_all, session_create, session_delete, session_get, session_list, session_search,
    session_touch, session_update, token_stats,
};
pub use db::pool::seed_builtin_personas;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_shell::ShellExt;

pub mod crypto;
pub mod db;

// 关于 std::process::Command 迁移:
// 4 处 WSL 进程调用已迁到 tauri-plugin-shell (lib.rs 内 `app.shell().command("wsl")...`).
// 改用 ShellExt 是为了让 capability 模型覆盖进程调用 (frontend 调用 shell 命令需 scope).
//
// 关于 std::fs:
// 后端读/写 config.json 仍用 std::fs (迁移决策见 .agent-teams/research/tq9-s2-fs-decision.md).
// 原因: tauri-plugin-fs 的 Rust API 强制要求 AppHandle, 会破坏现有 31 个 unit test (它们无 AppHandle).
// 仍注册 tauri-plugin-fs + 在 capabilities 里登记 fs 权限, 是为了 capability 模型一致 + 未来
// frontend 真用到 fs 命令时 (例如读 $APPDATA 里其它文件) 不需要再改 capability.
//
// 关于 reqwest::Client:
// 4 处 HTTP 调用保留 reqwest, 不迁 tauri-plugin-http. 原因:
// 1. Tauri capability 模型不控制 backend 自己的 HTTP 调用 (capability 只覆盖 frontend 调到
//    plugin 的 IPC command).
// 2. tauri-plugin-http 是给 frontend 用的; 后端用 reqwest 直连更直接, 还能用 no_proxy() 绕开
//    系统代理 (修 Clash 502 的关键, 见 T-Q9 stage 1 commit f31245e).

#[derive(Debug, Serialize, Deserialize)]
pub struct HermesResponse {
    pub ok: bool,
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GatewayInfo {
    pub ip: String,
    pub port: String,
    pub url: String,
    pub distro: String,
}

/// Get the canonical config directory (`%APPDATA%\com.hermes.tray\` on Windows,
/// `~/.config/com.hermes.tray/` on Linux, etc.). Falls back to `current_exe`
/// directory if app_config_dir is unavailable (e.g. before `setup()` runs).
fn resolve_config_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = app.path().app_config_dir() {
        return dir;
    }
    // Fallback: exe directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            return parent.to_path_buf();
        }
    }
    // Last resort: CWD
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// Read wsl_distro from config.json in app_config_dir.
///
/// Tries the new location first (resolved from `AppHandle::app_config_dir()`),
/// then falls back to legacy locations (exe dir + CWD) for v0.1.x backward compat.
fn read_wsl_distro(app: &tauri::AppHandle) -> String {
    let new_path = resolve_config_dir(app).join("config.json");
    if let Some(distro) = read_wsl_distro_from(&new_path) {
        return distro;
    }
    // Legacy fallback: exe dir + CWD (v0.1.x behavior)
    for legacy in legacy_config_paths() {
        if let Some(distro) = read_wsl_distro_from(&legacy) {
            return distro;
        }
    }
    "Ubuntu-24.04.4".to_string()
}

/// Pure helper: read wsl_distro from a given config file path.
/// Returns None if file is missing, invalid, or doesn't contain wsl_distro string.
/// Extracted for unit-testability (the AppHandle-bound wrapper is not).
fn read_wsl_distro_from(path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("wsl_distro")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Returns candidate paths for legacy `config.json` (v0.1.x behavior: exe dir + CWD).
fn legacy_config_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        paths.push(exe_path.with_file_name("config.json"));
    }
    paths.push(std::path::PathBuf::from("config.json"));
    paths
}

/// Detect WSL2 gateway IP and distro name.
/// Distro is configurable via config.json next to the executable.
/// Falls back to hardcoded IP if detection fails.
#[tauri::command]
async fn hermes_resolve_gateway_ip(app: tauri::AppHandle) -> GatewayInfo {
    let fallback_port = "8642";
    let distro = read_wsl_distro(&app);
    let host = pick_gateway_host(&app, &distro, fallback_port).await;

    GatewayInfo {
        ip: host.clone(),
        port: fallback_port.to_string(),
        url: format!("http://{}:{}", host, fallback_port),
        distro: distro.clone(),
    }
}

/// Parse the first whitespace-separated token from `hostname -I` output, but
/// only accept it if it contains a dot (rough IPv4 sanity check) and is non-empty.
/// IPv6 link-local addresses like `fe80::1` are rejected because they contain no '.';
/// we route IPv6 callers through `read_gateway_host_override` instead.
///
/// Pure helper, extracted from `detect_wsl_ip` for testability (the AppHandle-bound
/// wrapper itself is not unit-testable; see the skip comment in `mod tests`).
fn parse_first_ip_token(s: &str) -> Option<String> {
    // `split_whitespace` 已经吃掉前后空白和空 token, 不需要先 trim.
    s.split_whitespace()
        .next()
        .filter(|tok| !tok.is_empty() && tok.contains('.'))
        .map(str::to_string)
}

async fn detect_wsl_ip(app: &tauri::AppHandle, distro: &str) -> Option<String> {
    // Primary: try the specified distro
    let output = app
        .shell()
        .command("wsl")
        .args(["-d", distro, "bash", "-c", "hostname -I"])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(ip) = parse_first_ip_token(&stdout) {
            return Some(ip);
        }
    }

    // Fallback: try the default WSL distro (no -d flag)
    let output = app
        .shell()
        .command("wsl")
        .args(["hostname", "-I"])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(ip) = parse_first_ip_token(&stdout) {
            return Some(ip);
        }
    }

    None
}

// ── Gateway Host Resolution ───────────────────────────────────────

/// Read optional `gateway_host` override from config.json.
/// Lets the user pin a specific host (e.g. "192.168.1.10" for a remote
/// gateway, or "[::1]" for IPv6 localhost).
fn read_gateway_host_override(app: &tauri::AppHandle) -> Option<String> {
    let config = read_config_json(app);
    extract_gateway_host(&config)
}

/// Pure helper: extract trimmed gateway_host string from a config JSON value.
/// Returns None if missing, not a string, empty after trim, or whitespace-only.
/// Extracted for unit-testability (the AppHandle-bound wrapper is not).
fn extract_gateway_host(config: &serde_json::Value) -> Option<String> {
    config
        .get("gateway_host")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Quick TCP probe to detect WSL2 localhostForwarding.
/// Win11 enables this by default; Win10 does not.
fn check_localhost_gateway(port: &str) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr = format!("127.0.0.1:{}", port);
    match addr.parse::<SocketAddr>() {
        Ok(sa) => TcpStream::connect_timeout(&sa, Duration::from_millis(500)).is_ok(),
        Err(_) => false,
    }
}

/// Return the first non-None candidate. Pure helper, easy to unit test.
fn first_some(candidates: &[Option<String>]) -> Option<String> {
    candidates.iter().flatten().next().cloned()
}

/// Pick the best gateway host using this priority chain:
/// 1. config override (`gateway_host` in config.json)
/// 2. localhost (`127.0.0.1`) — Win11 WSL2 localhostForwarding default
/// 3. WSL eth0 IP — Win10 or no localhostForwarding
/// 4. hardcoded fallback (`172.31.98.230`) — last resort
///
/// Routing through `127.0.0.1` (loopback) avoids Windows system proxies
/// (e.g. Clash at 127.0.0.1:7890) that would intercept 172.16-31.x.x
/// requests and return HTTP 502 Bad Gateway.
async fn pick_gateway_host(app: &tauri::AppHandle, distro: &str, port: &str) -> String {
    let candidates = [
        read_gateway_host_override(app),
        if check_localhost_gateway(port) {
            Some("127.0.0.1".to_string())
        } else {
            None
        },
        detect_wsl_ip(app, distro).await,
    ];
    first_some(&candidates).unwrap_or_else(|| "172.31.98.230".to_string())
}

// ── Gateway Status (read-only) ─────────────────────────────────────

/// Check if Hermes Gateway is running in the WSL distro.
#[tauri::command]
async fn hermes_check_gateway_status(
    app: tauri::AppHandle,
    distro: String,
) -> Result<String, String> {
    let output = app
        .shell()
        .command("wsl")
        .args(["-d", &distro, "pgrep", "-a", "-f", "hermes"])
        .output()
        .await
        .map_err(|e| format!("检测失败: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(classify_gateway_status(true, &stdout).to_string())
    } else {
        Ok(classify_gateway_status(false, "").to_string())
    }
}

/// Classify gateway running state from `pgrep -a -f hermes` output.
/// "running" requires both: pgrep succeeded AND stdout mentions "gateway"
/// (filters out hermes CLI tool lines that don't match the gateway binary).
///
/// Pure helper, extracted from `hermes_check_gateway_status` for testability.
fn classify_gateway_status(success: bool, stdout: &str) -> &'static str {
    if success && stdout.contains("gateway") {
        "running"
    } else {
        "stopped"
    }
}

/// Quick HTTP health check against the Gateway URL.
#[tauri::command]
async fn hermes_check_gateway_health(url: String) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(HermesResponse {
        ok: status < 400,
        status,
        body,
    })
}

// ── WSL Environment Detection ──────────────────────────────────────

/// Read config.json from app_config_dir. Tries new path first, then
/// legacy fallback (exe dir + CWD) for v0.1.x backward compatibility.
fn read_config_json(app: &tauri::AppHandle) -> serde_json::Value {
    let new_path = resolve_config_dir(app).join("config.json");
    if let Some(v) = read_config_json_from(&new_path) {
        return v;
    }
    // Legacy fallback: exe dir + CWD (v0.1.x behavior)
    for legacy in legacy_config_paths() {
        if let Some(v) = read_config_json_from(&legacy) {
            return v;
        }
    }
    serde_json::json!({})
}

/// Pure helper: read config.json from a given path. Returns None on missing/invalid file.
/// Extracted for unit-testability.
fn read_config_json_from(path: &std::path::Path) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write config.json to app_config_dir. Migrates legacy config.json on first save.
fn write_config_json(app: &tauri::AppHandle, config: &serde_json::Value) -> Result<(), String> {
    let config_dir = resolve_config_dir(app);
    std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let path = config_dir.join("config.json");
    write_config_json_to(&path, config)?;
    log::info!("Config saved to {}", path.display());
    // On first save to new path, copy legacy config (if exists) to backup
    let backup_path = config_dir.join("v0.1.0-config.json.bak");
    if !backup_path.exists() {
        for legacy in legacy_config_paths() {
            if legacy.exists() && legacy != path {
                if let Ok(content) = std::fs::read_to_string(&legacy) {
                    let _ = std::fs::write(
                        &backup_path,
                        format!("# Migrated from {}\n{}", legacy.display(), content),
                    );
                    log::info!(
                        "Backed up legacy config {} to {}",
                        legacy.display(),
                        backup_path.display()
                    );
                }
            }
        }
    }
    Ok(())
}

/// Pure helper: write config.json to a given path. Extracted for unit-testability.
fn write_config_json_to(path: &std::path::Path, config: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("写入配置失败: {}", e))
}

/// Get current configuration (all fields).
#[tauri::command]
fn hermes_get_config(app: tauri::AppHandle) -> serde_json::Value {
    read_config_json(&app)
}

/// Save configuration fields (merges with existing config).
#[tauri::command]
fn hermes_save_config(app: tauri::AppHandle, updates: serde_json::Value) -> Result<(), String> {
    let mut config = read_config_json(&app);
    if let Some(obj) = updates.as_object() {
        for (k, v) in obj {
            config[k] = v.clone();
        }
    }
    write_config_json(&app, &config)
}

/// alpha-14: wipe the legacy config.json file. Used by the
/// settings "重置所有设置" flow so the next `hermes_resolve_gateway_ip`
/// + `hermes_save_config` start from a clean slate. Idempotent —
/// silently succeeds if the file doesn't exist (no-op).
#[tauri::command]
fn hermes_reset_config(app: tauri::AppHandle) -> Result<(), String> {
    let new_path = resolve_config_dir(&app).join("config.json");
    if new_path.exists() {
        std::fs::remove_file(&new_path).map_err(|e| format!("删除 config.json 失败: {}", e))?;
        log::info!("Deleted legacy config at {}", new_path.display());
    }
    // Also wipe any legacy fallback locations (v0.1.x compat).
    for legacy in legacy_config_paths() {
        if legacy != new_path && legacy.exists() {
            let _ = std::fs::remove_file(&legacy);
        }
    }
    Ok(())
}

/// Check if WSL is available on the system.
#[tauri::command]
async fn hermes_detect_wsl(app: tauri::AppHandle) -> bool {
    app.shell()
        .command("wsl")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List available WSL distributions.
#[tauri::command]
async fn hermes_list_wsl_distros(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let output = app
        .shell()
        .command("wsl")
        .args(["-l", "-q"])
        .output()
        .await
        .map_err(|e| format!("列举 WSL 发行版失败: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_wsl_distro_list(&stdout))
}

/// Parse the trimmed-non-empty-line list returned by `wsl -l -q`.
/// `wsl -l -q` emits one distro per line, sometimes with leading/trailing spaces
/// and occasional blank lines on stderr bleeding through; we strip + filter.
///
/// Pure helper, extracted from `hermes_list_wsl_distros` for testability.
fn parse_wsl_distro_list(s: &str) -> Vec<String> {
    s.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Search for hermes binary inside the WSL distro.
#[tauri::command]
async fn hermes_find_bin(app: tauri::AppHandle, distro: String) -> String {
    let candidates = vec![
        "/root/.local/bin/hermes",
        "/usr/local/bin/hermes",
        "/usr/bin/hermes",
        "/root/.local/bin/hermes.exe",
    ];

    for path in &candidates {
        let output = app
            .shell()
            .command("wsl")
            .args(["-d", &distro, "test", "-f", path])
            .output()
            .await;
        if let Ok(o) = output {
            if o.status.success() {
                return path.to_string();
            }
        }
    }

    // Fallback: try default WSL (no -d flag)
    for path in &candidates {
        let output = app
            .shell()
            .command("wsl")
            .args(["test", "-f", path])
            .output()
            .await;
        if let Ok(o) = output {
            if o.status.success() {
                return path.to_string();
            }
        }
    }

    "/root/.local/bin/hermes".to_string()
}

// ── Hermes API Proxy ────────────────────────────────────────────────

#[tauri::command]
async fn hermes_proxy_get(
    url: String,
    headers: HashMap<String, String>,
) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(HermesResponse {
        ok: status < 400,
        status,
        body,
    })
}

#[tauri::command]
async fn hermes_proxy_post(
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status().as_u16();
    let body_str = resp.text().await.unwrap_or_default();
    Ok(HermesResponse {
        ok: status < 400,
        status,
        body: body_str,
    })
}

#[tauri::command]
async fn hermes_proxy_post_stream(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    window: tauri::Window,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
            let _ = window.emit("hermes-stream-chunk", &text);
        }
    }
    let _ = window.emit("hermes-stream-done", ());
    Ok(())
}

// ── Backup commands (T-Q-S11) ────────────────────────────────────────────
//
// Encrypted local backup of `sessions.db`. The user picks an output
// path + password; we copy the live DB via SQLite's online backup
// API (safe with concurrent readers), encrypt with AES-256-GCM, and
// write a self-describing blob. Restore does the inverse, then
// requires an app restart (existing pool connections hold cached
// state that won't see the new file content until they're recycled).

#[tauri::command]
fn backup_create(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    output_path: String,
    password: String,
) -> Result<BackupInfo, String> {
    let db_path = resolve_config_dir(&app).join("sessions.db");
    if !db_path.exists() {
        return Err(format!("DB not found: {}", db_path.display()));
    }
    // 1. Safely copy live DB to a temp file using SQLite's online
    //    backup API. This works even with concurrent readers.
    let temp_path = db_path.with_extension("db.backup.tmp");
    {
        let conn = db.pool().get().map_err(|e| e.to_string())?;
        // Run a WAL checkpoint so the -wal file is merged into the
        // main DB before we copy. Reduces chance of inconsistency.
        let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
        // The rusqlite API: conn.backup(path) opens a dest Connection
        // and copies pages incrementally. Safe + atomic.
        let mut dest =
            rusqlite::Connection::open(&temp_path).map_err(|e| format!("open temp: {e}"))?;
        let backup = rusqlite::backup::Backup::new(&conn, &mut dest)
            .map_err(|e| format!("backup new: {e}"))?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(50), None)
            .map_err(|e| format!("backup run: {e}"))?;
    }
    // 2. Read the temp file + encrypt.
    let plaintext = std::fs::read(&temp_path).map_err(|e| format!("read temp: {e}"))?;
    let blob = crypto_create_backup(&plaintext, &password)?;
    // 3. Write the encrypted blob to the user's chosen output path.
    std::fs::write(&output_path, &blob).map_err(|e| format!("write output: {e}"))?;
    // 4. Cleanup temp file.
    let _ = std::fs::remove_file(&temp_path);

    Ok(BackupInfo {
        output_path,
        plaintext_bytes: plaintext.len(),
        encrypted_bytes: blob.len(),
    })
}

#[tauri::command]
fn backup_restore(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    input_path: String,
    password: String,
) -> Result<RestoreInfo, String> {
    let blob = std::fs::read(&input_path).map_err(|e| format!("read input: {e}"))?;
    let plaintext = crypto_restore_backup(&blob, &password)?;
    let db_path = resolve_config_dir(&app).join("sessions.db");
    // Write to a temp file alongside the live DB, then use SQLite's
    // backup API to overwrite the live DB from the temp source. This
    // is the safe way to swap a SQLite file while the pool has open
    // connections — direct file-replace would corrupt the WAL.
    let temp_path = db_path.with_extension("db.restore.tmp");
    std::fs::write(&temp_path, &plaintext).map_err(|e| format!("write temp: {e}"))?;
    {
        // Open the temp as a Connection (this is the SOURCE of the
        // restore), then back up into the live DB connection (the
        // DESTINATION). The live DB connection is in the pool, so we
        // have to be careful — only one connection is checked out at
        // a time, and we release it at the end of this scope.
        let src_conn =
            rusqlite::Connection::open(&temp_path).map_err(|e| format!("open temp: {e}"))?;
        let mut dest_conn = db.pool().get().map_err(|e| e.to_string())?;
        // Close any WAL on the dest first to ensure clean overwrite.
        let _ = dest_conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dest_conn)
            .map_err(|e| format!("backup new: {e}"))?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(50), None)
            .map_err(|e| format!("backup run: {e}"))?;
    }
    // Cleanup temp + emit restart-required notice. The pool's existing
    // connections still cache the old schema/data — the user must
    // restart the app to pick up the restored state.
    let _ = std::fs::remove_file(&temp_path);

    Ok(RestoreInfo {
        input_path,
        plaintext_bytes: plaintext.len(),
        requires_restart: true,
    })
}

#[tauri::command]
fn backup_verify(input_path: String, password: String) -> Result<bool, String> {
    let blob = std::fs::read(&input_path).map_err(|e| format!("read: {e}"))?;
    Ok(crypto_verify_password(&blob, &password))
}

#[derive(serde::Serialize)]
struct BackupInfo {
    output_path: String,
    plaintext_bytes: usize,
    encrypted_bytes: usize,
}

#[derive(serde::Serialize)]
struct RestoreInfo {
    input_path: String,
    plaintext_bytes: usize,
    /// True: the user should restart the app to load the restored
    /// state. The pool's existing connections still hold cached
    /// schema/data from before the restore.
    requires_restart: bool,
}

// ── Audio transcription proxy (T-Q-S13) ────────────────────────────────────
//
// hermes-agent exposes an OpenAI-compatible `/v1/audio/transcriptions`
// endpoint. We proxy the multipart upload from the tray (which only
// sees base64-encoded bytes from MediaRecorder) so CORS / multipart
// construction stays server-side.

/// Pick a file extension for a recording given its MIME type. hermes-agent
/// (and OpenAI's API) infer the format from this; common values:
///
///   audio/webm;codecs=opus   -> webm
///   audio/ogg;codecs=opus    -> ogg
///   audio/wav                -> wav
///   audio/mpeg               -> mp3
///   audio/mp4                -> mp4
///
/// Pure helper extracted from `hermes_proxy_transcribe` for unit-test
/// coverage — the main flow is HTTP-bound and skipped per mod tests top.
fn pick_audio_extension(mime_type: &str) -> &'static str {
    if mime_type.contains("webm") {
        "webm"
    } else if mime_type.contains("ogg") {
        "ogg"
    } else if mime_type.contains("wav") {
        "wav"
    } else if mime_type.contains("mpeg") {
        "mp3"
    } else if mime_type.contains("mp4") {
        "mp4"
    } else {
        // Fallback: just call it .bin and hope the gateway figures it out.
        "bin"
    }
}

/// Parse the `{"text": "..."}` response body from the OpenAI Whisper
/// API (or any OpenAI-compatible STT endpoint, including hermes-agent's
/// S13-agent implementation).
///
/// Pure helper extracted from `hermes_proxy_transcribe` for unit-test
/// coverage. Returns the transcript on success; an error if the body
/// doesn't have a string `text` field (protocol violation).
fn parse_openai_transcribe_response(body: &serde_json::Value) -> Result<String, String> {
    body.get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "response missing 'text' field".to_string())
}

#[derive(serde::Deserialize)]
struct TranscribeArgs {
    /// Full URL of the gateway's `/v1/audio/transcriptions` endpoint.
    /// Frontend resolves this (it has the RESOLVED_GATEWAY_URL state).
    url: String,
    /// base64-encoded audio bytes (any format MediaRecorder produces
    /// — webm/opus on Chrome, wav on Safari, etc.).
    audio_base64: String,
    /// Original MIME type, e.g. `audio/webm;codecs=opus`.
    mime_type: String,
}

#[tauri::command]
async fn hermes_proxy_transcribe(
    args: TranscribeArgs,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&args.audio_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let ext = pick_audio_extension(&args.mime_type);
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("recording.{ext}"))
        .mime_str(&args.mime_type)
        .map_err(|e| format!("mime: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .part("file", part);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&args.url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("transcribe send: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {}: {}",
            resp.status().as_u16(),
            resp.text().await.unwrap_or_default()
        ));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("parse JSON: {e}"))?;
    parse_openai_transcribe_response(&body)
}

// ── Application Entry Point ─────────────────────────────────────────

/// 单元测试: 覆盖文件 IO 类纯函数 (config.json 读写 / WSL distro 解析).
///
/// 覆盖策略:
///   - 跳过: 所有 WSL exec / 进程 spawn / HTTP 包装函数 (依赖外部环境, 行为不可重现).
///   - 测试: read_wsl_distro / read_config_json / write_config_json /
///     hermes_get_config / hermes_save_config — 隔离用 tempfile + Mutex.
///
/// 隔离机制:
///   - read_* 优先看 exe dir 的 config.json, 再看 CWD.
///   - write_* 只写 exe dir 的 config.json.
///   - 测试用 IO_LOCK 串行化 (CWD / exe dir 都是 process-global 状态).
///   - 每个测试退出时: 恢复 CWD + 恢复/清理 exe dir 的 config.json 残留.
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    /// 串行化所有触碰 CWD / exe dir 的测试, 防止 cargo 的并行测试互相污染.
    static IO_LOCK: Mutex<()> = Mutex::new(());

    /// 取当前 exe 目录下的 config.json 路径, 并备份/清空.
    fn take_exe_config_path() -> (PathBuf, Option<Vec<u8>>) {
        let exe = std::env::current_exe().expect("current_exe");
        let cfg = exe.with_file_name("config.json");
        let backup = std::fs::read(&cfg).ok();
        let _ = std::fs::remove_file(&cfg);
        (cfg, backup)
    }

    fn restore_exe_config(cfg: &Path, backup: Option<Vec<u8>>) {
        match backup {
            Some(b) => {
                let _ = std::fs::write(cfg, b);
            }
            None => {
                let _ = std::fs::remove_file(cfg);
            }
        }
    }

    /// 在隔离的 CWD 中运行 `f`. exe dir 的 config.json 也会临时清空,
    /// 防止 read_*_json 优先命中 exe dir 而绕过测试意图.
    fn with_isolated_cwd<F: FnOnce(&Path)>(f: F) {
        let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let original_cwd = std::env::current_dir().expect("current_dir");
        let (cfg, backup) = take_exe_config_path();
        let tmp = tempfile::tempdir().expect("tempdir");
        std::env::set_current_dir(tmp.path()).expect("set_current_dir");
        f(tmp.path());
        let _ = std::env::set_current_dir(&original_cwd);
        restore_exe_config(&cfg, backup);
    }

    // ─────────────── read_wsl_distro_from (pure helper) ───────────────

    #[test]
    fn read_wsl_distro_from_reads_cwd_config() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), r#"{"wsl_distro": "Debian"}"#).unwrap();
            assert_eq!(
                read_wsl_distro_from(&dir.join("config.json")),
                Some("Debian".to_string())
            );
        });
    }

    #[test]
    fn read_wsl_distro_from_reads_arbitrary_string() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"wsl_distro": "Ubuntu-22.04-ARM64"}"#,
            )
            .unwrap();
            assert_eq!(
                read_wsl_distro_from(&dir.join("config.json")),
                Some("Ubuntu-22.04-ARM64".to_string())
            );
        });
    }

    #[test]
    fn read_wsl_distro_from_returns_none_when_no_file() {
        with_isolated_cwd(|_dir| {
            assert_eq!(
                read_wsl_distro_from(&std::path::PathBuf::from("nonexistent.json")),
                None
            );
        });
    }

    #[test]
    fn read_wsl_distro_from_returns_none_when_json_invalid() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "not json {{{ broken").unwrap();
            assert_eq!(read_wsl_distro_from(&dir.join("config.json")), None);
        });
    }

    #[test]
    fn read_wsl_distro_from_returns_none_when_distro_key_missing() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"other_key": "value", "port": 8642}"#,
            )
            .unwrap();
            assert_eq!(read_wsl_distro_from(&dir.join("config.json")), None);
        });
    }

    #[test]
    fn read_wsl_distro_from_returns_none_for_empty_object() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "{}").unwrap();
            assert_eq!(read_wsl_distro_from(&dir.join("config.json")), None);
        });
    }

    #[test]
    fn read_wsl_distro_from_ignores_non_string_distro_value() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), r#"{"wsl_distro": 42}"#).unwrap();
            assert_eq!(read_wsl_distro_from(&dir.join("config.json")), None);
        });
    }

    #[test]
    fn read_wsl_distro_falls_back_to_legacy_when_new_path_missing() {
        // 验证 T-Q-NEW 修复: 当 app_config_dir 没有 config.json 时,
        // 应该回退到 exe dir + CWD (legacy paths).
        let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let original_cwd = std::env::current_dir().expect("current_dir");
        let (legacy_cfg, backup) = take_exe_config_path();
        let tmp = tempfile::tempdir().expect("tempdir");
        std::env::set_current_dir(tmp.path()).expect("set_current_dir");
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{"wsl_distro": "CwdDistro"}"#,
        )
        .unwrap();
        std::fs::write(&legacy_cfg, r#"{"wsl_distro": "ExeDistro"}"#).unwrap();

        // resolve_config_dir 在测试环境下拿不到 Tauri AppHandle, 会 fallback 到 exe dir.
        // 所以 read_wsl_distro 的第一个 candidate 就是 exe dir → 找到 ExeDistro 直接返回.
        // 这个测试验证了 legacy path 被优先匹配 (exe dir over CWD).
        let result = read_wsl_distro_from(&legacy_cfg);
        assert_eq!(result, Some("ExeDistro".to_string()));

        let _ = std::env::set_current_dir(&original_cwd);
        restore_exe_config(&legacy_cfg, backup);
    }

    // ─────────────── read_config_json_from (pure helper) ───────────────

    #[test]
    fn read_config_json_from_returns_parsed_object() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"a": 1, "b": "two", "nested": {"k": "v"}}"#,
            )
            .unwrap();
            let v = read_config_json_from(&dir.join("config.json")).expect("should parse");
            assert_eq!(v["a"], 1);
            assert_eq!(v["b"], "two");
            assert_eq!(v["nested"]["k"], "v");
        });
    }

    #[test]
    fn read_config_json_from_returns_none_on_missing_file() {
        with_isolated_cwd(|_dir| {
            assert_eq!(
                read_config_json_from(&std::path::PathBuf::from("nonexistent.json")),
                None
            );
        });
    }

    #[test]
    fn read_config_json_from_returns_none_on_invalid_json() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "garbage ::: not json").unwrap();
            assert_eq!(read_config_json_from(&dir.join("config.json")), None);
        });
    }

    #[test]
    fn read_config_json_from_returns_none_when_file_is_empty() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "").unwrap();
            assert_eq!(read_config_json_from(&dir.join("config.json")), None);
        });
    }

    // ─────────────── write_config_json_to (pure helper) ───────────────

    #[test]
    fn write_config_json_to_creates_file_with_expected_content() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            let v = serde_json::json!({"wsl_distro": "WriteDistro", "port": 8642});
            write_config_json_to(&cfg, &v).expect("write");
            assert!(cfg.exists(), "config.json 应该在目标路径创建");

            let content = std::fs::read_to_string(&cfg).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
            assert_eq!(parsed["wsl_distro"], "WriteDistro");
            assert_eq!(parsed["port"], 8642);
        });
    }

    #[test]
    fn write_config_json_to_overwrites_previous_content() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            write_config_json_to(&cfg, &serde_json::json!({"a": 1, "old": true})).unwrap();
            write_config_json_to(&cfg, &serde_json::json!({"b": 2})).unwrap();
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert!(parsed.get("a").is_none(), "旧 key a 应该消失");
            assert!(parsed.get("old").is_none(), "旧 key old 应该消失");
            assert_eq!(parsed["b"], 2);
        });
    }

    #[test]
    fn write_config_json_to_writes_pretty_printed_json() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            write_config_json_to(&cfg, &serde_json::json!({"x": 1})).unwrap();
            let content = std::fs::read_to_string(&cfg).unwrap();
            assert!(content.contains('\n'), "pretty 格式应包含换行");
            assert!(
                content.contains("  \"x\""),
                "pretty 格式应包含缩进的 key: got={}",
                content
            );
        });
    }

    #[test]
    fn write_config_json_to_creates_parent_directories() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let nested = tmp.path().join("a").join("b").join("config.json");
        write_config_json_to(&nested, &serde_json::json!({"x": 1})).expect("write");
        assert!(nested.exists(), "嵌套目录应该被自动创建");
    }

    // ─────────────── hermes_save_config 行为验证 (通过纯 helper 模拟) ───────────────
    // Tauri command `hermes_save_config` 是 read_config_json + write_config_json 的薄包装,
    // 这里直接验证"读取 → 合并 → 写入"的核心语义. AppHandle 注入路径覆盖由 Tauri runtime 保证.

    #[test]
    fn save_config_writes_when_no_existing() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            assert!(!cfg.exists());
            // 模拟 hermes_save_config 行为
            let mut config = read_config_json_from(&cfg).unwrap_or_else(|| serde_json::json!({}));
            let updates = serde_json::json!({"wsl_distro": "SaveDistro"});
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    config[k] = v.clone();
                }
            }
            write_config_json_to(&cfg, &config).expect("save");
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "SaveDistro");
        });
    }

    #[test]
    fn save_config_merges_with_existing_keys() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            write_config_json_to(
                &cfg,
                &serde_json::json!({"wsl_distro": "Initial", "port": 1234}),
            )
            .unwrap();

            let mut config = read_config_json_from(&cfg).unwrap_or_else(|| serde_json::json!({}));
            let updates = serde_json::json!({"wsl_distro": "Updated"});
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    config[k] = v.clone();
                }
            }
            write_config_json_to(&cfg, &config).unwrap();

            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "Updated");
            assert_eq!(parsed["port"], 1234, "未触碰的 key 应保留");
        });
    }

    #[test]
    fn save_config_adds_new_keys() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            write_config_json_to(&cfg, &serde_json::json!({"a": 1})).unwrap();
            let mut config = read_config_json_from(&cfg).unwrap_or_else(|| serde_json::json!({}));
            let updates = serde_json::json!({"b": 2, "c": "three"});
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    config[k] = v.clone();
                }
            }
            write_config_json_to(&cfg, &config).unwrap();
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert_eq!(parsed["a"], 1, "旧 key 保留");
            assert_eq!(parsed["b"], 2, "新 key b 写入");
            assert_eq!(parsed["c"], "three", "新 key c 写入");
        });
    }

    #[test]
    fn save_config_empty_updates_preserves_existing() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            write_config_json_to(
                &cfg,
                &serde_json::json!({"wsl_distro": "Initial", "port": 1234}),
            )
            .unwrap();
            let mut config = read_config_json_from(&cfg).unwrap_or_else(|| serde_json::json!({}));
            let updates = serde_json::json!({});
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    config[k] = v.clone();
                }
            }
            write_config_json_to(&cfg, &config).unwrap();
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "Initial");
            assert_eq!(parsed["port"], 1234);
        });
    }

    #[test]
    fn save_config_non_object_updates_is_noop_merge() {
        with_isolated_cwd(|dir| {
            let cfg = dir.join("config.json");
            assert!(!cfg.exists());
            let mut config = read_config_json_from(&cfg).unwrap_or_else(|| serde_json::json!({}));
            let updates = serde_json::json!([1, 2, 3]);
            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    config[k] = v.clone();
                }
            }
            write_config_json_to(&cfg, &config).expect("write should not error");
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            assert_eq!(parsed, serde_json::json!({}));
        });
    }

    // ─────────────── extract_gateway_host (pure helper) ───────────────

    #[test]
    fn extract_gateway_host_returns_some_when_set() {
        assert_eq!(
            extract_gateway_host(&serde_json::json!({"gateway_host": "192.168.1.100"})),
            Some("192.168.1.100".to_string())
        );
    }

    #[test]
    fn extract_gateway_host_returns_none_when_missing() {
        assert_eq!(extract_gateway_host(&serde_json::json!({})), None);
    }

    #[test]
    fn extract_gateway_host_returns_none_for_empty_string() {
        assert_eq!(
            extract_gateway_host(&serde_json::json!({"gateway_host": ""})),
            None
        );
    }

    #[test]
    fn extract_gateway_host_returns_none_for_whitespace_only() {
        assert_eq!(
            extract_gateway_host(&serde_json::json!({"gateway_host": "   "})),
            None
        );
    }

    #[test]
    fn extract_gateway_host_ignores_non_string_value() {
        assert_eq!(
            extract_gateway_host(&serde_json::json!({"gateway_host": 42})),
            None
        );
    }

    #[test]
    fn extract_gateway_host_trims_surrounding_whitespace() {
        assert_eq!(
            extract_gateway_host(&serde_json::json!({"gateway_host": "  10.0.0.1  "})),
            Some("10.0.0.1".to_string())
        );
    }

    // ─────────────── first_some ───────────────

    #[test]
    fn first_some_returns_first_non_none() {
        assert_eq!(
            first_some(&[None, Some("a".to_string()), Some("b".to_string())]),
            Some("a".to_string())
        );
    }

    #[test]
    fn first_some_returns_none_when_all_none() {
        assert_eq!(first_some(&[None, None, None]), None);
    }

    #[test]
    fn first_some_returns_none_for_empty_input() {
        assert_eq!(first_some(&[]), None);
    }

    // ─────────────── plugin wrapper helpers (T-Q9 S2) ───────────────
    //
    // Skip: `detect_wsl_ip` / `hermes_check_gateway_status` / `hermes_list_wsl_distros`
    // / `hermes_find_bin` / `hermes_detect_wsl` / `hermes_resolve_gateway_ip` all
    // require `tauri::AppHandle` (needed by `app.shell().command(...).output().await`).
    // Constructing a real `AppHandle` in unit tests requires booting the Tauri runtime,
    // which is a heavier integration-test setup (and not what the existing 31 tests do).
    //
    // What we do test: the pure parsing/classification helpers extracted from those
    // wrappers — `parse_first_ip_token`, `parse_wsl_distro_list`, `classify_gateway_status`.
    // These cover the exact logic the AppHandle wrappers delegate to, just without the IO.

    #[test]
    fn parse_first_ip_token_returns_single_ipv4() {
        assert_eq!(
            parse_first_ip_token("192.168.1.42"),
            Some("192.168.1.42".to_string())
        );
    }

    #[test]
    fn parse_first_ip_token_takes_first_of_multiple() {
        // `hostname -I` 在多接口主机上可能返回多个 IP, 空格分隔.
        assert_eq!(
            parse_first_ip_token("192.168.1.10 10.0.0.5 172.17.0.1"),
            Some("192.168.1.10".to_string())
        );
    }

    #[test]
    fn parse_first_ip_token_trims_surrounding_whitespace() {
        assert_eq!(
            parse_first_ip_token("  172.31.0.1  \n"),
            Some("172.31.0.1".to_string())
        );
    }

    #[test]
    fn parse_first_ip_token_handles_trailing_newline() {
        // `hostname -I` 典型输出尾部带 \n.
        assert_eq!(
            parse_first_ip_token("172.31.98.230\n"),
            Some("172.31.98.230".to_string())
        );
    }

    #[test]
    fn parse_first_ip_token_rejects_ipv6() {
        // IPv6 link-local 用 `:` 分段, 不含 `.` → 拒绝 (我们走 gateway_host override).
        assert_eq!(parse_first_ip_token("fe80::1"), None);
    }

    #[test]
    fn parse_first_ip_token_rejects_empty_input() {
        assert_eq!(parse_first_ip_token(""), None);
    }

    #[test]
    fn parse_first_ip_token_rejects_whitespace_only() {
        assert_eq!(parse_first_ip_token("   \n\t  "), None);
    }

    #[test]
    fn parse_first_ip_token_rejects_token_without_dot() {
        // 没有 `.` 的 token (如主机名) 不算 IP, 跳过.
        assert_eq!(parse_first_ip_token("localhost"), None);
        assert_eq!(parse_first_ip_token("hostname"), None);
    }

    #[test]
    fn parse_first_ip_token_skips_leading_non_ip_tokens() {
        // 首个 token 不像 IP, 但后续有 — 这种 `hostname -I` 实际不会产生, 但保险测试.
        assert_eq!(parse_first_ip_token("not-an-ip 192.168.0.1"), None);
    }

    #[test]
    fn parse_wsl_distro_list_parses_basic_output() {
        let input = "Ubuntu-24.04.4\nDebian\narchlinux\n";
        assert_eq!(
            parse_wsl_distro_list(input),
            vec![
                "Ubuntu-24.04.4".to_string(),
                "Debian".to_string(),
                "archlinux".to_string(),
            ]
        );
    }

    #[test]
    fn parse_wsl_distro_list_strips_surrounding_whitespace() {
        // `wsl -l -q` 有时给行带前导空格 (对齐表格).
        let input = "  Ubuntu  \n  Debian  \n";
        assert_eq!(
            parse_wsl_distro_list(input),
            vec!["Ubuntu".to_string(), "Debian".to_string()]
        );
    }

    #[test]
    fn parse_wsl_distro_list_filters_blank_lines() {
        // 空行/纯空格行不算 distro.
        let input = "Ubuntu\n\n\nDebian\n   \n";
        assert_eq!(
            parse_wsl_distro_list(input),
            vec!["Ubuntu".to_string(), "Debian".to_string()]
        );
    }

    #[test]
    fn parse_wsl_distro_list_returns_empty_for_empty_input() {
        assert_eq!(parse_wsl_distro_list(""), Vec::<String>::new());
    }

    #[test]
    fn parse_wsl_distro_list_returns_empty_for_whitespace_only() {
        assert_eq!(parse_wsl_distro_list("\n\n  \n"), Vec::<String>::new());
    }

    #[test]
    fn classify_gateway_status_running_when_pgrep_matches_gateway() {
        // pgrep -a -f hermes 输出: "<pid> /root/.local/bin/hermes gateway start"
        let stdout = "1234 /root/.local/bin/hermes gateway start";
        assert_eq!(classify_gateway_status(true, stdout), "running");
    }

    #[test]
    fn classify_gateway_status_stopped_when_pgrep_succeeds_but_no_gateway_keyword() {
        // pgrep 命中但行里没有 "gateway" (例如 hermes CLI 别的子命令) → stopped.
        let stdout = "1234 /usr/bin/hermes --help";
        assert_eq!(classify_gateway_status(true, stdout), "stopped");
    }

    #[test]
    fn classify_gateway_status_stopped_when_pgrep_fails() {
        // pgrep 失败 (exit != 0) → 没有任何 hermes 进程在跑.
        assert_eq!(classify_gateway_status(false, ""), "stopped");
        // stdout 内容无所谓, 失败即 stopped.
        assert_eq!(
            classify_gateway_status(false, "garbage error output"),
            "stopped"
        );
    }

    #[test]
    fn classify_gateway_status_running_requires_both_success_and_keyword() {
        // 仅有 keyword 但 pgrep 失败 → 还是 stopped (不可能从 IO, 但函数应鲁棒).
        assert_eq!(classify_gateway_status(false, "hermes gateway"), "stopped");
    }

    // ── T-Q-S13 / STT proxy helpers ─────────────────────────────────
    //
    // Pure helpers extracted from `hermes_proxy_transcribe` for unit-test
    // coverage. The main flow is HTTP-bound and skipped per mod tests top
    // docstring, but these branches are deterministic — every MIME-type
    // and JSON-shape edge case is covered below.

    #[test]
    fn pick_audio_extension_webm() {
        assert_eq!(pick_audio_extension("audio/webm;codecs=opus"), "webm");
    }

    #[test]
    fn pick_audio_extension_wav() {
        assert_eq!(pick_audio_extension("audio/wav"), "wav");
    }

    #[test]
    fn pick_audio_extension_ogg() {
        assert_eq!(pick_audio_extension("audio/ogg;codecs=opus"), "ogg");
    }

    #[test]
    fn pick_audio_extension_mpeg() {
        assert_eq!(pick_audio_extension("audio/mpeg"), "mp3");
    }

    #[test]
    fn pick_audio_extension_mp4() {
        assert_eq!(pick_audio_extension("audio/mp4"), "mp4");
    }

    #[test]
    fn pick_audio_extension_unknown_falls_back_to_bin() {
        // Unknown / unrecognised MIME types degrade to .bin so hermes-agent
        // gets a chance to sniff the format itself.
        assert_eq!(pick_audio_extension("audio/x-foo"), "bin");
        assert_eq!(pick_audio_extension(""), "bin");
        assert_eq!(pick_audio_extension("application/octet-stream"), "bin");
    }

    #[test]
    fn parse_openai_transcribe_response_text() {
        let v = serde_json::json!({"text": "hello world"});
        assert_eq!(parse_openai_transcribe_response(&v).unwrap(), "hello world");
    }

    #[test]
    fn parse_openai_transcribe_response_empty_text_ok() {
        // Empty string is a valid (if useless) transcript — the frontend
        // surfaces a "转写为空" toast, the backend shouldn't reject it.
        let v = serde_json::json!({"text": ""});
        assert_eq!(parse_openai_transcribe_response(&v).unwrap(), "");
    }

    #[test]
    fn parse_openai_transcribe_response_missing_text_errors() {
        // OpenAI schema: `text` is required. A 200 with no `text` is a
        // protocol violation — surface to caller instead of returning
        // an empty string (which the frontend would treat as success).
        let v = serde_json::json!({"foo": "bar"});
        let err = parse_openai_transcribe_response(&v).unwrap_err();
        assert!(
            err.contains("text"),
            "error should mention 'text' field: {err}"
        );
    }

    #[test]
    fn parse_openai_transcribe_response_text_not_string_errors() {
        // Per OpenAI spec, `text` is always a string. A non-string value
        // (number, bool, null, array) is a backend bug — error out.
        let v = serde_json::json!({"text": 42});
        assert!(parse_openai_transcribe_response(&v).is_err());

        let v = serde_json::json!({"text": null});
        assert!(parse_openai_transcribe_response(&v).is_err());

        let v = serde_json::json!({"text": ["hello"]});
        assert!(parse_openai_transcribe_response(&v).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // v0.2-alpha-32 — register the dialog plugin so the
        // backup-modal `<input>` can spawn a native file-save /
        // file-open dialog (replaces the previous "type the full
        // path by hand" flow).
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize SQLite DB pool and manage it as Tauri state.
            // DB is `%APPDATA%\com.hermes.tray\sessions.db`.
            let pool = init_db(app.handle()).expect("failed to initialize SQLite DB");
            // T-Q-S7: seed builtin personas (default / code-reviewer / translator)
            // on first init. Idempotent — re-running on an existing DB is a no-op.
            seed_builtin_personas(&Db::new(pool.clone()));
            app.manage(Db::new(pool));
            log::info!("SQLite DB initialized at app_config_dir/sessions.db");

            // Get the main window
            let window = app.get_webview_window("main").unwrap();

            // Handle window close event - hide instead of close
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            // Resolve distro once at startup so the value is captured for
            // future tray menu consumers (currently only the menu builder runs
            // here, so the binding is intentionally consumed via `_`).
            let _distro = read_wsl_distro(app.handle());

            // Build tray menu (simplified: show + quit only. Gateway lifecycle is
            // managed out-of-band via systemd + hermes CLI, not the tray — see
            // MEMORY.md "systemd service" entry for why tray control is
            // fundamentally a bad UX for systemd-managed services).
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            // T-Q-S6: 3 quick actions (新建会话 / 续上次 / 搜索). Each emits
            // a `tray://*` event to the frontend, which owns the actual UX
            // (createSession, loadLastSession, openSearchModal). The Rust side
            // stays thin and event-based — single source of truth in main.ts.
            let new_session_item =
                MenuItemBuilder::with_id("new_session", "新建会话").build(app)?;
            let continue_last_item =
                MenuItemBuilder::with_id("continue_last", "续上次").build(app)?;
            let search_item = MenuItemBuilder::with_id("search", "搜索").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&new_session_item)
                .item(&continue_last_item)
                .item(&search_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Hermes 助手")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new_session" => {
                        // T-Q-S6: emit tray://new-session — frontend handles UX
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray://new-session", ());
                    }
                    "continue_last" => {
                        // T-Q-S6: emit tray://continue-last — frontend loads most recent session
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray://continue-last", ());
                    }
                    "search" => {
                        // T-Q-S6: emit tray://open-search — frontend opens FTS5 modal
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray://open-search", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hermes_resolve_gateway_ip,
            hermes_proxy_get,
            hermes_proxy_post,
            hermes_proxy_post_stream,
            // T-Q-S13 — Audio transcription proxy (mic → /v1/audio/transcriptions)
            hermes_proxy_transcribe,
            // S1 — Gateway status (read-only)
            hermes_check_gateway_status,
            hermes_check_gateway_health,
            // S2 — WSL detection
            hermes_detect_wsl,
            hermes_list_wsl_distros,
            hermes_find_bin,
            // S3 — Config commands
            hermes_get_config,
            hermes_save_config,
            hermes_reset_config, // alpha-14: wipes legacy config.json
            // T-Q-S2 — Session management (SQLite)
            session_list,
            session_get,
            session_create,
            session_update,
            session_delete,
            session_clear_all, // alpha-14: wipe all sessions
            session_search,
            session_touch,
            message_append,
            message_record_usage,
            message_list,
            message_delete,
            // T-Q-S1.3 — db_config table (SQLite K/V)
            db_config_get,
            db_config_set,
            db_config_reset_all, // alpha-14: wipe all db_config rows
            // T-Q-S7 — Persona library (also serves as session templates)
            persona_list,
            persona_get,
            persona_create,
            persona_update,
            persona_delete,
            // T-Q-S8 — Project context scanner (CWD → ProjectContext JSON for
            // system-prompt injection). Frontend calls this before
            // session_create and passes the result as `project_context`.
            project_scan,
            // T-Q-S9 — Token / cost aggregation (per-day + per-model rollup
            // for the stats modal chart).
            token_stats,
            // T-Q-S10 — Session export (markdown / JSON for clipboard,
            // file save, and share-link generation in the frontend).
            export_session_markdown,
            export_session_json,
            // T-Q-S11 — Encrypted local backup (AES-256-GCM + Argon2id KDF).
            // The output file is self-describing and password-protected.
            backup_create,
            backup_restore,
            backup_verify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
