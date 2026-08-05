# Hermes Tray — CHANGELOG

> Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn). 全栈：[frontend (Svelte + Vite) + Tauri (Rust) + SQLite FTS5 + WebView2].
>
> 完整 release notes 落在 `docs/RELEASE_vX.Y.Z.md`。

---

## alpha-33b（未发布 — [PR #2](https://github.com/xyshanren/hermes-tray/pull/2) 待开）

四件 P1 修复全到位，端到端测试覆盖，对应 ROADMAP §v0.3.0 P1-2 / P1-3 / P1-7 / P1-12。完整 diff 见分支 `feat/alpha-33b`。

- **P1-2：assistant 外部链接走系统默认浏览器**（PR #2） — assistant Markdown 渲染里点 `<a href>` 之前会把整 WebView 替换成外网页面（无返回按钮、卡死），现在改走 `@tauri-apps/plugin-shell.open()`，协议白名单限制为 `http:` / `https:` / `mailto:`，其他协议静默拒绝；capability `shell:allow-open` 已添加；plugin-shell@2.3.3 + 4 个 mock 测试 (`chat-view.test.tsx` 44/44 pass)。
- **P1-3：图片附件 DB 持久化 + 切 session 回放**（PR #2） — 新增 `message_attachments` BLOB 子表（migration 0006，`schema_version: 6`），FK 级联删除保证 session 清理时附件一并清掉；DAO 新增 `attach` / `list_attachments` (MIME 限定 `image/*`，最大 10 MiB)，Tauri commands 新增 `hermes_message_attach` / `hermes_message_attachments`；前端 `main.ts` 切换 session 时拉 attachments 重建 data URL，发送 user 消息时先等 `message_append` 返回 id 再写附件；5 个新 Rust 测试 (`message_attachments_round_trip_and_cascade_with_message` 等) 通过。
- **P1-7：SSE 错误分三类路径**（PR #2） — `chat-stream.ts` catch 块区分 handshake 失败（已发请求但无 SSE payload → 把 connectionStatus 改 disconnected + fatal banner error）、mid-stream 中断（已收到 SSE chunk 后报错 → 只在 assistant bubble 末尾 append 错误，不动 connection dot）、本地准备失败（system prompt / message 准备阶段报错 → 不污染连接状态）。3 个新测试覆盖全三类。
- **P1-12：后台回复系统通知 + 点击回前台**（PR #2） — 加 `tauri-plugin-notification@2.3.3`（Cargo + npm），capability `notification:default`；`reply-notification.ts` 封装通知逻辑：窗口在前台直接跳过，通知 body 用用户提问前 30 字符（不泄漏 assistant 长文本），点击通知通过 `getCurrentWindow().show() + setFocus()` 把隐藏窗口拉回前台；4 个新测试覆盖（提示词压缩/截断、前台跳过、后台发送、点击聚焦）。

**Stats**: 473/473 frontend tests passing（alpha-33a 465 → alpha-33b +8，新增 3 个 SSE 错误分类 + 4 个通知 + 1 个已合并）、164/164 Rust lib + integration tests passing（133 + 12 + 19，含 5 个新 attachment round-trip + cascade 测试）；production build 通过（JS 1.24 MB / CSS 58.49 kB），`cargo check` 通过。

---
## alpha-33a（已合并 — [PR #1](https://github.com/xyshanren/hermes-tray/pull/1) squash）

- **前端体验修复**：persona 欢迎卡选择、粘贴图片附件、附件布局、30 秒健康检查防止选中文本丢失、用户气泡右对齐、assistant Markdown 源码复制。
- **Markdown 样式完善**：段落、标题层级、链接、列表、task list、表格、分隔线和 inline code 样式补全。
- **输出文件路径问题记录**：确认临时文件和最终文档落入 WSL home 顶层的根因跨越 tray 与 hermes-agent-cn；新增联合 workspace/output policy，待 agent-cn K-6 先定义工具执行 cwd、路径安全和 artifact SSE schema 后，由 tray alpha-34+ 接入。
---

## v0.2.2 (2026-07-27)

**v0.2.1 上的 patch** — rebrand 真正走到 binary (产品名/zh-CN installer/tray tooltip 都跟),外加 master CI 红了一段的 alpha-23/31 drift 全清。装 v0.2.1 的用户**不用强升**(业务代码 0 改动);想要中文产品名 / zh-CN MSI / 装/卸一致中文界面的装这版。

- **rebrand + zh-CN MSI 落地** (`e040736`) — 4 个文件:
  - `src-tauri/tauri.conf.json`: productName `hermes-tray-tauri` → `Hermes 助手`;version `0.2.0` → `0.2.1`(v0.2.1 release 时漏补的修);identifier → `com.admin.hermes-tray`;window title `Hermes 助手`;`bundle.windows.wix.language: ["zh-CN"]`
  - `src-tauri/Cargo.toml`: name `hermes-tray-tauri` → `hermes-tray`;version `0.2.0` → `0.2.1`;description 重写
  - `src-tauri/src/lib.rs:1544`: tray tooltip `"Hermes Tray - Hermes 助手"` → `"Hermes 助手"`(去掉 hardcoded 重复)
  - `src/config.ts`: `productName: 'Hermes Chat'` → `'Hermes 助手'`
  - 中途 `bundle.wix` 错位置被 Tauri 2 schema 拒,改 `bundle.windows.wix`
- **docs sync** (`374056a`) — HANDOFF.md / ROADMAP.md / AGENTS.md headers 同步 "v0.2.0 STABLE + v0.2.1 patch shipped + next v0.3.0 cycle"
- **CHANGELOG.md + release.yml 修相对路径坑** (`198490b`) — release.yml 改绝对 URL 模板(`softprops/action-gh-release` 在 release page 上 relative link 会 404);CHANGELOG 加 v0.2.0 STABLE + v0.2.1 entries;v0.1.4/v0.1.5 "Full notes" 链接改绝对 URL;`gh release edit --notes-file` 重传 4 个 release body;CHANGELOG.md 顺序 v0.2.x 移到 top
- **ROADMAP.md anchor** (`be63d3d`) — Phase 1 加 "aimc SSE 注入 + tray 端 consumed" (~0.8d cross-project);记录 v0.2.1.1 post-release rebrand 不打 hotfix tag(走 D 方案)
- **gitignore** (`626d4dd`) — `.qoder/` (Qoder IDE repowiki cache) 加进既有 `.mavis/ .atomcode/ .agent-teams/` 同段
- **master CI 修复 (alpha-23/31 drift sweep)** (`e283d61`) — 4 文件清 23 errors:
  - `src-tauri/src/db/project.rs:506` `clippy::manual_strip` 1 line(用 `strip_prefix` 替 `starts_with + &s[4..]`)
  - `src-tauri/src/db/session.rs:275` `unused_imports`(删 `use super::*;`,inline tests 早就不用 super 任何东西)
  - 20 E0061 sites: 18 in `tests/db_session_message_test.rs` + 2 in `tests/db_persona_config_feedback_test.rs`(alpha-23 加了 `model: Option<&str>` 第 5 参数,只改了 src/db/session.rs::tests inline,integration test 漏 sweep)
  - 1 E0063 site: `tests/db_session_message_test.rs:719` 的 TokenStats 字面量缺 `unknown_model_buckets` 字段
- **version bump** — 这次 release bump 0.2.1 → 0.2.2 (`tauri.conf.json` + `Cargo.toml`)。`package.json` 0.2.0-beta 保留(internal alpha-style 编号,e040736 rebrand 当时也没动)

**Stats**: 464/464 frontend + 133/133 Rust lib 测试 pass;`cargo clippy --all-targets -- -D warnings` **0 errors**;`cargo test --no-run` 4 个 test executable 编译通过(lost `pauseWhenPageIsHidden` 历史 build fix + tech debt)。Bundle 1.23 MB JS / 55.41 kB CSS(跟 v0.2.1 一致,业务代码 0 改动,纯 housekeeping)。

---

## v0.2.1 (2026-07-21)

**v0.2.0 STABLE 上的 patch** — 用户在 v0.2.0 发布后手动验证时发现的 5 个 post-release fix,加 1 个 cherry-pick 冲突解决附带的 build fix。

- **fix: 语音转写参数名不匹配** (`2c0f4a8`) — 前端原来发 camelCase 的 `audioBase64` / `mimeType`,但 Rust `TranscribeArgs` struct 是 snake_case 的 `audio_base64` / `mime_type` 而且没 `serde(rename_all)`,每次录音都反序列化失败。改前端发 snake_case,后端保持冻结。
- **fix: error toast 关不掉** (`2c0f4a8`) — error toast 用 `duration: Infinity`(设计上手动关闭),但 Sonner Toaster 没 `closeButton`,红色的 OctagonX 状态图标被误当成关闭按钮。给 Toaster 加 `closeButton`,每个 toast 都有真 × 按钮。
- **feat: footer 显示 SSE 实际路由的 model** (`b4cae62`) — footer 的 model pill 之前在重连后读的是本地 `defaultModel` fallback;现在绑到 SSE `routing_decision.model` chunk 实际选的 model,pill 跟当前 session 的服务方对齐。
- **feat: 分享链接加 paste 入口** (`aa9892c`) — 分享链接 import 弹窗加 paste 框,除 URL hash 自动检测外,可以直接贴复制的链接内容。
- **style: persona 库改单列竖排** (`cb4b60e`) — 替换原本在窄视口下会破版的 2 列网格。
- **fix: 删 `pauseWhenPageIsHidden`** (`2790386`) — sonner 2.0.7 的 `ToasterProps` 不声明这个 prop。这个 prop 之前在 `b911ee2`(v0.2-beta-pre-release)就因为同样的 TS2322 被删过,这次 cherry-pick `2c0f4a8` 用 `--theirs` 解决冲突时又被带回来了。`closeButton`(`2c0f4a8` 的实际修改)保留,只删掉 `pauseWhenPageIsHidden` 这行死的。

**Stats**: 464/464 frontend + 133/133 Rust lib 测试 pass。Bundle 1.23 MB JS / 55.41 kB CSS(chunk size warning,1.5 MB 预算内)。v0.2.0 STABLE 仍然 tag 在 `d7ee96f` 给 8/8 验证基线做可复现锚点;v0.2.1 给需要 patch 的人用。

---

## v0.2.0 (2026-07-21) — STABLE

**v0.2 STABLE — 8/8 手动 MSI 验证全过** (commit `d7ee96f`, tag `v0.2.0`)。完整 Preact 重写 v0.1.5 的 vanilla-DOM 前端,外加长尾清理。v0.2 历经 33 个 alpha(alpha-0 ~ alpha-32.4);最后一天下午压成 5 个 alpha-3x drop(32, 32.1, 32.2, 32.3, 32.4) — 用户装完 alpha-32 msi 立刻暴露 bug 触发的加速发布。

- **前端重写 (Tauri 2 + Preact 10 + Vite + Tailwind v3 + shadcn/ui via preact/compat)** — 11 个视图全从 innerHTML vanilla DOM 迁到 Preact JSX。main.ts: 2681 行(v0.1.5) → 1294 行(alpha-19) → ~1350 行(收尾后),净减 ~50%。
- **原生 `window.confirm()` / `alert()` 全清** — confirm modal(alpha-19) + share-import modal(alpha-15) 覆盖最后 2 个 callsite。
- **Tauri 2 插件**: `tauri-plugin-window-state`(alpha-22)、`tauri-plugin-shell`、`tauri-plugin-fs`、`tauri-plugin-global-shortcut`(alpha-32.4)、`tauri-plugin-dialog`(alpha-32,backup 原生 file picker)。
- **设置弹窗重设计 (alpha-11 ~ alpha-13, alpha-25)** — 4 个组:连接(自动 vs 远程 radio toggle) / 新建会话默认值 / 偏好(主题 + 货币 + 启动时自动连接 + 自动重命名) / 数据危险操作区。后端 `db_config_set` 本来就是 generic key-value,不需新 Tauri command。
- **备份弹窗 (alpha-9 + alpha-32)** — 分离卡片(非 tab nav)按 AGENTS.md §4 硬性要求。原生 `tauri-plugin-dialog` file picker;2 步恢复确认(verify badge + checkbox + 5s 倒计时)。14+ 条 CSS 规则补全;弹窗 560px / max-height 90vh。
- **5 个 alpha-3x 手动 MSI 验证触发的 hotfix** — 32.1 干掉 Linux + macOS matrix;32.2 修 WebView2 双眼睛、密码 mismatch 误触发、设置 close-on-open;32.3 打磨"默认项目路径是 metadata 不是 storage"UX(📂 chip + ℹ️ 强调 + 📂 数据存储位置 collapsible);32.4 把 2 个死开关接上 + DB migration 0005 修 `\?\` 前缀。
- **设计 token 重写 (alpha-24)** — `--primary #5B6CFF` → `#4338CA`(indigo-700);`--bg-primary` light/dark 对齐 SVG 01/02 palette;所有 `@media (prefers-color-scheme)` → `.dark` class。
- **消息气泡对齐修复 (alpha-25)** — `.message.user` `align-self: flex-end`(原本错写成 `flex-start`);user 气泡去掉 avatar。
- **CJK hljs 可见性 (alpha-30/31.1)** — `message-content pre a/strong/em` 之前被叠了 `color: var(--primary)`;强制 `color: inherit` + `pre { background: var(--code-bg) }`。
- **DB migration 0005: strip Windows verbatim prefix** (alpha-31 + alpha-32.4) — SQLite JSON1 `json_extract` + `substr` + `json_replace` 给 alpha-13..30 写的 `sessions.project_context` 旧行 retro-fix。WHERE clause 幂等。
- **4 个安全弹窗 click-outside 关闭 (alpha-32.5 → 收尾)** — settings / search / shortcuts / stats。confirm / persona / backup 故意不做(unsaved state)。

**Stats**: 451/451 frontend(v0.1.5 是 408)+ 133/133 Rust lib 测试 pass。Bundle 1.20 MB JS / 53.13 kB CSS。完整 v0.2-alpha-3x 时间线 + 5 条经验教训见 [HANDOFF.md](https://github.com/xyshanren/hermes-tray/blob/v0.2.0/HANDOFF.md)。

---

## v0.1.5 (2026-07-03)

**S12 metadata 增强 — 7 个新 stats tile + by_rule breakdown + per-turn CLI bar** — 配合 hermes-agent-cn NEEDS_BACKLOG §需求 1 (commits `a192442d8` + `b49ef1a31`) 收尾 S12 P3 (tray T-Q-S9 真值替换)。
- **真实 cost 落地**: SSE `usage.cost_estimate_usd` 顶层真值 + `routing_decision.cost_threshold_exceeded` 写到 `messages.cost_estimate_usd REAL` + `cost_threshold_exceeded INTEGER` 单独列 (schema v4 迁移); 同样字段镜像到 `messages.metadata` JSON blob 给 legacy json_extract 读者.
- **7 个新 stats tile**: 本月 Cost (S12 真值 / 预估成本自动切换 label) / Fallback 命中率 / 平均 Latency / Cost Threshold 触发 — 4 个 S12 新 tile + S14 已有 2 个 + 1 个原有 = 7 个 new total surface; 4 个新 aggregate 走 `compute_token_stats` 一次扫表, 不开新 Tauri command.
- **By Rule breakdown**: `routing_decision.rule_id` group by, 命中数 / 成本 (USD), hit_count DESC; pre-S12 messages bucket 到 `no_rule`.
- **Per-turn CLI bar**: assistant 消息下方一行 muted 文字 `💰 $0.0234 · ⏱ 3.4s · 🛡 vision_fallback_config`; threshold breach 加 `message-bar-warn` CSS class (amber). 缺数据时不显示 (pre-S12 message 无 bar).
- **123 vitest + 150 cargo 测试 pass** (16 new: 4 backend S12 + 12 messageBar). cargo fmt + clippy -D warnings clean.

Full notes: [docs/RELEASE_v0.1.5.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.5/docs/RELEASE_v0.1.5.md)

---

## v0.1.4 (2026-07-03)

**S14-agent 集成 — image_tokens + routing_decision + 多图 UI 提示** — 配合 hermes-agent-cn NEEDS_BACKLOG §需求 3 (commits `a716f33e6` + `125cc93c0` + `8882270e7`) 收尾。
- **真实 usage 落地**: SSE `usage` chunk 现在被消费，tray 把 `prompt_tokens + completion_tokens` 写回 `messages.tokens`（替换之前的 char/4 启发式），session `total_tokens` 跟着 delta 调整。
- **图片 cost 可视化**: stats modal 加 "图片 Token (S14)" tile + "最近 Vision" trace（`vision native: openai/gpt-5` / `vision fallback: anthropic/claude-opus-4-6 (primary primary_unavailable)` + `3.4s` latency badge）。
- **多图 UI 提示**: 用户拖图达到 `max - 2` (4-2=2) 时显示 info toast 提示用 vision_analyze 预生成描述，超过 max 仍 block 提交。
- **数据层**: `messages.metadata` JSON blob 复用（之前 unused），`record_usage` Tauri command + Rust `MessageDao::record_usage` 增量更新 image_tokens / routing_decision / elapsed_ms。
- **111 vitest + 14 cargo 测试 pass**（4 new multimodal scenarios 1/4/16/50 + 9 attachmentLimit + 8 routingTrace + 4 record_usage）。

Full notes: [docs/RELEASE_v0.1.4.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.4/docs/RELEASE_v0.1.4.md)

---

## v0.1.3 (2026-07-03)

**S5+ quick capture global shortcut** — `Ctrl+Shift+H` 现在直接开新会话（不只是唤起），复用 `createSession()` 路径。
**S13 升级** — `hermes_proxy_transcribe` Rust command 提取 2 个 pure helper (`pick_audio_extension` / `parse_openai_transcribe_response`) + 10 个 unit test，锁住 OpenAI-shape 协议契约。
**Version bump** — `package.json` / `Cargo.toml` / `tauri.conf.json` 三处从 0.1.0 升到 0.1.3（之前 git tag 跟 binary filename 不一致）。

Full notes: [docs/RELEASE_v0.1.3.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.3/docs/RELEASE_v0.1.3.md)

---

## v0.1.2 (2026-06-26)

**Tauri 2.x 完整 v2.0 基础 + S0-S10 + S12-light + S13 + S14 多模态** — SQLite + FTS5 + Persona 库 + Project context 扫描 + Token / 成本追踪 + 导出/分享 + 加密本地备份 + 模型选择器 + 语音输入 + 图片拖拽上传。
**408 tests baseline** — Rust 230 + Frontend 129 + src-tauri 49。URMP 5 乐器 CREPE avg 77.87；RAG/VLM 端到端通。

Full notes: [docs/RELEASE_v0.1.2.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.2/docs/RELEASE_v0.1.2.md)

---

## v0.1.1 (2026-06-23)

**T-Q-NEW config location fix** — `write_config_json` 改用 `app_config_dir()` (Tauri 2 canonical path)，修 MSI 安装到 `C:\Program Files\` 时 silent write 失败。
**Legacy fallback** — exe dir + CWD 读，保证 v0.1.0 用户升级保留设置。

Full notes: [docs/RELEASE_v0.1.1.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.1/docs/RELEASE_v0.1.1.md)

---

## v0.1.0 (2026-06-05)

**首个公开版本** — Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn gateway)。
- 全栈：Rust backend (Tauri commands) + Svelte frontend + SQLite DB + WSL gateway proxy
- 基础：session list / message / FTS5 搜索 / global shortcut (`Ctrl+Shift+H` 唤起窗口，**v0.1.3 升级为 quick capture**)

Full notes: [docs/RELEASE_v0.1.0.md](https://github.com/xyshanren/hermes-tray/blob/v0.1.0/docs/RELEASE_v0.1.0.md)
