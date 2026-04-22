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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            
            // Build tray menu
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let start_gw = MenuItemBuilder::with_id("start_gateway", "启动 Gateway").build(app)?;
            let stop_gw = MenuItemBuilder::with_id("stop_gateway", "停止 Gateway").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&start_gw)
                .item(&stop_gw)
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
                            // Launch hermes gateway
                            let _ = std::process::Command::new("wsl")
                                .args(["-d", "Ubuntu-24.04.4", "bash", "-c", 
                                    "cd ~/.hermes && source hermes-venv/bin/activate && hermes gateway start"])
                                .spawn();
                        }
                        "stop_gateway" => {
                            // Kill hermes gateway process
                            let _ = std::process::Command::new("wsl")
                                .args(["-d", "Ubuntu-24.04.4", "bash", "-c", 
                                    "pkill -f 'hermes gateway' || true"])
                                .spawn();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
