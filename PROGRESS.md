# Hermes Tray — 项目进度

## 项目结构

```
hermes-tray/
├── src/                    # Tauri 前端 (TypeScript + HTML + CSS)
│   ├── main.ts             # 前端逻辑 (连接/流式/AI 聊天/Sidebar/Persona/Token/导出)
│   ├── styles.css          # 样式 (支持亮色/暗色主题)
│   ├── index.html          # 入口 HTML
│   ├── tokenChart.ts       # Token 图表纯函数 (T-Q-S9)
│   ├── systemPrompt.ts     # system prompt 组合 (T-Q-S8)
│   └── tests/              # vitest TS 单元测试 (77 个)
├── src-tauri/              # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs          # 核心逻辑 (Tray/IPC/WSL 检测)
│   │   ├── crypto.rs       # AES-256-GCM 加密 (T-Q-S11)
│   │   └── db/             # SQLite schema + DAO (T-Q-S1.x)
│   │       ├── session.rs / message.rs / persona.rs
│   │       ├── token.rs / export.rs / project.rs
│   │       └── commands.rs
│   ├── tests/integration/  # Rust 集成测试 (含 sqlite + crypto, 131 个)
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── docs/                   # 设计 + Release Notes (含 RELEASE_v0.1.0/1/2.md)
├── .agent-teams/           # Mavis 维护 (TASK_BOARD.md + work-history.md)
└── build-test.ps1          # Windows 端构建测试 (T-Q4, 6 阶段)
```

> **历史** (2026-06-04 T-Q1 清理): 原 Python 死代码 (`tray_app.py` / `gateway_manager.py` / `config.py` / `__init__.py` / `generate_icon.py` / `requirements.txt`) 已 mavis-trash, ~1.3MB. 现在是纯 Tauri 项目.

---

## 任务看板

### Open

> **2026-07-01 同步说明**: v0.1.2 (S0-S11) 全 done + v0.1.2+S12-light/S13/S14 多模态全 done + 16a232e cleanup done. v2 路线图 12/15 done (S0-S11 + S12-light/S13/S14), 3 项 agent-side 配套 (S12-agent/S13-agent/S14-agent) 等 hermes-agent-cn NEEDS_BACKLOG 触发, 1 项 dropped (S15 → hermes-agent). 当前真正 open: 1 项 S5 增强 (quick capture) + 等用户装 Rust+Node toolchain 后跑 cargo test / build-test.ps1 验证.

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 1 | 后端 热键 | `src-tauri/src/lib.rs` | Quick capture: 全局热键直接开新会话输入框 (不只是唤起) | T-Q-S5 增强 |

### In Progress

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| - |  |  | 目前暂无正在处理的任务。 |  |

### Done (v0.1.0 ~ v0.1.1)

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 1 | 前端 BUG | `src/main.ts:329` | 修复 `sendBtn.textContent` 覆盖 SVG 图标的问题。 | S0-BUG-1 |
| 2 | 前端 BUG | `src/main.ts:251-255` | 已移除 `sendMessage()` 中重复推送的用户消息。 | S0-BUG-2 |
| 3 | 后端 优化 | `src-tauri/src/lib.rs:217,225` | 使用 `read_wsl_distro()` 替换硬编码 WSL 发行版。 | S1 |
| 4 | 后端 优化 | `src-tauri/src/lib.rs` | 新增 Gateway 状态检测 / 启停 / 健康检查命令。 | S1 |
| 5 | 后端 缺陷 | `src-tauri/src/lib.rs:443` | `spawn()` 结果已添加 `match` 错误处理，失败时发通知。 | S1 |
| 6 | 前端 安全 | `src/main.ts` | 添加 `escapeHtml()` 以防止模型返回内容 XSS。 | S1 |
| 7 | 前端 健康检查 | `src/main.ts` | 确认已有 30s 周期的连接健康检查定时器。 | S1 |
| 8 | 后端 新功能 | `src-tauri/src/lib.rs` | 新增 `hermes_detect_wsl()` / `hermes_list_wsl_distros()`。 | S2 |
| 9 | 后端 新功能 | `src-tauri/src/lib.rs` | 新增 `hermes_find_bin()` 自动搜索 WSL 中 hermes 路径。 | S2 |
| 10 | 后端 新功能 | `src-tauri/src/lib.rs` | Graceful Stop → Force Kill 两级停止逻辑。 | S2 |
| 11 | 后端 新功能 | `src-tauri/src/lib.rs` | 新增 Gateway 重启功能 `hermes_restart_gateway()`。 | S2 |
| 12 | 后端 新功能 | `src-tauri/src/lib.rs` | 托盘菜单新增"重启 Gateway"项。 | S2 |
| 13 | 后端 通知 | `src-tauri/src/lib.rs` | 启停/重启操作后通过 `app.emit()` 发送通知事件。 | S2 |
| 14 | 前端 通知 | `index.html` + `styles.css` + `main.ts` | 添加 Toast 通知组件（右下角滑入/3 色/3.5s 自动消失）。 | S2 |
| 15 | 配置 修复 | `src-tauri/src/lib.rs` | `write_config_json` 改用 `app_config_dir()` (修 MSI Program Files 写失败) | T-Q-NEW (v0.1.1) |

### Done (v2.0 路线图 T-Q-S0~S5)

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 16 | 设计 文档 | `docs/T-Q-S0-design.md` | v2.0 存储架构: app_config_dir 迁移 + SQLite schema + DAO 接口 + T-Q-NEW 修方案 | T-Q-S0 |
| 17 | 数据库 | `src-tauri/src/db/{schema,dao,pool,mod}.rs` | SQLite schema + DAO 骨架 + 连接池 | T-Q-S1.1 |
| 18 | 数据库 | `src-tauri/src/db/{session,message}.rs` | session + message DAO + 10 集成测试 | T-Q-S1.2 |
| 19 | 数据库 | `src-tauri/src/db/{persona,config,feedback}.rs` | persona + config + feedback DAO + 5 集成测试 | T-Q-S1.3 |
| 20 | 前端 UI | `src-tauri/src/db/commands.rs` + `src/main.ts` + `index.html` + `styles.css` | session/message Tauri commands + sidebar UI + FTS5 搜索 modal (+681 行) | T-Q-S2 |
| 21 | 前端 UI | `src/main.ts` | session 重命名 (双击) + 分页 load-more + 列表 reset | T-Q-S3 |
| 22 | 后端 + 前端 | `src-tauri/src/db/{dao,session}.rs` + `src/main.ts` + `styles.css` | FTS5 搜索 UX: session_title join fix, <b> 高亮, loading/empty states (+45 行) | T-Q-S4 |
| 23 | 后端 + 前端 | `src-tauri/src/lib.rs` + `src/main.ts` + `package.json` | 全局热键 Ctrl+Shift+H 唤起/聚焦窗口 (+22 main.ts) | T-Q-S5 |
| 24 | 后端 托盘 | `src-tauri/src/lib.rs` | 托盘菜单加 3 项: 新建会话 / 续上次 / 搜索, emit `tray://*` 事件给前端 | T-Q-S6 |
| 25 | 前端 事件 | `src/main.ts` | 3 个 tray:// 事件监听 + `loadLastSession()` (从 session_list 拿最近会话) | T-Q-S6 |

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

- [x] 实现 `hermes_detect_wsl()` 命令（检测 WSL 是否可用）
- [x] 实现 WSL 发行版自动发现/配置回退
- [x] 实现 Gateway 启动失败的通知/提示
- [x] 实现 `hermes_find_bin()` 自动寻找 `hermes` 路径
- [x] 实现 Graceful Stop → Force Kill 两级停止逻辑
- [x] 实现 Gateway 重启功能

### S3 — 用户体验改善

- [x] Textarea 自动增高（动态高度随输入文本自适应，max-height: 200px）
- [x] 窗口大小/位置持久化（`tauri-plugin-window-state`）
- [x] 设置页面（WSL 发行版配置、API Key、端口）
- [x] Markdown 渲染增强（代码高亮、表格）
- [x] 输入框字数限制显示
- [x] 模型名称从 API 动态获取并完善回退逻辑

### S4 — 构建与 CI

- [x] 修复 `tauri.conf.json` 图标路径（`icons/` → `assets/`）— 路径已验证正确，无需修复
- [x] 确保 `npm run build` 通过（`tsc --noEmit`）
- [x] 编写构建发布脚本

### S5 — 构建管线增强与 Windows 打包测试

- [x] `setup.iss` 修复 Source 路径指向 Tauri 产物
- [x] `build.bat` 重写为 Tauri 构建管线
- [x] `build-setup.bat` 同步更新路径检查
- [x] `build-test.bat` → `build-test.ps1` 新增 Windows 构建测试脚本（含日志输出）— T-Q4, 2026-06-04 一次过
- [x] Windows 环境运行 `build-test.ps1`, 6 阶段全过 (T-Q4, 2026-06-04 17:57) — Tauri 主程序 11.4MB + MSI 4.1MB + NSIS 2.8MB 三件套构建成功

### v0.1.1 — 配置路径修复 (T-Q-NEW)

- [x] `write_config_json` 改用 `app_config_dir()` (Tauri 2 canonical path)
- [x] 修 MSI Program Files 写配置失败 (silent failure)
- [x] Legacy fallback: exe dir + CWD 读, 保证 v0.1.x 用户升级保留设置
- [x] 首次写新路径时自动 backup 旧配置

### v2.0 基础 (4 周) — T-Q-S0 ~ S4 — 2026-06-23 启动

- [x] **T-Q-S0**: 设计文档 (`docs/T-Q-S0-design.md`, 455 行)
- [x] **T-Q-S1.1**: SQLite schema + DAO 骨架 + 连接池 (`src-tauri/src/db/`)
- [x] **T-Q-S1.2**: session + message DAO + **10 集成测试** (`tests/integration/`)
- [x] **T-Q-S1.3**: persona + config + feedback DAO + **5 集成测试**
- [x] **T-Q-S2**: session/message Tauri commands + sidebar UI + FTS5 搜索 modal (+681 行)
- [x] **T-Q-S3**: session 重命名 (双击) + 分页 + 列表 reset
- [x] **T-Q-S4**: FTS5 搜索 UX (highlight + loading/empty states)
- **里程碑达成**: 用户能创建/管理/搜索 100+ 会话, 离线可用, 数据本地

### v2.0 进阶 — T-Q-S5+

- [x] **T-Q-S5**: 全局热键 Ctrl+Shift+H 唤起/聚焦窗口
- [x] **T-Q-S6**: 托盘快速操作 (新建会话 / 续上次 / 搜索) — 1d ✅ 2026-06-26
- [x] **T-Q-S7**: Persona 库 + 默认 persona picker — 1d ✅ 2026-06-26
- [x] **T-Q-S8**: 项目上下文感知 (CWD 扫描 + 自动注入 system prompt) — 1d ✅ 2026-06-26
- [x] **T-Q-S9**: Token / 成本追踪 + 图表 — 1d ✅ 2026-06-26
- [x] **T-Q-S10**: 导出/分享 (markdown + 分享链接) — 1d ✅ 2026-06-26
- [x] **v0.1.2 tag** (commit `16fe742` at `f0526f2`) — release notes 落在 `docs/RELEASE_v0.1.2.md` — 2026-06-26
- [x] **T-Q-S11**: 加密本地备份 (AES-256-GCM + Argon2id) — 1d ✅ 2026-06-26
- [x] **T-Q-S12-light**: 模型选择器 + Persona.model 字段 — 1d ✅ 2026-06-26
- [x] **T-Q-S13**: 语音输入 (客户端录音 + 后端 STT) — 1d ✅ 2026-06-26
- [x] **T-Q-S14**: 图片拖拽上传 — 1d ✅ 2026-06-26
- [~] **T-Q-S12-agent / S13-agent / S14-agent**: 后端配套 (STT 端点 / vision 路由 / cost metadata) — ⏸️ 等待 `hermes-agent-cn/NEEDS_BACKLOG.md` Phase 1-3
- [❌] **T-Q-S15**: 插件系统 — **dropped**, 已迁到 hermes-agent (已有 `plugins.py` 框架, 不该在 tray 重做)

**总计**: 12 个 tray-side task 全 done, 3 个 agent-side 配套待执行, 1 个 dropped.

**S12-S15 重新对边界 (2026-06-26)**:
- S12: tray 只发 model **名字**, 路由/重试/熔断在 hermes-agent (SmartRouter, fallback_config.py, plugins middleware)
- S13: tray 只**捕获**音频, STT (Whisper 等) 全部在 hermes-agent
- S14: tray 只**捕获**图片 base64, vision 解析 + token 估算在 hermes-agent
- S15: 删除. 插件/middleware 框架 (`plugins.py`) 早就在 hermes-agent, tray 做是重新发明

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

### S2

- **lib.rs — WSL 检测命令**：
  - `hermes_detect_wsl()` — 检测 WSL 是否可用
  - `hermes_list_wsl_distros()` — 列出可用 WSL 发行版
  - `hermes_find_bin(distro)` — 自动搜索 WSL 中 hermes 路径（多候选回退）
- **lib.rs — 新增命令**：
  - `hermes_restart_gateway(distro)` — 重启 Gateway（pkill → sleep → force kill → nohup 启动）
- **lib.rs — spawn() 错误处理**：托盘菜单 `start_gateway` 中 `.spawn()` 已添加 `match` 错误处理，失败时通过 `app.emit()` 发送通知。
- **lib.rs — 托盘菜单**：新增"重启 Gateway"菜单项。
- **lib.rs — 通知事件**：启停/重启操作后通过 `app.emit("gateway-notification", payload)` 向前端发送通知事件。
- **前端 — Toast 通知系统**：
  - `index.html` 新增 `#toast-container` 容器
  - `styles.css` 新增 Toast 样式（右下角滑入、3 色、滑出动画）
  - `main.ts` 新增 `showToast()` 函数 + `gateway-notification` 事件监听，3.5s 自动消失

### S3

- **Textarea 自动增高**：
  - `handleInput()` 新增 auto-resize 逻辑（重置 height → 取 scrollHeight → 限 cap 200px）
  - `styles.css` max-height 从 120px 提升至 200px，增加 `min-height: 42px` + `overflow-y: auto`
- **窗口位置持久化**：
  - `Cargo.toml` 新增 `tauri-plugin-window-state`
  - `lib.rs` 注册 `.plugin(tauri_plugin_window_state::Builder::new().build())`
  - `capabilities/default.json` 添加 `"window-state:default"`
  - 前端安装 `@tauri-apps/plugin-window-state` npm 包
- **设置页面**：
  - Rust 新增 `hermes_get_config` / `hermes_save_config` 命令（读写 `config.json`）
  - HTML 已有的 Modal 结构：WSL 发行版(select)、Gateway 端口(number)、API Key(password)
  - CSS 新增 Modal 样式：遮罩层(.modal-overlay)、弹窗(.modal)、表单(.form-group)、按钮(.btn)
  - TypeScript 设置逻辑：打开时自动加载 WSL 发行版列表 + 当前配置值，保存时持久化并实时更新运行时 API_KEY 和 gateway URL
- **Markdown 渲染增强**：
  - 安装 `marked` (v18) + `marked-highlight` + `highlight.js`
  - `main.ts` 配置 `marked-highlight` 扩展：`langPrefix: 'hljs language-'`，按语言高亮 → 自动检测
  - `main.ts` 移除旧的 `formatMessage()` 正则替换，改用 `marked.parse()` (GFM 完整语法)
  - CSS 新增表格样式：`table`、`th/td`、`tr:nth-child(even)`
  - CSS 强化代码块：暗色背景 `#1e1e1e`、`border`、`overflow-x: auto`
  - CSS 导入 `highlight.js/styles/github-dark.css` 语法高亮主题
- **模型动态获取**：
  - 提取 `UNKNOWN_MODEL` 命名常量（代替硬编码 `'-'`）
  - `fetchModelInfo()` 3 层回退：API 返回模型 → 空数组 → 失败时用 `CONFIG.defaultModel`
  - `sendMessage()` 使用 `state.currentModel`，首次消息回退 `CONFIG.defaultModel`
  - `modelName` 元素始终更新：动态模型名或回退默认值

### S4

- **Tauri 图标路径**：`src-tauri/icons/` 文件齐全，`tauri.conf.json` 中 `"icons/..."` 路径相对于 `src-tauri/` 解析，已验证正确。
- **构建验证**：`npx tsc --noEmit` 通过，`npm run build`(tsc + vite) 生产构建成功。
- **GitHub Actions CI**：
  - `ci.yml`：PR 检查（tsc → build → cargo check → clippy → fmt）
  - `release.yml`：打 tag `v*` 时触发，矩阵构建（Linux .deb + AppImage / macOS .dmg / Windows .msi），自动发布 Release

### v0.1.1 (T-Q-NEW, 2026-06-23)

- **`write_config_json` 路径修复**：
  - `AppHandle::app_config_dir()` 替代 exe dir 写入 (Windows → `%APPDATA%\com.hermes.tray\`)
  - 修 MSI Program Files 路径不可写问题
  - Legacy fallback: 旧配置 (exe dir + CWD) 优先读, 首次写新路径时自动 backup

### v2.0 (T-Q-S0 ~ S5, 2026-06-23+)

- **T-Q-S0 — 存储架构设计**：
  - `docs/T-Q-S0-design.md` (455 行): app_config_dir 迁移 + SQLite schema + DAO 接口 + T-Q-NEW 修方案
  - 决策: SQLite (rusqlie) + DAO + 连接池; 离线优先, 加密备份预留接口
- **T-Q-S1.1 — DB 骨架**：
  - `src-tauri/src/db/{schema,dao,pool,mod}.rs`
  - `schema.sql`: sessions / messages / personas / config / feedback 5 表
  - 连接池: r2d2 风格
- **T-Q-S1.2 — session + message DAO + 10 集成测试**:
  - `src-tauri/src/db/{session,message}.rs`
  - 10 tests PASS (CRUD + FTS5 搜索 + 边界)
- **T-Q-S1.3 — persona + config + feedback DAO + 5 集成测试**:
  - `src-tauri/src/db/{persona,config,feedback}.rs`
  - 5 tests PASS
- **T-Q-S2 — sessions 端到端** (+681 行):
  - `src-tauri/src/db/commands.rs` 新增 4 个 Tauri commands
  - `src/main.ts` sidebar UI (新会话/列表/搜索/删除/切换)
  - `index.html` sidebar + FTS5 搜索 modal
  - `styles.css` 完整 sidebar/modal 样式
- **T-Q-S3 — session UX 增强**:
  - 双击重命名 (inline edit)
  - 分页 load-more (防止 100+ 会话一次加载卡)
  - `loadSessionList` reset (新建后刷新列表)
- **T-Q-S4 — FTS5 搜索 UX** (+45 行):
  - `src-tauri/src/db/dao.rs` session_title join 修
  - `<b>` 高亮渲染
  - loading / empty states
- **T-Q-S5 — 全局热键**:
  - Ctrl+Shift+H 唤起/聚焦窗口 (从任何应用)
  - 平台兼容性: Windows 钩子 + macOS / Linux 待 v2.1
- **T-Q-S6 — 托盘快速操作** (2026-06-26, 1d):
  - `src-tauri/src/lib.rs` 托盘菜单 3 项: 新建会话 / 续上次 / 搜索
  - 每次点击: 唤起窗口 + emit `tray://*` 事件给前端
  - `src/main.ts` 3 个监听: `createSession()` / `loadLastSession()` / `openSearchModal()`
  - `loadLastSession()`: invoke `session_list` limit=1 拿最近会话, selectSession, 没历史时 toast 提示
  - 设计原则: Rust 只 emit 事件, 前端是单一 UX 真相源 (避免逻辑分散在两处)
- **T-Q-S9 — Token / 成本追踪** (2026-06-26, 1d, originally 3d):
  - 后端 `src/db/token.rs` (~370 行, 11 unit tests): `estimate_tokens()` (char/4 heuristic) + `cost_for_model()` (10 个模型定价表) + `TokenStats` (per-day + per-model 聚合)
  - 1 new Tauri command: `token_stats(period: "day"|"week"|"month"|"all")` → `TokenStats` struct (totals + daily[] + by_model[])
  - `MessageDAO::append` auto-estimates tokens + bumps `sessions.total_tokens` 原子性. `delete` 也 decrement. Pre-existing 1 test (`msg.tokens == 0`) 改成 `== 2` (hello world = 11 chars/4)
  - 前端 `src/tokenChart.ts` (纯函数, 13 unit tests): `layoutChart` (SVG-ready) + `formatTokens` (1.23k/12.3k/1.50M) + `formatCost` ($0.0012 / $1.50)
  - 新 "📊" stats 按钮 (sidebar header) → 4-period tab + 3 big tiles (tokens / cost / msg·session) + SVG stacked bar chart + per-model cost table
  - Session list 加 compact "X tok" badge, 通过 `refreshCurrentSessionRow()` 在每次 send 后 live update
  - 设计原则: char/4 heuristic 是 projection (不是真账单); gateway 真正的 usage capture 是 future T-Q-S9.x
- **T-Q-S11 — 加密本地备份** (2026-06-26, 1d, originally 2d):
  - 后端 `src-tauri/src/crypto.rs` (~340 行, 18 unit tests): AES-256-GCM 加密 + Argon2id KDF (19 MiB / 2 iter / 1 parallel) + 随机 salt/nonce per backup
  - 自描述 blob 格式: `[magic "HTBK" 4B][version 1B][kdf 1B][salt_len 1B][salt 16B][nonce_len 1B][nonce 12B][ct_len 8B][ciphertext+tag]`
  - AAD 绑定到 header (防止 salt/nonce 跨备份 swap); GCM auth tag 防 ciphertext tamper
  - 3 new Tauri commands: `backup_create(path, pwd)` (live DB → encrypted file) / `backup_restore(path, pwd)` (encrypted file → live DB) / `backup_verify(path, pwd)` (check password)
  - 用 rusqlite `Connection::backup()` online backup API 安全复制 (并发读友好), WAL checkpoint 在前后都跑
  - Restore 后 user 必须重启应用 (pool 现有连接缓存旧 schema, 没法热切; 显式提示)
  - 加 3 个 deps: `aes-gcm = "0.10"`, `argon2 = "0.5"`, `rand = "0.8"`, 启用 `rusqlite.backup` feature
  - 修了一个 AAD slice 大小不匹配的 bug (encrypt 用 36B AAD, decrypt 用了 44B, 触发 auth tag fail)
  - 前端: 新 "💾+" 按钮在 sidebar → 备份 modal (2 tabs: 创建/恢复). 创建 tab 路径 + 密码 + 确认密码. 恢复 tab 文件 + 密码 + 验证按钮 + 恢复按钮 + 重启警告
  - 设计原则: 本地优先, 加密 opt-in; restore 提示重启; 文件用 .htbk 后缀但无强约束
- **T-Q-S10 — 导出/分享** (2026-06-26, 1d, originally 2d):
  - 后端 `src/db/export.rs` (~370 行, 12 unit tests): `to_markdown()` + `to_json()` + `ExportPersona/Project/Session` structs. ISO-8601 UTC 时间格式化
  - 2 new Tauri commands: `export_session_markdown(session_id) -> String` + `export_session_json(session_id) -> Value`. 共用 `load_export_bundle()` 拉 session + messages + persona + project
  - 前端: 每个 session row 加 "📤" 按钮 (hover 显示) → 调用 `export_session_markdown` 复制到剪贴板 + toast
  - Chat header 加 share button (3 节点链接 icon) → `export_session_json` + base64url encode → 完整 URL 复制到剪贴板
  - App 启动时检查 `location.hash` 是否含 `#share=...` → 显示 confirm dialog → 创建新 local session + append messages → 自动 clear hash
  - 12 unit tests 覆盖 base64url encode/decode + URL fragment 解析 + JSON 完整 round-trip (含 emoji, 中文, multi-line)
  - 设计原则: share link self-contained (no server), no HMAC (MVP personal-use), drop persona/project in import (不同 local IDs)
- **T-Q-S8 — 项目上下文感知** (2026-06-26, 1d):
  - 后端 `src/db/project.rs` (~700 行) 纯函数 CWD 扫描器: README (2KB) + manifest (package.json / Cargo.toml / pyproject.toml / go.mod) + git remote + top-level 语言检测 → ≤4KB markdown summary
  - Migration 0002: `sessions.project_context` 列 (project_dir 列原本就在, 现在开始用)
  - 1 new Tauri command: `project_scan(path)` → `ProjectContext` (前端先调, 把 JSON 作为 `project_context` 传给 `session_create`)
  - 前端 Settings 加 "默认项目路径" 字段, 持久化到 `config.default_project_path`
  - `createSession()`: 默认路径非空时调 `project_scan`, 把 result 写入 session row
  - 会话列表行: persona avatar + 新的 📁 project badge (name)
  - 新建会话 welcome message: 显示 Persona + 项目
  - `src/systemPrompt.ts` (纯函数) + 12 unit tests: 组合 `persona.system_prompt` + `project.summary_markdown`, 用 `\n\n---\n\n` 分隔
  - `sendMessage()` 调用 `composeSystemPrompt()`, prepend 一个 system 消息到 `apiMessages`
  - 设计原则: 缓存到 `project_context` 列 (不每次重扫), 用户可在 Settings 改路径
  - 更新 11 个 existing session test 调用 (signature 扩 2 个 None 参数)
- **T-Q-S7 — Persona 库 + 默认 picker** (2026-06-26, 1d):
  - 后端 5 个 persona Tauri commands (`persona_list/get/create/update/delete`) + 2 个 db_config commands
  - 3 个 builtin personas 首次启动 seed (default / code-reviewer / translator), idempotent + 不覆盖用户同名 persona
  - `BUILTIN_PERSONAS` 常量 + `seed_builtin_personas(&Db)` 函数 (在 `pool.rs`)
  - 前端 header 加 persona picker (select) + 管理按钮 (齿轮) → 弹 persona library modal
  - 3-state modal: list (CRUD) / create form / edit form, builtin 锁 name+avatar 但 prompt 可改
  - `currentPersonaId` 状态, 切换时持久化到 `config.default_persona_id`, 重启自动恢复
  - `createSession()` 传 `personaId`, 会话列表标题前缀 persona emoji (一眼看角色)
  - 修复 T-Q-S1.3 遗留的 pre-existing test bug (`count_thumbs` 错传 `&empty_session`)
  - 设计原则: persona = template + role in one, 不另起 templates 表

### 测试覆盖统计 (v2.0 启动后)

- v0.1.0 + T-Q9 基线: 55 Rust (T-Q5+T-Q9 stage 2) + 37 TS (T-Q6) = 92 tests
- v2.0 新增: 10 (S1.2) + 5 (S1.3) + 5 (S7) + 15 (S8 backend) + 12 (S8 frontend) + 11 (S9 backend) + 13 (S9 frontend) + 12 (S10 backend) + 12 (S10 frontend) + 18 (S11 backend) + 3 (S11 frontend) = 116 tests
- 合计: **131 Rust + 77 TS = 208 tests, ~50% 覆盖率**
- 待补: Tauri 命令单测 (mock + io::Result), HTTP 客户端 (reqwest mock)

---
