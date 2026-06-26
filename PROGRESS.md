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

> **2026-06-26 同步说明**: v0.1.0 (S0-S5) 14 项全部 done + v0.1.1 (T-Q-NEW) 完成 + v2.0 路线图启动 (T-Q-S0~S5 done). 当前真正 open 的是 v2.1 进阶任务的下一站 + 用户侧验证.

| # | 分类 | 文件 | 描述 | 目标 |
|---|------|------|------|------|
| 1 | 构建 | `build-test.bat` | Windows 环境运行 `build-test.bat`，将日志发回分析 | S5 (用户侧) |
| 2 | 后端 托盘 | `src-tauri/src/lib.rs` | 托盘菜单加 3 项快速操作: 新建会话 / 续上次 / 搜索 | T-Q-S6 |
| 3 | 后端 热键 | `src-tauri/src/lib.rs` | Quick capture: 全局热键直接开新会话输入框 (不只是唤起) | T-Q-S5 增强 |

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
- [x] `build-test.bat` 新增 Windows 构建测试脚本（含日志输出）
- [ ] Windows 环境运行 `build-test.bat`，将日志发回分析

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
- [ ] **T-Q-S7**: 会话模板 + Persona 库 — 4d
- [ ] **T-Q-S8**: 项目上下文感知 (CWD 扫描 + 注入) — 3d
- [ ] **T-Q-S9**: Token / 成本追踪 — 3d
- [ ] **T-Q-S10**: 导出/分享 (markdown + 分享链接) — 2d
- [ ] **T-Q-S11**: 加密本地备份 (AES + 可选云同步) — 2d
- [ ] **T-Q-S12**: 多模型编排 — 4d
- [ ] **T-Q-S13**: 语音输入 — 3d
- [ ] **T-Q-S14**: 图片拖拽 / OCR — 2d
- [ ] **T-Q-S15**: 插件系统 — 5d

**总计**: 4 阶段 12 周 15 任务 (估算)

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

### 测试覆盖统计 (v2.0 启动后)

- v0.1.0 基线: 22 Rust (T-Q5) + 37 TS (T-Q6) = 59 tests
- v2.0 新增: 10 (S1.2) + 5 (S1.3) = 15 tests
- 合计: **74 tests, ~40% 覆盖率**
- 待补: Tauri 命令单测 (mock + io::Result), HTTP 客户端 (reqwest mock)

---
