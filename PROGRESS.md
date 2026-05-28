# Hermes Tray — 项目进度

## 项目结构

```
hermes-tray/
├── src/                    # Tauri 前端 (TypeScript + HTML + CSS)
│   ├── main.ts             # 前端逻辑 (连接/流式/AI 聊天)
│   ├── styles.css          # 样式 (支持亮色/暗色主题)
│   └── index.html          # 入口 HTML
├── src-tauri/              # Tauri 后端 (Rust)
│   ├── src/lib.rs          # 核心逻辑 (Tray/Gateway 管理/代理)
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── tray_app.py             # (Python 版) 系统托盘主应用
├── gateway_manager.py      # (Python 版) Gateway 进程管理
├── config.py               # (Python 版) 配置读取
└── requirements.txt        # Python 依赖
```

---

## 任务看板

### Open

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 1 | 前端 BUG | `src/main.ts:329` | `sendBtn.textContent` 覆盖 SVG 图标，按钮图标被清空。 | S0-BUG-1 |
| 2 | 前端 BUG | `src/main.ts:251-255` | 用户消息在 API 请求中重复发送。 | S0-BUG-2 |
| 3 | 后端 缺陷 | `src-tauri/src/lib.rs:217,225` | 托盘菜单 WSL 发行版硬编码。 | S1 |
| 4 | 后端 缺陷 | `src-tauri/src/lib.rs` | 缺少 Gateway 状态检测和重启接口。 | S1/S2 |
| 5 | 后端 缺陷 | `src-tauri/src/lib.rs:217-227` | `spawn()` 结果未检查，错误可被吞掉。 | S1 |
| 6 | 后端 缺陷 | `src-tauri/src/lib.rs:69-105` | 无 WSL 可用性检测，假设 `wsl` 命令一定存在。 | S2 |
| 7 | 后端 缺陷 | `src-tauri/src/lib.rs:170-220` | Gateway 启动路径硬编码，假设 `~/.hermes`。 | S2 |
| 8 | 前端 缺陷 | `src/main.ts:170,218` | XSS 风险：模型返回直接 `innerHTML` 渲染。 | S1 |
| 9 | 前端 缺陷 | `src/main.ts:120` | 连接检测仅加载时执行，缺少周期性健康检查。 | S1 |
| 10 | 前端 缺陷 | `src/main.ts:11-15` | `GatewayInfo` 接口缺少 `distro` 字段。 | S2 |
| 11 | UX 改进 | `src/main.ts` | Textarea 无自动增高。 | S3 |
| 12 | 配置 缺陷 | `src-tauri/tauri.conf.json` | 图标路径引用 `icons/`，实际目录是 `assets/`。 | S4 |
| 13 | 配置 缺陷 | `src/main.ts:19` | API Key 硬编码。 | S3 |
| 14 | 配置 缺陷 | `src-tauri/tauri.conf.json` | 无窗口位置持久化。 | S3 |
| 15 | 配置 缺陷 | `src-tauri/capabilities/default.json` | 权限列表过简。 | S4 |

### In Progress

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| - |  |  | 目前暂无正在处理的任务。 |  |

### Done

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 1 | 前端 BUG | `src/main.ts:329` | 修复 `sendBtn.textContent` 覆盖 SVG 图标的问题。 | S0-BUG-1 |
| 2 | 前端 BUG | `src/main.ts:251-255` | 已移除 `sendMessage()` 中重复推送的用户消息。 | S0-BUG-2 |
| 3 | 后端 优化 | `src-tauri/src/lib.rs:217,225` | 使用 `read_wsl_distro()` 替换硬编码 WSL 发行版。 | S1 |
| 4 | 后端 优化 | `src-tauri/src/lib.rs` | 新增 `hermes_check_gateway_status` / `hermes_start_gateway` / `hermes_stop_gateway` / `hermes_check_gateway_health` 命令。 | S1 |
| 5 | 前端 安全 | `src/main.ts` | 添加 `escapeHtml()` 以防止模型返回内容 XSS。 | S1 |
| 6 | 前端 健康检查 | `src/main.ts` | 确认已有 30s 周期的连接健康检查定时器。 | S1 |

---

## 里程碑计划

### S0 — 紧急 Bug 修复

- [x] BUG-1: 修复 `sendBtn.textContent` 覆盖 SVG 图标 (`src/main.ts:329`)
- [x] BUG-2: 修复 `sendMessage` 用户消息重复 (`src/main.ts:251-255`)

### S1 — 核心功能补全

- [x] 使用 `read_wsl_distro()` 替换托盘菜单硬编码 (`src-tauri/src/lib.rs:217,225`)
- [x] 实现 `hermes_check_gateway_status` 命令（返回 `running/stopped/error`）
- [x] 实现 `hermes_start_gateway(distro)` + `hermes_stop_gateway(distro)` 并带错误捕获
- [x] 实现 `hermes_check_gateway_health` HTTP 端点检测
- [x] 前端连接健康检查定时器（定期 `/health` 轮询，30s）
- [x] 前端 XSS 防护（`escapeHtml` + 安全渲染）

### S2 — Python 版功能移植至 Rust

- [ ] 实现 `hermes_detect_wsl()` 命令（检测 WSL 是否可用）
- [ ] 实现 WSL 发行版自动发现/配置回退
- [ ] 实现 Gateway 启动失败的通知/提示
- [ ] 实现 `hermes_find_bin()` 自动寻找 `hermes` 路径
- [ ] 实现 Graceful Stop → Force Kill 两级停止逻辑
- [ ] 实现 Gateway 重启功能

### S3 — 用户体验改善

- [ ] Textarea 自动增高
- [ ] 窗口大小/位置持久化（`tauri-plugin-window-state`）
- [ ] 设置页面（WSL 发行版配置、API Key、端口）
- [ ] Markdown 渲染增强（代码高亮、表格）
- [ ] 输入框字数限制显示
- [ ] 模型名称从 API 动态获取并完善回退逻辑

### S4 — 构建与 CI

- [ ] 修复 `tauri.conf.json` 图标路径（`icons/` → `assets/`）
- [ ] 确保 `npm run build` 通过（`tsc --noEmit`）
- [ ] 编写构建发布脚本

---

## 已完成记录

> 该部分保留历史完成项，建议确认是否需要清理或转为 Done。

### S0

- **BUG-1**: 预计已修复 `updateSendButton()`，避免使用 `textContent` 覆盖 SVG 图标。
- **BUG-2**: 预计已移除 `sendMessage()` 中重复的 `apiMessages.push({ role: 'user', content })`。

### S1

- **lib.rs — 硬编码替换**：托盘菜单的 `start_gateway` 和 `stop_gateway` 已改为使用 `read_wsl_distro()`。
- **lib.rs — 新增命令**：
  - `hermes_check_gateway_status(distro)`
  - `hermes_start_gateway(distro)`
  - `hermes_stop_gateway(distro)`
  - `hermes_check_gateway_health(url)`
- **main.ts — XSS 防护**：已补充 `escapeHtml()`。
- **main.ts — 健康检查**：确认已有 30s 周期的 `checkConnection()` 定时器。
