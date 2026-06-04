# T-Q3 Capabilities 审计 — deliverable

## Summary

审计了 hermes-tray 的 src-tauri capabilities 配置（default.json + Cargo.toml + lib.rs）。结论：当前 3 项 declared permissions 覆盖了所有 14 个 #[tauri::command] 的 plugin 权限需求（仅 1 个 command 需要 core:event:default，已在 core:default 内）。但发现 `opener:default` 属于死声明，以及核心业务（WSL 命令 8 个 + config 读写 2 个）使用 `std::process::Command` / `std::fs` 绕过了 Tauri capability 安全模型——这是架构设计问题，不是 capabilities 配置问题。

## Changed Files

| 文件 | 操作 |
|------|------|
| `hermes-tray/.agent-teams/research/tq3-capabilities-audit.md` | 新建（审计报告全文） |
| `hermes-tray/.agent-teams/deliverables/tq3-capabilities-audit.md` | 新建（本文档） |

## 关键发现（5 条）

1. **capabilities 配置完整，无缺失**：default.json 声明的 `core:default` / `opener:default` / `window-state:default` 中，唯一被 #[tauri::command] 实际用到的是 `core:default`（为 `hermes_proxy_post_stream` 的 `window.emit()` 提供事件发射权限）。

2. **`opener:default` 是死声明**：`tauri-plugin-opener` 在 Cargo.toml 和 Builder 里都有，但 lib.rs 全局无任何 `opener::*` 调用。可删除该 plugin 依赖以节省二进制体积。

3. **`window-state` plugin 仅被动使用**：plugin 已注册且 capability 已声明，但 lib.rs 无显式 `window_state::*` API 调用。推测由 Builder 自动实现 window 几何状态持久化（属于被动使用，非 command 依赖）。

4. **核心业务绕过 capability 安全模型**：14 个 command 中 13 个完全不依赖 Tauri plugin——8 个 WSL 管理命令用 `std::process::Command`，2 个 config 命令用 `std::fs`，3 个 HTTP 命令用 `reqwest`。这些操作不受 Tauri capabilities 管控，属于 Rust 级别的硬编码防护。

5. **可攻击面低但安全模型覆盖不完整**：WSL 命令的 distro 参数来自前端但直接嵌入 `wsl -d <distro>` 无 shell 展开，无注入风险；但整体安全依赖于 Rust 代码硬编码而非 Tauri 权限模型——若后续 plugin 化改造，capabilities 需同步补全 `shell:allow-execute` 和 `fs:default`。

## 交付物路径

- 审计报告: `hermes-tray\.agent-teams\research\tq3-capabilities-audit.md`
- deliverable: `hermes-tray\.agent-teams\deliverables\tq3-capabilities-audit.md`

## 建议后续（T-V2 决策）

- **删** `tauri-plugin-opener` 及 `opener:default`（死声明）
- **评估** 是否需要引入 `tauri-plugin-shell` 和 `tauri-plugin-fs` 将 WSL/config 操作纳入 capabilities 管控（架构改造 scope）
- **保持** `window-state:default`（被动持久化有价值）

---

*审计员: Scout | 2026-06-04*
