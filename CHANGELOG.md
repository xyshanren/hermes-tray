# Hermes Tray — CHANGELOG

> Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn). 全栈：[frontend (Svelte + Vite) + Tauri (Rust) + SQLite FTS5 + WebView2].
>
> 完整 release notes 落在 `docs/RELEASE_vX.Y.Z.md`。

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
