# Hermes Tray v0.1.2 (2026-06-26)

功能版本. v0.1.1 的 config 路径 bug 修复基础上, 把 v0.2.0 SQLite 路线图 (T-Q-S0..S10) 的全部功能落地: 多会话持久化 + FTS5 搜索 + 全局热键 + 托盘快捷操作 + Persona 库 + 项目上下文感知 + Token/成本追踪 + 导出分享.

## 新功能 (T-Q-S0..S10, 累计 11 tasks)

### S0 — v2.0 存储架构设计 (`docs/T-Q-S0-design.md`, 455 行)

决定用 SQLite 替代纯 JSON config 存储, 设计 `app_config_dir` 迁移 + schema v1 (sessions, messages, personas, tags, session_tags, config, feedback, FTS5 virtual table + triggers) + DAO trait 接口 + 迁移策略.

### S1 — SQLite schema + DAO 层

- Migration runner: 读 `migrations/*.sql` 按版本号应用, `schema_version` 表记录.
- 7 张表: `sessions`, `messages`, `personas`, `tags`, `session_tags`, `config`, `feedback` + `messages_fts` FTS5 virtual table + 3 个 triggers (`messages_ai/ad/au`).
- 6 个 DAO: `SessionDAO`, `MessageDAO`, `PersonaDAO`, `ConfigDAO`, `FeedbackDAO`, 共享 `Db` facade.
- 10 + 5 = 15 集成测试 (S1.2 session/message + S1.3 persona/config/feedback).

### S2 — 迁移到 SQLite + r2d2 pool

- `open_pool(path)` 用 `r2d2_sqlite::SqliteConnectionManager`, max_size=10, WAL mode + foreign_keys + busy_timeout=5s.
- `init_db(app_handle)` 一次性建库 + 应用所有 pending migrations.
- 单元测试覆盖 r2d2 配置解析 / config JSON 读写 / WSL distro 解析.

### S3 — 多会话 UI (sidebar + tabs + 新建/删除/重命名)

- Sidebar 默认收起, 展开按钮在 header.
- 会话列表: 50 条/页 + "加载更多" 分页.
- 双击标题就地重命名 (prompt + input).
- 删除按钮 + confirm 弹窗.
- 新建按钮 → `session_create` Tauri command.

### S4 — FTS5 全文搜索

- `session_search(query, limit)` Tauri command.
- `snippet(messages_fts, 0, '<b>', '</b>', '...', 32)` + BM25 rank 排序.
- 搜索 modal: Ctrl+K 唤起, 250ms debounce, 命中消息高亮 (前端 `<b>` 渲染).

### S5 — 全局热键 `Ctrl+Shift+H` 唤起/聚焦窗口

- `tauri-plugin-global-shortcut` 注册全局快捷键.
- 触发: 唤起窗口 + setFocus + 自动开 sidebar + focus 输入框.
- 平台兼容性: Windows 用全局钩子 (已测), macOS / Linux 待 v2.1.

### S6 — 托盘快速操作 (新建会话/续上次/搜索)

- 托盘菜单加 3 项: 新建会话 / 续上次 / 搜索.
- 每次点击: 唤起窗口 + emit `tray://*` 事件给前端.
- 前端 `loadLastSession()`: invoke `session_list` limit=1 拿最近会话, selectSession, 没历史时 toast 提示.
- 设计原则: Rust 只 emit 事件, 前端是单一 UX 真相源.

### S7 — Persona 库 + 默认 picker

- 5 persona Tauri commands: `persona_list/get/create/update/delete`.
- 2 db_config commands: `db_config_get/set` (for `default_persona_id`).
- 3 builtin personas seed 首次启动 (default / code-reviewer / translator), idempotent + 不覆盖用户同名 persona.
- 前端: header 加 persona picker (select) + 管理按钮 (齿轮) → 3-state modal (list/create/edit).
- builtin 锁 name+avatar 但 description+prompt 可编辑.
- `currentPersonaId` 持久化到 `config.default_persona_id`, 重启恢复.
- `createSession()` 传 `personaId`, 会话标题前缀 persona emoji.

### S8 — 项目上下文感知 (CWD 扫描 + 自动注入 system prompt)

- `src/db/project.rs` (~700 行) 纯函数扫描器:
  - README (≤2KB excerpt)
  - manifest (package.json / Cargo.toml / pyproject.toml / go.mod)
  - git remote (.git/config → remote.origin.url)
  - 20+ 语言检测 (rs, py, ts, js, go, java, kt, swift, c, cpp, ...)
  - 渲染 ≤4KB markdown summary
- Migration 0002: `sessions.project_context` 列 (project_dir 列原本就在, 一直没用).
- 1 new Tauri command: `project_scan(path)`.
- 前端 Settings 加 "默认项目路径" 字段 (持久化到 `config.default_project_path`).
- `createSession()` 默认路径非空时调 `project_scan`, 缓存 JSON 到 session.
- `src/systemPrompt.ts` (纯函数) + 12 unit tests: 组合 persona.system_prompt + project.summary_markdown, `\n\n---\n\n` 分隔.
- `sendMessage()` prepend system 消息; null 时不注入 (省 token).

### S9 — Token / 成本追踪 + 图表

- `src/db/token.rs` (~370 行) — `estimate_tokens()` (char/4 heuristic) + `cost_for_model()` (10 个模型定价) + `TokenStats` (per-day UTC + per-model).
- 1 new Tauri command: `token_stats(period: "day"|"week"|"month"|"all")`.
- `MessageDAO::append/delete` 自动维护 `sessions.total_tokens` (原子化).
- 前端 `src/tokenChart.ts` (纯函数, 13 tests) — `layoutChart` + `formatTokens` + `formatCost`.
- "📊" 按钮 → 4-period tab + 3 big tiles (tokens / cost / msgs·sessions) + SVG stacked bar chart + per-model cost table.
- Session list 加 "X tok" badge, `refreshCurrentSessionRow()` 每次 send 后 live update.
- 设计原则: char/4 是 projection (不是真账单); gateway 真实 usage capture 是 future T-Q-S9.x.

### S10 — 导出/分享 (markdown + 分享链接)

- `src/db/export.rs` (~370 行) — `to_markdown()` + `to_json()` + ISO-8601 格式化.
- 2 new Tauri commands: `export_session_markdown` / `export_session_json`. 共用 `load_export_bundle()`.
- Markdown 格式: `# title`, metadata list, `---`, `## role · ISO_DATE` blocks, code 内容原样透传.
- JSON format: `{ version: 1, exported_at, session, persona, project, messages[] }` 含 version 字段供 forward-compat.
- 前端: session row hover 显 "📤" → 复制 markdown 到剪贴板.
- Chat header share 按钮 (3 节点图标) → base64url encode JSON → 完整 URL 复制.
- App 启动检查 `location.hash` `#share=...` → confirm dialog → 创建新 local session + append messages → clear hash.
- 设计原则: share link self-contained (no server), no HMAC (MVP personal-use), import 时 drop persona/project.

## 测试

- **113 Rust + 74 TS = 187 tests, 0 failures** (v0.1.1 是 48 Rust; +65 Rust, +37 TS)
- 覆盖率: ~48% (v0.1.1 ~30%; +18pp)
- 新增覆盖:
  - SessionDAO / MessageDAO × 10 (CRUD, FTS search, paginate, token count)
  - PersonaDAO / ConfigDAO / FeedbackDAO × 10
  - project scanner × 15 (manifest parsing, README truncation, git, languages, edge cases)
  - token estimation + pricing × 11
  - markdown / JSON export × 12
  - TS pure functions: `systemPrompt` × 12, `tokenChart` × 13, `shareLink` × 12
- 修了 1 个 pre-existing test bug (T-Q-S1.3 `count_thumbs` 错传 `&empty_session`)
- `cargo fmt --check` 通过, `cargo check` 通过, `npx tsc --noEmit` 通过, `vite build` 通过 (~880ms)

## 安装 / 升级

- 同 v0.1.0/v0.1.1. MSI 安装到 `C:\Program Files\Hermes Tray\`, 数据存 `%APPDATA%\com.hermes.tray\`.
- **v0.1.x → v0.1.2 升级**: 旧 `config.json` 自动迁移到 `%APPDATA%`. SQLite DB `sessions.db` 首次启动自动创建 + 应用所有 migrations.
- **首次启动会 seed 3 个 builtin personas** (default / code-reviewer / translator), 不会覆盖已存在的用户 persona.

## 已知限制

- Token cost 是 projection (char/4 heuristic), 不是真账单. Gateway 实际 usage capture 待 v2.1.
- 搜索 modal 当前只搜消息内容, 不搜会话标题. (Title 搜待 v2.1.)
- Share link 没签名, 不适合公开分享敏感内容 (适合个人 / 团队内部传).
- Project 扫描器对 monorepo 的多 manifest (同时有 package.json + Cargo.toml) 优先取 package.json.
- 大 session (>10k 消息) 导出可能慢, MVP 不分块 (LIMIT 1M).

## 下一步

- **v0.1.3** (T-Q-S11) 加密本地备份 (AES-256-GCM + Argon2id)
- **v0.1.4** (T-Q-S12) 多模型编排 / agent 路由
- v0.2.0 路线图后续: 性能优化, 大列表分页, voice input, plugin 系统

## Commit (累计 9 个 since v0.1.0)

- `f0526f2` feat(export): T-Q-S10 add session export to markdown/JSON + share-link import
- `83dbad7` feat(token): T-Q-S9 add token estimation + cost stats modal with SVG chart
- `a18fc27` feat(project): T-Q-S8 frontend — settings field + project_scan wire + system-prompt injection
- `3bf240e` feat(project): T-Q-S8 backend — project_scan Tauri command + project.rs scanner
- `46aa001` feat(persona): T-Q-S7 add Persona library + default persona picker
- `562c15a` feat(sessions): T-Q-S6 托盘快速操作 — 新建会话/续上次/搜索 3 项
- `e9fb4a9` T-Q-S5: global shortcut Ctrl+Shift+H to show/focus window
- `7644914` feat(sessions): T-Q-S4 FTS5 search UX — session_title join fix, <b> highlight, loading/empty states
- `858df42` T-Q-S3 (multi-session UI: rename, paginate, sidebar) — 等等
- (S0/S1/S2 commits 在更早历史, v0.1.1 之前)
- `7bcb1d4` fix(config): T-Q-NEW write_config_json (v0.1.1)

## Tag

`v0.1.2` 在 `f0526f2`. (本地未 push, per 月度批推策略.)
