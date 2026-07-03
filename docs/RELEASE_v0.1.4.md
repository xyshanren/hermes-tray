# hermes-tray v0.1.4 — Release Notes (FINAL)

> **状态**: ✅ FINAL — release candidate 准备就绪
> **发布日期**: 2026-07-03
> **配合版本**: hermes-agent-cn v0.17.0+cn.19 (commits `a716f33e6` + `125cc93c0` + `8882270e7`)

---

## TL;DR

v0.1.4 收尾 hermes-agent-cn S14 vision 完整闭环，tray 端把"图片 cost"、"vision 路由决策"、"多图 UI 提示"全部 surface 出来。

| 项目 | Commit | 摘要 |
|---|---|---|
| hermes-agent-cn (cn) | `a716f33e6` | Phase 1: image_tokens 解析 + SSE `usage.prompt_tokens_details.image_tokens` + `sessions.image_tokens` 列 |
| hermes-agent-cn (cn) | `125cc93c0` | Phase 2: vision `routing_decision` metadata (mode/primary/resolved/fallback_used/fallback_reason) + `elapsed_ms` |
| hermes-agent-cn (cn) | `8882270e7` | Phase 3: 多图 limit 校验 (per-model `_MODEL_MAX_IMAGES` 表 + config `agent.vision_max_images` 覆盖) + `TooManyImagesError` pre-flight |
| hermes-agent-cn (cn) | `dc48fbc65` | Phase 4: 集成 test + CHANGELOG_CN v0.17.0+cn.19 段 + NEEDS_BACKLOG §需求 3 标 done |
| **hermes-tray (master)** | `97b5636` | **S14 phase 1: 消费 SSE `usage` + 持久化 image_tokens / routing_decision** |
| **hermes-tray (master)** | `7871850` | **S14 phase 2: stats modal 渲染 image_tokens + routing_decision + latency** |
| **hermes-tray (master)** | `a685127` | **S14 phase 3+4: 多图 UI 提示 (1/4/16/50 scenarios + approaching-limit warning)** |
| **hermes-tray (master)** | (this commit) | **v0.1.4 version bump + CHANGELOG + release notes** |

---

## 范围 (final)

### ✅ 包含

#### 1. SSE `usage` 消费 + 真实 token 落地

**Commit:** `97b5636` on `master`
- **Before**: tray 用 `estimate_tokens(content)` = `len / 4` 启发式写 `messages.tokens`，agent 的真实 usage 被 SSE 解析时直接丢弃 (`handleStreamChunk` 只取 `delta.content`)
- **After**: 解析 OpenAI 协议 final-chunk 的 `usage` 对象 + S14 顶层 `routing_decision` / `elapsed_ms`，存到 `state.lastStreamUsage`，`finishStream` 调新 Tauri command `message_record_usage` 替换 char/4 估计

关键文件:
- `src/main.ts` `handleStreamChunk` L2154 — 加 `json.usage` + 顶层 `routing_decision` 提取
- `src/main.ts` `finishStream` L2175 — 调 `message_record_usage` 写入真实值
- `src-tauri/src/db/message.rs` `record_usage` — 事务性更新 `messages.tokens` + `messages.metadata` + 调整 `sessions.total_tokens` by delta
- `src-tauri/src/db/dao.rs` MessageDAO trait 加 `record_usage` 方法
- `src-tauri/src/db/commands.rs` 新 `message_record_usage` Tauri command
- 字段合并: `merge_usage_metadata` helper 保留 `messages.metadata` 已有 keys (e.g. T-Q-S14 attachment index) + 注入 `image_tokens` / `routing_decision` / `elapsed_ms`

#### 2. Stats modal 渲染 image_tokens + routing_decision

**Commit:** `7871850` on `master`
- 新 "图片 Token (S14)" tile，显示本周期所有 image_part token 累计
- 新 "最近 Vision" tile: 渲染 `vision native: openai/gpt-5` / `vision fallback: anthropic/claude-opus-4-6 (primary primary_unavailable)` + `3.4s` latency badge
- 后端 aggregation 通过 `json_extract(m.metadata, '$.image_tokens')` 在主 SQL 查询里 sum
- 单独查询 `routing_decision` / `elapsed_ms` 最 recent 一次 (ORDER BY created_at DESC LIMIT 1)
- 新 helper `formatRoutingTrace()` / `formatLatencyMs()` 暴露给 vitest

关键文件:
- `src-tauri/src/db/token.rs` TokenStats 加 3 字段 (`total_image_tokens` / `recent_routing_decision` / `recent_elapsed_ms`)
- `src-tauri/src/db/commands.rs` `compute_token_stats` 改造 SQL
- `src/main.ts` `renderStatsModal` 渲染新 tile

#### 3. 多图 UI 提示 (T-Q-S14 集成)

**Commit:** `a685127` on `master`
- 4 new image-count scenarios: 1/4/16/50 张图分别构建正确 OpenAI-shape multimodal content
- 50 张图 (over GPT-5 limit) tray 仍正确构建, 实际拒绝由 agent 端 `TooManyImagesError` 422
- `evaluateAttachmentLimit(currentCount, addingCount, max)` pure helper:
  - `ok` — 未达 warn threshold
  - `warn` — `max - 2` 转换点 fire (避免 stack toast, 已在 zone 内不重复)
  - `block` — 超过 max 时
- `addAttachments` 调 evaluate, `warn` 弹 info toast (用 vision_analyze 提示), `block` 弹 error toast

#### 4. 测试覆盖

| 类别 | New cases | File |
|---|---|---|
| 真实 usage 落地 | 4 | `src-tauri/tests/db_session_message_test.rs` (record_usage_*) |
| Routing trace 格式化 | 8 | `src/routingTrace.test.ts` |
| 多图 scenarios | 4 | `src/multimodal.test.ts` (image-count) |
| Attachment limit | 9 | `src/attachmentLimit.test.ts` |
| **合计** | **25** | |

**总数**: 111 vitest + 14 cargo = **125/125 passed**

#### 5. Version bump

3 files: `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 从 `0.1.3` → `0.1.4`

### ❌ 不包含（决策到后续版本）

- **真实网络集成测试** — 需要 hermes-agent-cn gateway 同时跑, CI 还没 setup; 现有测试都是 vitest 单元 + cargo db 集成
- **tray 端 v0.1.4 真实 bundle + release 上传** — 需要 gh CLI 登录 user 端 (gh 2.96 用 Windows Credential Manager 存 token, mavis session 拿不到), 留给 user 跑 `gh release upload`
- **S12 routing metadata (cost / latency / retries) 推到 tray** — NEEDS_BACKLOG §1, 独立任务

---

## 决策点 (decision made 2026-07-03)

| Decision | Final pick | 理由 |
|---|---|---|
| 真实 usage 替换 char/4? | **✅ v0.1.4** | 之前 char/4 完全估不准 (image / cache / reasoning 都漏); agent 真实值可用, 必须落地 |
| Tray local image cap (4) 是否提到 16? | **❌ 维持 4** | 4 张 × 5MB = 20MB SSE upload 已很大, 16 张 = 80MB 会卡; S14 agent 16 张是 **count** 上限, tray 4 张是 **payload** 上限, 两个独立 |
| 接近上限的 warning toast 用什么 level? | **info** | 不是 block, 用户可继续; 但要提示 "考虑 vision_analyze 预生成描述" |
| 警告 toast 是否每次 add 都弹? | **只在转换点** | 避免 drag 4 张图 stack 3 个 toast; `evaluateAttachmentLimit` 已在 zone 内不重弹 |
| 跟 v0.1.3 release notes 模式? | **互引** | hermes-tray v0.1.4 release notes 引用 hermes-agent-cn v0.17.0+cn.19; 跨项目协调但不强制 lockstep |
| Tag 命名 | `v0.1.4` (hermes-tray 单独) + 不重打 `v0.17.0+cn.19` (已在 cn branch 4 commit) | 维持现有 tag 节奏 |

---

## 升级路径 (v0.1.3 → v0.1.4)

| 字段 | v0.1.3 | v0.1.4 | 迁移影响 |
|---|---|---|---|
| `messages.tokens` | char/4 估计 | 真实 usage (替换) | 历史 messages 保留 char/4 估计, 新 messages 写真实值; 一次性纠正 |
| `messages.metadata` | unused | JSON blob (image_tokens / routing_decision / elapsed_ms) | 老 messages metadata = NULL, 新 messages 自动写入 |
| `TokenStats.total_image_tokens` | 字段不存在 | 0 (SQL json_extract 读 NULL metadata) | 老的统计 0, 新的累计 |
| `TokenStats.recent_routing_decision` | 字段不存在 | None | 老的 None, 新的有 JSON |
| `TokenStats.recent_elapsed_ms` | 字段不存在 | None | 老的 None, 新的有 ms |

**降级兼容**: 前端 `TokenStats` interface 用 optional + `?? ''` / `?? null` 防御, 老 DB 自动兼容 (json_extract 读 NULL 返回 0 / NULL)。

---

## 安装包 (post-tag)

`gh release create v0.1.4` 后的 3 个 binary (CI 跑)：
- `hermes-tray-tauri_0.1.4_x64_en-US.msi` (Windows MSI)
- `hermes-tray-tauri_0.1.4_x64-setup.exe` (NSIS installer)
- `hermes-tray-tauri_0.1.4_x64.exe` (Portable)

> gh 2.96 在 Windows 上用 Windows Credential Manager (DPAPI) 存 oauth_token, **mavis session 拿不到**, binary 上传需要 user 跑。命令清单: `GH_RELEASE_UPLOAD.md` (root) — 跟 v0.1.3 同流程, 把 `v0.1.3` 替换为 `v0.1.4` 即可。

---

## 下一步

- **NEEDS_BACKLOG §1 S12-agent 路由决策透传** (3-5 天) — 跟 v0.1.4 同 pattern, 但扩到主调用 (cost / latency / retries) 而不只是 vision
- **NEEDS_BACKLOG §4 S15-agent Plugin Marketplace MVP** (1-2 天) — 独立产品决策
- **hermes-tray v0.1.5 plan** — T-Q-S12-agent 集成 (S12 metadata 推到 stats modal 加 by_provider 饼图)
- **CI 端到端集成测试 setup** — hermes-tray CI + hermes-agent-cn CI 跑 cross-project integration test
