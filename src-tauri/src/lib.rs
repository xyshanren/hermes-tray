use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

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

/// Read wsl_distro from external config.json next to the executable.
fn read_wsl_distro() -> String {
    // Try exe directory first, then current directory
    if let Ok(exe_path) = std::env::current_exe() {
        let config_path = exe_path.with_file_name("config.json");
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(distro) = json.get("wsl_distro").and_then(|v| v.as_str()) {
                        return distro.to_string();
                    }
                }
            }
        }
    }
    // Fallback to current directory config
    if let Ok(content) = std::fs::read_to_string("config.json") {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(distro) = json.get("wsl_distro").and_then(|v| v.as_str()) {
                return distro.to_string();
            }
        }
    }
    "Ubuntu-24.04.4".to_string()
}

/// Detect WSL2 gateway IP and distro name.
/// Distro is configurable via config.json next to the executable.
/// Falls back to hardcoded IP if detection fails.
#[tauri::command]
fn hermes_resolve_gateway_ip() -> GatewayInfo {
    let fallback_ip = "172.31.98.230";
    let fallback_port = "8642";

    let distro = read_wsl_distro();
    let ip = detect_wsl_ip(&distro).unwrap_or_else(|| fallback_ip.to_string());

    GatewayInfo {
        ip: ip.clone(),
        port: fallback_port.to_string(),
        url: format!("http://{}:{}", ip, fallback_port),
        distro: distro.clone(),
    }
}

fn detect_wsl_ip(distro: &str) -> Option<String> {
    use std::process::Command;

    // Primary: try the specified distro
    let output = Command::new("wsl")
        .args(["-d", distro, "bash", "-c", "hostname -I"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(first_ip) = stdout.split_whitespace().next() {
            let ip = first_ip.to_string();
            if ip.contains('.') && !ip.is_empty() {
                return Some(ip);
            }
        }
    }

    // Fallback: try the default WSL distro (no -d flag)
    let output = Command::new("wsl")
        .args(["hostname", "-I"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(first_ip) = stdout.split_whitespace().next() {
            let ip = first_ip.to_string();
            if ip.contains('.') && !ip.is_empty() {
                return Some(ip);
            }
        }
    }

    None
}

// ── Gateway Process Management ──────────────────────────────────────

/// Check if Hermes Gateway is running in the WSL distro.
#[tauri::command]
fn hermes_check_gateway_status(distro: String) -> Result<String, String> {
    let output = std::process::Command::new("wsl")
        .args(["-d", &distro, "pgrep", "-a", "-f", "hermes"])
        .output()
        .map_err(|e| format!("检测失败: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("gateway") {
            Ok("running".to_string())
        } else {
            Ok("stopped".to_string())
        }
    } else {
        Ok("stopped".to_string())
    }
}

/// Start Hermes Gateway in the specified WSL distro.
#[tauri::command]
fn hermes_start_gateway(distro: String) -> Result<String, String> {
    let output = std::process::Command::new("wsl")
        .args([
            "-d",
            &distro,
            "bash",
            "-c",
            "cd ~/.hermes && source hermes-venv/bin/activate && hermes gateway start",
        ])
        .output()
        .map_err(|e| format!("启动命令执行失败: {}", e))?;

    if output.status.success() {
        Ok("Gateway 已启动".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Gateway 启动失败: {}", stderr.trim()))
    }
}

/// Stop Hermes Gateway in the specified WSL distro (graceful → force kill).
#[tauri::command]
fn hermes_stop_gateway(distro: String) -> Result<String, String> {
    // First attempt: graceful kill
    let output = std::process::Command::new("wsl")
        .args([
            "-d",
            &distro,
            "bash",
            "-c",
            "pkill -f 'hermes.*gateway' 2>/dev/null; sleep 1; pgrep -f 'hermes.*gateway' >/dev/null 2>&1",
        ])
        .output()
        .map_err(|e| format!("停止命令执行失败: {}", e))?;

    let still_running = output.status.success();
    if !still_running {
        return Ok("Gateway 已停止".to_string());
    }

    // Force kill fallback
    let output = std::process::Command::new("wsl")
        .args([
            "-d",
            &distro,
            "bash",
            "-c",
            "kill -9 $(pgrep -f 'hermes.*gateway') 2>/dev/null || true",
        ])
        .output()
        .map_err(|e| format!("强制停止失败: {}", e))?;

    if output.status.success() {
        Ok("Gateway 已强制停止".to_string())
    } else {
        Ok("Gateway 可能仍在运行，请手动检查".to_string())
    }
}

/// Quick HTTP health check against the Gateway URL.
#[tauri::command]
async fn hermes_check_gateway_health(url: String) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
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

/// Read config.json next to the executable.
fn read_config_json() -> serde_json::Value {
    let config_paths = [
        std::env::current_exe().ok().map(|p| p.with_file_name("config.json")),
        Some(std::path::PathBuf::from("config.json")),
    ];
    for path in config_paths.into_iter().flatten() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str(&content) {
                return json;
            }
        }
    }
    serde_json::json!({})
}

/// Write config.json next to the executable.
fn write_config_json(config: &serde_json::Value) -> Result<(), String> {
    let path = if let Ok(exe_path) = std::env::current_exe() {
        exe_path.with_file_name("config.json")
    } else {
        std::path::PathBuf::from("config.json")
    };
    let content = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

/// Get current configuration (all fields).
#[tauri::command]
fn hermes_get_config() -> serde_json::Value {
    read_config_json()
}

/// Save configuration fields (merges with existing config).
#[tauri::command]
fn hermes_save_config(updates: serde_json::Value) -> Result<(), String> {
    let mut config = read_config_json();
    if let Some(obj) = updates.as_object() {
        for (k, v) in obj {
            config[k] = v.clone();
        }
    }
    write_config_json(&config)
}

/// Check if WSL is available on the system.
#[tauri::command]
fn hermes_detect_wsl() -> bool {
    std::process::Command::new("wsl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List available WSL distributions.
#[tauri::command]
fn hermes_list_wsl_distros() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("wsl")
        .args(["-l", "-q"])
        .output()
        .map_err(|e| format!("列举 WSL 发行版失败: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let distros: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(distros)
}

/// Search for hermes binary inside the WSL distro.
#[tauri::command]
fn hermes_find_bin(distro: String) -> String {
    let candidates = vec![
        "/root/.local/bin/hermes",
        "/usr/local/bin/hermes",
        "/usr/bin/hermes",
        "/root/.local/bin/hermes.exe",
    ];

    for path in &candidates {
        let output = std::process::Command::new("wsl")
            .args(["-d", &distro, "test", "-f", path])
            .output();
        if let Ok(o) = output {
            if o.status.success() {
                return path.to_string();
            }
        }
    }

    // Fallback: try default WSL (no -d flag)
    for path in &candidates {
        let output = std::process::Command::new("wsl")
            .args(["test", "-f", path])
            .output();
        if let Ok(o) = output {
            if o.status.success() {
                return path.to_string();
            }
        }
    }

    "/root/.local/bin/hermes".to_string()
}

// ── Gateway Management ────────────────────────────────────────────

/// Restart Gateway: stop gracefully → wait → start.
#[tauri::command]
fn hermes_restart_gateway(distro: String) -> Result<String, String> {
    // Graceful stop
    let _ = std::process::Command::new("wsl")
        .args(["-d", &distro, "bash", "-c",
            "pkill -f 'hermes.*gateway' 2>/dev/null || true"])
        .status();

    // Wait for process to fully exit
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Force kill any remaining process
    let _ = std::process::Command::new("wsl")
        .args(["-d", &distro, "bash", "-c",
            "kill -9 $(pgrep -f 'hermes.*gateway') 2>/dev/null || true"])
        .status();

    // Start with nohup (non-blocking)
    let output = std::process::Command::new("wsl")
        .args(["-d", &distro, "bash", "-c",
            "cd ~/.hermes && source hermes-venv/bin/activate && nohup hermes gateway start > /dev/null 2>&1 &"])
        .output()
        .map_err(|e| format!("重启 Gateway 失败: {}", e))?;

    if output.status.success() {
        Ok("Gateway 已重启".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Gateway 重启失败: {}", stderr.trim()))
    }
}

// ── Hermes API Proxy ────────────────────────────────────────────────

#[tauri::command]
async fn hermes_proxy_get(url: String, headers: HashMap<String, String>) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(HermesResponse { ok: status < 400, status, body })
}

#[tauri::command]
async fn hermes_proxy_post(url: String, headers: HashMap<String, String>, body: String) -> Result<HermesResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.body(body).send().await.map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status().as_u16();
    let body_str = resp.text().await.unwrap_or_default();
    Ok(HermesResponse { ok: status < 400, status, body: body_str })
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
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.body(body).send().await.map_err(|e| format!("连接失败: {}", e))?;
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

// ── Application Entry Point ─────────────────────────────────────────

/// 单元测试: 覆盖文件 IO 类纯函数 (config.json 读写 / WSL distro 解析).
///
/// 覆盖策略:
///   - 跳过: 所有 WSL exec / 进程 spawn / HTTP 包装函数 (依赖外部环境, 行为不可重现).
///   - 测试: read_wsl_distro / read_config_json / write_config_json /
///           hermes_get_config / hermes_save_config — 隔离用 tempfile + Mutex.
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

    /// 把 exe dir 的 config.json 交给 `f` 任意读写, 退出时恢复.
    /// CWD 不动.
    fn with_exe_config<F: FnOnce(&Path)>(f: F) {
        let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (cfg, backup) = take_exe_config_path();
        f(&cfg);
        restore_exe_config(&cfg, backup);
    }

    // ─────────────── read_wsl_distro ───────────────

    #[test]
    fn read_wsl_distro_reads_from_cwd_config() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"wsl_distro": "Debian"}"#,
            )
            .unwrap();
            assert_eq!(read_wsl_distro(), "Debian");
        });
    }

    #[test]
    fn read_wsl_distro_reads_arbitrary_string() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"wsl_distro": "Ubuntu-22.04-ARM64"}"#,
            )
            .unwrap();
            assert_eq!(read_wsl_distro(), "Ubuntu-22.04-ARM64");
        });
    }

    #[test]
    fn read_wsl_distro_returns_default_when_no_file() {
        with_isolated_cwd(|_dir| {
            assert_eq!(read_wsl_distro(), "Ubuntu-24.04.4");
        });
    }

    #[test]
    fn read_wsl_distro_returns_default_when_json_invalid() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "not json {{{ broken").unwrap();
            assert_eq!(read_wsl_distro(), "Ubuntu-24.04.4");
        });
    }

    #[test]
    fn read_wsl_distro_returns_default_when_distro_key_missing() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"other_key": "value", "port": 8642}"#,
            )
            .unwrap();
            assert_eq!(read_wsl_distro(), "Ubuntu-24.04.4");
        });
    }

    #[test]
    fn read_wsl_distro_returns_default_for_empty_object() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "{}").unwrap();
            assert_eq!(read_wsl_distro(), "Ubuntu-24.04.4");
        });
    }

    #[test]
    fn read_wsl_distro_ignores_non_string_distro_value() {
        with_isolated_cwd(|dir| {
            // wsl_distro 不是 string → as_str() 返回 None → 用默认值
            std::fs::write(
                dir.join("config.json"),
                r#"{"wsl_distro": 42}"#,
            )
            .unwrap();
            assert_eq!(read_wsl_distro(), "Ubuntu-24.04.4");
        });
    }

    #[test]
    fn read_wsl_distro_prefers_exe_dir_over_cwd() {
        let _guard = IO_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let original_cwd = std::env::current_dir().expect("current_dir");
        let (cfg, backup) = take_exe_config_path();
        let tmp = tempfile::tempdir().expect("tempdir");
        std::env::set_current_dir(tmp.path()).expect("set_current_dir");
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{"wsl_distro": "CwdDistro"}"#,
        )
        .unwrap();
        std::fs::write(&cfg, r#"{"wsl_distro": "ExeDistro"}"#).unwrap();

        let result = read_wsl_distro();

        let _ = std::env::set_current_dir(&original_cwd);
        restore_exe_config(&cfg, backup);

        assert_eq!(result, "ExeDistro");
    }

    // ─────────────── read_config_json ───────────────

    #[test]
    fn read_config_json_returns_parsed_object() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"a": 1, "b": "two", "nested": {"k": "v"}}"#,
            )
            .unwrap();
            let v = read_config_json();
            assert_eq!(v["a"], 1);
            assert_eq!(v["b"], "two");
            assert_eq!(v["nested"]["k"], "v");
        });
    }

    #[test]
    fn read_config_json_returns_empty_on_missing_file() {
        with_isolated_cwd(|_dir| {
            let v = read_config_json();
            assert_eq!(v, serde_json::json!({}));
            assert!(v.is_object());
        });
    }

    #[test]
    fn read_config_json_returns_empty_on_invalid_json() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "garbage ::: not json").unwrap();
            let v = read_config_json();
            assert_eq!(v, serde_json::json!({}));
        });
    }

    #[test]
    fn read_config_json_returns_empty_object_when_file_is_empty() {
        with_isolated_cwd(|dir| {
            std::fs::write(dir.join("config.json"), "").unwrap();
            let v = read_config_json();
            assert_eq!(v, serde_json::json!({}));
        });
    }

    // ─────────────── write_config_json ───────────────

    #[test]
    fn write_config_json_creates_file_with_expected_content() {
        with_exe_config(|cfg| {
            let v = serde_json::json!({"wsl_distro": "WriteDistro", "port": 8642});
            write_config_json(&v).expect("write");
            assert!(cfg.exists(), "config.json 应该在 exe 目录创建");

            let content = std::fs::read_to_string(cfg).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
            assert_eq!(parsed["wsl_distro"], "WriteDistro");
            assert_eq!(parsed["port"], 8642);
        });
    }

    #[test]
    fn write_config_json_overwrites_previous_content() {
        with_exe_config(|cfg| {
            write_config_json(&serde_json::json!({"a": 1, "old": true})).unwrap();
            write_config_json(&serde_json::json!({"b": 2})).unwrap();
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert!(parsed.get("a").is_none(), "旧 key a 应该消失");
            assert!(parsed.get("old").is_none(), "旧 key old 应该消失");
            assert_eq!(parsed["b"], 2);
        });
    }

    #[test]
    fn write_config_json_writes_pretty_printed_json() {
        with_exe_config(|cfg| {
            write_config_json(&serde_json::json!({"x": 1})).unwrap();
            let content = std::fs::read_to_string(cfg).unwrap();
            // pretty 格式应该带换行/缩进
            assert!(content.contains('\n'), "pretty 格式应包含换行");
            assert!(
                content.contains("  \"x\""),
                "pretty 格式应包含缩进的 key: got={}",
                content
            );
        });
    }

    // ─────────────── hermes_get_config ───────────────

    #[test]
    fn hermes_get_config_returns_parsed_object() {
        with_isolated_cwd(|dir| {
            std::fs::write(
                dir.join("config.json"),
                r#"{"wsl_distro": "FromGet"}"#,
            )
            .unwrap();
            let v = hermes_get_config();
            assert_eq!(v["wsl_distro"], "FromGet");
        });
    }

    #[test]
    fn hermes_get_config_returns_empty_when_no_file() {
        with_isolated_cwd(|_dir| {
            let v = hermes_get_config();
            assert_eq!(v, serde_json::json!({}));
        });
    }

    // ─────────────── hermes_save_config ───────────────

    #[test]
    fn hermes_save_config_writes_when_no_existing() {
        with_exe_config(|cfg| {
            // 起始无文件 (with_exe_config 已清空)
            assert!(!cfg.exists());
            hermes_save_config(serde_json::json!({"wsl_distro": "SaveDistro"}))
                .expect("save");
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "SaveDistro");
        });
    }

    #[test]
    fn hermes_save_config_merges_with_existing_keys() {
        with_exe_config(|cfg| {
            // 预置已有 config
            write_config_json(&serde_json::json!({
                "wsl_distro": "Initial",
                "port": 1234,
            }))
            .unwrap();

            hermes_save_config(serde_json::json!({"wsl_distro": "Updated"})).unwrap();

            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "Updated");
            assert_eq!(parsed["port"], 1234, "未触碰的 key 应保留");
        });
    }

    #[test]
    fn hermes_save_config_adds_new_keys() {
        with_exe_config(|cfg| {
            write_config_json(&serde_json::json!({"a": 1})).unwrap();

            hermes_save_config(serde_json::json!({"b": 2, "c": "three"})).unwrap();

            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert_eq!(parsed["a"], 1, "旧 key 保留");
            assert_eq!(parsed["b"], 2, "新 key b 写入");
            assert_eq!(parsed["c"], "three", "新 key c 写入");
        });
    }

    #[test]
    fn hermes_save_config_empty_updates_preserves_existing() {
        with_exe_config(|cfg| {
            write_config_json(&serde_json::json!({"wsl_distro": "Initial", "port": 1234}))
                .unwrap();
            hermes_save_config(serde_json::json!({})).unwrap();
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert_eq!(parsed["wsl_distro"], "Initial");
            assert_eq!(parsed["port"], 1234);
        });
    }

    #[test]
    fn hermes_save_config_non_object_updates_is_noop_merge() {
        // 更新不是 object (比如 array / string) → 走 if let Some(obj) 失败,
        // 结果只回写原 config (即空对象), 不报错.
        with_exe_config(|cfg| {
            assert!(!cfg.exists());
            let result = hermes_save_config(serde_json::json!([1, 2, 3]));
            assert!(result.is_ok(), "非 object 更新不应该报错");
            // 没有现成 config 时, 写一个空对象
            let parsed: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(cfg).unwrap()).unwrap();
            assert_eq!(parsed, serde_json::json!({}));
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
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

            // Resolve distro once at startup for tray menu use
            let distro = read_wsl_distro();

            // Build tray menu
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let start_gw = MenuItemBuilder::with_id("start_gateway", "启动 Gateway").build(app)?;
            let stop_gw = MenuItemBuilder::with_id("stop_gateway", "停止 Gateway").build(app)?;
            let restart_gw = MenuItemBuilder::with_id("restart_gateway", "重启 Gateway").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&start_gw)
                .item(&stop_gw)
                .item(&restart_gw)
                .separator()
                .item(&quit_item)
                .build()?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Hermes Tray - Hermes 助手")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "start_gateway" => {
                            let d = distro.clone();
                            let result = std::process::Command::new("wsl")
                                .args([
                                    "-d",
                                    &d,
                                    "bash",
                                    "-c",
                                    "cd ~/.hermes && source hermes-venv/bin/activate && nohup hermes gateway start > /dev/null 2>&1 &",
                                ])
                                .spawn();
                            match result {
                                Ok(_) => {
                                    let _ = app.emit("gateway-notification", serde_json::json!({
                                        "type": "success",
                                        "title": "Gateway 已启动",
                                        "message": "Hermes Gateway 启动成功"
                                    }));
                                }
                                Err(e) => {
                                    let _ = app.emit("gateway-notification", serde_json::json!({
                                        "type": "error",
                                        "title": "启动失败",
                                        "message": format!("Gateway 启动失败: {}", e)
                                    }));
                                }
                            }
                        }
                        "stop_gateway" => {
                            let d = distro.clone();
                            // First try graceful stop
                            let _ = std::process::Command::new("wsl")
                                .args(["-d", &d, "bash", "-c",
                                    "pkill -f 'hermes.*gateway' 2>/dev/null || true"])
                                .status();
                            // Force kill fallback
                            let _ = std::process::Command::new("wsl")
                                .args(["-d", &d, "bash", "-c",
                                    "kill -9 $(pgrep -f 'hermes.*gateway') 2>/dev/null || true"])
                                .status();
                            let _ = app.emit("gateway-notification", serde_json::json!({
                                "type": "info",
                                "title": "Gateway 已停止",
                                "message": "Hermes Gateway 已停止"
                            }));
                        }
                        "restart_gateway" => {
                            let d = distro.clone();
                            let result = hermes_restart_gateway(d);
                            match result {
                                Ok(msg) => {
                                    let _ = app.emit("gateway-notification", serde_json::json!({
                                        "type": "success",
                                        "title": "Gateway 已重启",
                                        "message": msg
                                    }));
                                }
                                Err(e) => {
                                    let _ = app.emit("gateway-notification", serde_json::json!({
                                        "type": "error",
                                        "title": "重启失败",
                                        "message": e
                                    }));
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
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
            // S1 — Gateway commands
            hermes_check_gateway_status,
            hermes_start_gateway,
            hermes_stop_gateway,
            hermes_check_gateway_health,
            // S2 — WSL detection & Gateway management
            hermes_detect_wsl,
            hermes_list_wsl_distros,
            hermes_find_bin,
            hermes_restart_gateway,
            // S3 — Config commands
            hermes_get_config,
            hermes_save_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
