# Hermes Tray — CHANGELOG

> Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn). 全栈：[frontend (Svelte + Vite) + Tauri (Rust) + SQLite FTS5 + WebView2].
>
> 完整 release notes 落在 `docs/RELEASE_vX.Y.Z.md`。

---

## v0.1.5 (2026-07-03)

**S12 metadata 增强 — 7 个新 stats tile + by_rule breakdown + per-turn CLI bar** — 配合 hermes-agent-cn NEEDS_BACKLOG §需求 1 (commits `a192442d8` + `b49ef1a31`) 收尾 S12 P3 (tray T-Q-S9 真值替换)。
- **真实 cost 落地**: SSE `usage.cost_estimate_usd` 顶层真值 + `routing_decision.cost_threshold_exceeded` 写到 `messages.cost_estimate_usd REAL` + `cost_threshold_exceeded INTEGER` 单独列 (schema v4 迁移); 同样字段镜像到 `messages.metadata` JSON blob 给 legacy json_extract 读者.
- **7 个新 stats tile**: 本月 Cost (S12 真值 / 预估成本自动切换 label) / Fallback 命中率 / 平均 Latency / Cost Threshold 触发 — 4 个 S12 新 tile + S14 已有 2 个 + 1 个原有 = 7 个 new total surface; 4 个新 aggregate 走 `compute_token_stats` 一次扫表, 不开新 Tauri command.
- **By Rule breakdown**: `routing_decision.rule_id` group by, 命中数 / 成本 (USD), hit_count DESC; pre-S12 messages bucket 到 `no_rule`.
- **Per-turn CLI bar**: assistant 消息下方一行 muted 文字 `💰 $0.0234 · ⏱ 3.4s · 🛡 vision_fallback_config`; threshold breach 加 `message-bar-warn` CSS class (amber). 缺数据时不显示 (pre-S12 message 无 bar).
- **123 vitest + 150 cargo 测试 pass** (16 new: 4 backend S12 + 12 messageBar). cargo fmt + clippy -D warnings clean.

Full notes: [docs/RELEASE_v0.1.5.md](./blob/v0.1.5/docs/RELEASE_v0.1.5.md)

---

## v0.1.4 (2026-07-03)

**S14-agent 集成 — image_tokens + routing_decision + 多图 UI 提示** — 配合 hermes-agent-cn NEEDS_BACKLOG §需求 3 (commits `a716f33e6` + `125cc93c0` + `8882270e7`) 收尾。
- **真实 usage 落地**: SSE `usage` chunk 现在被消费，tray 把 `prompt_tokens + completion_tokens` 写回 `messages.tokens`（替换之前的 char/4 启发式），session `total_tokens` 跟着 delta 调整。
- **图片 cost 可视化**: stats modal 加 "图片 Token (S14)" tile + "最近 Vision" trace（`vision native: openai/gpt-5` / `vision fallback: anthropic/claude-opus-4-6 (primary primary_unavailable)` + `3.4s` latency badge）。
- **多图 UI 提示**: 用户拖图达到 `max - 2` (4-2=2) 时显示 info toast 提示用 vision_analyze 预生成描述，超过 max 仍 block 提交。
- **数据层**: `messages.metadata` JSON blob 复用（之前 unused），`record_usage` Tauri command + Rust `MessageDao::record_usage` 增量更新 image_tokens / routing_decision / elapsed_ms。
- **111 vitest + 14 cargo 测试 pass**（4 new multimodal scenarios 1/4/16/50 + 9 attachmentLimit + 8 routingTrace + 4 record_usage）。

Full notes: [docs/RELEASE_v0.1.4.md](./blob/v0.1.4/docs/RELEASE_v0.1.4.md)

---

## v0.1.3 (2026-07-03)

**S5+ quick capture global shortcut** — `Ctrl+Shift+H` 现在直接开新会话（不只是唤起），复用 `createSession()` 路径。
**S13 升级** — `hermes_proxy_transcribe` Rust command 提取 2 个 pure helper (`pick_audio_extension` / `parse_openai_transcribe_response`) + 10 个 unit test，锁住 OpenAI-shape 协议契约。
**Version bump** — `package.json` / `Cargo.toml` / `tauri.conf.json` 三处从 0.1.0 升到 0.1.3（之前 git tag 跟 binary filename 不一致）。

Full notes: [docs/RELEASE_v0.1.3.md](./blob/v0.1.3/docs/RELEASE_v0.1.3.md)

---

## v0.1.2 (2026-06-26)

**Tauri 2.x 完整 v2.0 基础 + S0-S10 + S12-light + S13 + S14 多模态** — SQLite + FTS5 + Persona 库 + Project context 扫描 + Token / 成本追踪 + 导出/分享 + 加密本地备份 + 模型选择器 + 语音输入 + 图片拖拽上传。
**408 tests baseline** — Rust 230 + Frontend 129 + src-tauri 49。URMP 5 乐器 CREPE avg 77.87；RAG/VLM 端到端通。

Full notes: [docs/RELEASE_v0.1.2.md](./blob/v0.1.2/docs/RELEASE_v0.1.2.md)

---

## v0.1.1 (2026-06-23)

**T-Q-NEW config location fix** — `write_config_json` 改用 `app_config_dir()` (Tauri 2 canonical path)，修 MSI 安装到 `C:\Program Files\` 时 silent write 失败。
**Legacy fallback** — exe dir + CWD 读，保证 v0.1.0 用户升级保留设置。

Full notes: [docs/RELEASE_v0.1.1.md](./blob/v0.1.1/docs/RELEASE_v0.1.1.md)

---

## v0.1.0 (2026-06-05)

**首个公开版本** — Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn gateway)。
- 全栈：Rust backend (Tauri commands) + Svelte frontend + SQLite DB + WSL gateway proxy
- 基础：session list / message / FTS5 搜索 / global shortcut (`Ctrl+Shift+H` 唤起窗口，**v0.1.3 升级为 quick capture**)

Full notes: [docs/RELEASE_v0.1.0.md](./blob/v0.1.0/docs/RELEASE_v0.1.0.md)
