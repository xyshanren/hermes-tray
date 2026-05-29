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
| 1 | UX 改进 | `src/main.ts` | Textarea 无自动增高。 | S3 |
| 2 | 配置 缺陷 | `src/main.ts:19` | API Key 硬编码。 | S3 |
| 3 | 配置 缺陷 | `src-tauri/tauri.conf.json` | 无窗口位置持久化。 | S3 |
| 4 | 配置 缺陷 | `src-tauri/tauri.conf.json` | 图标路径引用 `icons/`，实际目录是 `assets/`。 | S4 |
| 5 | 配置 缺陷 | `src-tauri/capabilities/default.json` | 权限列表过简。 | S4 |

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
