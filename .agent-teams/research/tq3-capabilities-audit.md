# T-Q3 Capabilities 审计报告 (2026-06-04)

**项目**: hermes-tray (F:\work\workspace\Qoder\hermes-tray)
**审计范围**: src-tauri 权限配置覆盖度审查
**背景**: PROGRESS.md S4 "权限列表过简" 来源调查，Open #5 曾反映此问题，已由 T-Q2 处理，本任务为独立的主动审计。

---

## 1. 当前 default.json 声明的权限

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "window-state:default"
  ]
}
```

对应 Cargo.toml 中的 plugin 声明：
- `tauri-plugin-opener = "2"` (Cargo.toml L22)
- `tauri-plugin-window-state = "2"` (Cargo.toml L23)

---

## 2. lib.rs 里所有 #[tauri::command] 函数 + 实际需要的权限

| # | 函数名 | 行号 | 实际调用 | 需要权限 | 备注 |
|---|--------|------|----------|----------|------|
| 1 | `hermes_resolve_gateway_ip` | 53 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用，能力系统不覆盖 |
| 2 | `hermes_check_gateway_status` | 110 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 3 | `hermes_start_gateway` | 130 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 4 | `hermes_stop_gateway` | 152 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 5 | `hermes_check_gateway_health` | 191 | `reqwest::Client::builder()` | **无 Tauri 权限** | reqwest HTTP 调用，Rust 生态通行网络库 |
| 6 | `hermes_get_config` | 242 | `std::fs::read_to_string("config.json")` | **无 Tauri 权限** | 纯 OS 文件 I/O，不走 tauri-plugin-fs |
| 7 | `hermes_save_config` | 248 | `std::fs::write()` | **无 Tauri 权限** | 同上 |
| 8 | `hermes_detect_wsl` | 260 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 9 | `hermes_list_wsl_distros` | 270 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 10 | `hermes_find_bin` | 292 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 11 | `hermes_restart_gateway` | 330 | `std::process::Command::new("wsl")` | **无 Tauri 权限** | 纯 OS 级别调用 |
| 12 | `hermes_proxy_get` | 364 | `reqwest::Client::get()` | **无 Tauri 权限** | reqwest HTTP |
| 13 | `hermes_proxy_post` | 380 | `reqwest::Client::post()` | **无 Tauri 权限** | reqwest HTTP |
| 14 | `hermes_proxy_post_stream` | 396 | `reqwest::Client` + **`window.emit()`** | **`core:event:default`** | HTTP 流式推送 via `window.emit()`，事件发射需要 core 事件权限 |

**总计 14 个 command，其中 13 个完全不依赖任何 Tauri plugin 权限，1 个（hermes_proxy_post_stream）需要 core:event:default（在 core:default 范围内）。**

---

## 3. 差集分析

### 3.1 缺失的权限（建议加）

| 缺失项 | 严重度 | 说明 |
|--------|--------|------|
| **无缺失（针对 plugin 权限）** | — | 现有 default.json 声明的 3 项 plugin 权限已覆盖所有 command 的 plugin 调用需求 |

**结构性缺失（不属于 capabilities 范畴，但需关注）：**

| 缺失项 | 严重度 | 说明 |
|--------|--------|------|
| **无 fs plugin 覆盖 config 读写** | 中 | `hermes_get_config` / `hermes_save_config` 用 `std::fs` 直读 config.json，绕过了 tauri-plugin-fs 的路径 scope 控制。无法通过 capabilities 控制 config.json 的可访问路径范围。 |
| **无 shell plugin 覆盖 wsl 命令** | 中 | 所有 WSL 操作（8 个 command）通过 `std::process::Command` 实现，绕过了 Tauri 的 shell plugin 权限体系。在 Tauri 2 中，这些调用不受 capabilities 限制，安全模型依赖 tauri.conf.json 的 `security` 字段和 CSP。 |

> **关键发现**：这 14 个 command 的 Tauri 权限覆盖是完整的（需要的 core:default 已有），但设计上大量使用 Rust 标准库直接做 OS 调用，导致 Tauri 的 capability 安全模型对最关键的业务逻辑（WSL 管理、配置文件读写）是**失效的**。这是架构设计问题，不是 capabilities 配置问题。

### 3.2 多余的权限（建议删）

| 多余项 | 说明 | 建议 |
|--------|------|------|
| **`opener:default`** | `tauri-plugin-opener` 在 Cargo.toml L22 声明且 `.plugin(tauri_plugin_opener::init())` 已注册，但 lib.rs 全部 586 行中无任何 `opener::*` 函数调用，无 `invoke_plugin!()` 调用，无 `app.opener()` 使用。属于**死声明**。 | 可删 plugin 依赖（节省二进制体积），或确认前端是否通过 `invoke('plugin:opener::xxx')` 调用 |

### 3.3 风险评估

| 风险项 | 级别 | 说明 |
|--------|------|------|
| WSL 命令不受 capabilities 管控 | **中** | `std::process::Command` 直接调 wsl，攻击者若能注入 command 参数（目前 Rust 代码里是硬编码的 path/args，无注入点）可绕过 capability 限制。但实际风险取决于前端是否传可控参数。当前所有 distro 参数直接传至 `wsl -d <distro>` 无 shell 展开，风险可控。 |
| config.json 路径无 scope 控制 | **低** | `std::fs` 操作绕过了 tauri-plugin-fs 的 path scope，config.json 可读写任何位置。但路径构造仅依赖 `current_exe()` 和硬编码 "config.json"，无注入风险。 |
| opener plugin 死声明 | **低** | 仅浪费构建体积，不引入安全风险。 |

---

## 4. 建议补全方案

### 4.1 删除多余依赖

**Cargo.toml 变更（建议，不实施）：**
```toml
# 删除这一行（L22）
- tauri-plugin-opener = "2"

# 删除这一行（L23）—— 若仅依赖 window-state 的自动持久化而非显式 API 调用
- tauri-plugin-window-state = "2"
```

**default.json 变更（建议，不实施）：**
```json
{
  "permissions": [
    "core:default",
    "window-state:default"   // 若 opener 删除则同步移除
  ]
}
```

### 4.2 若要通过 Tauri capabilities 管控 WSL 和 fs（架构改造，不在本次审计范围内）

需要引入以下 plugin：

```toml
# Cargo.toml
tauri-plugin-shell = "2"   # 替换现有的 std::process::Command wsl 调用
tauri-plugin-fs = "2"      # 替换 std::fs config 读写
```

```json
// default.json
{
  "permissions": [
    "core:default",
    "shell:allow-execute",      // 覆盖 wsl 命令
    "fs:default",               // 覆盖 config.json
    "window-state:default"
  ]
}
```

**警告**：此改造涉及大规模 Rust 代码变更（将 `std::process::Command` 全部替换为 `tauri::plugin::shell::Command`），属于 T-V2 工作范围，当前审计结论仅为建议。

---

## 5. 总结

| 维度 | 结论 |
|------|------|
| **capabilities 配置正确性** | ✅ `core:default` 已覆盖 `hermes_proxy_post_stream` 的 `window.emit()` 需求；`window-state:default` 已覆盖 window 持久化 |
| **plugin 依赖必要性** | ⚠️ `opener:default` 死声明；`window-state` 仅被动使用 |
| **架构安全** | ⚠️ 核心业务（WSL 管理 + config 读写）完全绕过 Tauri capability 系统，依赖 Rust 硬编码防护而非权限模型 |
| **可攻击面** | 低（无外部注入点），但安全模型覆盖不完整 |

---

*审计完成时间: 2026-06-04 09:59 (Asia/Shanghai)*
*审计员: Scout (Agent Teams)*
