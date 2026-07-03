# hermes-tray v0.1.5 — Release Notes (FINAL)

> **状态**: ✅ FINAL — release candidate 准备就绪
> **发布日期**: 2026-07-03
> **配合版本**: hermes-agent-cn v0.17.0+cn.20 + v0.17.0+cn.21 (S12 P1 + P2 cost-aware routing)
> **不依赖**: S15 plugin marketplace (按 HANDOFF.md §2.1 决定 v0.1.5 不做, 推到 v0.1.6+)

---

## TL;DR

v0.1.5 把 hermes-agent-cn S12 (cost-aware routing) + S14 (vision metadata) 的真实数据落到 tray 端: **7 个新 stats tile + 1 个 by-rule breakdown + 1 个 per-turn CLI bar**。所有 cost / fallback / latency / threshold 指标都是 SQL 一次扫表算出来的真值, 替换 v0.1.4 之前的 char/4 heuristic。

| 项目 | Commit | 摘要 |
|---|---|---|
| hermes-agent-cn (cn) | `a192442d8` | S12 P1: routing_decision mutation hooks + SSE 推送 |
| hermes-agent-cn (cn) | `b49ef1a31` | S12 P2: cost-aware fallback rule + threshold annotations |
| **hermes-tray (master)** | `e265f80` | **P1 backend: S12 cost columns + 4 aggregates + by_rule breakdown** |
| **hermes-tray (master)** | `3df45c0` | **P2 frontend: 4 new stats tiles + by_rule table + CLI bar** |
| **hermes-tray (master)** | (this commit) | **v0.1.5 version bump + CHANGELOG + release notes** |

---

## 范围 (final)

### ✅ 包含

#### 1. Schema migration v0.1.5: messages.cost_estimate_usd + cost_threshold_exceeded

**Commit:** `e265f80` on `master`
- New migration `0004_add_cost_metadata.sql` adds 2 first-class columns to `messages`:
  - `cost_estimate_usd REAL NOT NULL DEFAULT 0.0` — real USD per turn (from S12 SSE `usage.cost_estimate_usd`)
  - `cost_threshold_exceeded INTEGER NOT NULL DEFAULT 0` — S12 cost-aware fallback breach flag (0/1)
- Registered in `schema.rs` MIGRATIONS array; `CURRENT_SCHEMA_VERSION` bumped 3 → 4
- **Why columns, not JSON blob:** the stats modal aggregates SUM / COUNT / AVG on these fields per period; reading from `messages.metadata` via `json_extract` works but is per-row JSON parsing. First-class columns keep period-aggregate SQL O(1) per row.
- **Backwards compat:** migration is embedded at compile time (v0.1.4 hotfix 6395568 pattern), so MSI-installed binaries don't need `migrations/` next to them. The `merge_usage_metadata` helper still mirrors the new fields into `metadata.routing_decision.cost_*` so legacy `json_extract(routing_decision.cost_threshold_exceeded)` queries keep working.

#### 2. message_record_usage 扩展: cost_estimate_usd + cost_threshold_exceeded

**Commit:** `e265f80` on `master`
- 2 new params added to `MessageDAO::record_usage` (f64 + bool) and the `message_record_usage` Tauri command
- Both fields written to dedicated columns AND mirrored into the metadata JSON blob (top-level `cost_estimate_usd` + inside `routing_decision`)
- 2 new tests in `db_session_message_test.rs` (persists_s12_cost_columns / persists_threshold_flag_set) — verify column write + metadata mirror + boolean-as-1-encoding + threshold-overrides-blob invariant

#### 3. compute_token_stats 扩展: 4 new aggregates + by_rule breakdown

**Commit:** `e265f80` on `master`
- `TokenStats` (in `src-tauri/src/db/token.rs`) gains 5 new fields:
  - `period_cost_total_usd: f64` — sum of `cost_estimate_usd` over the period (real USD)
  - `fallback_hit_rate: f64` — `[0.0, 1.0]`, count(routing_decision.fallback_used=true) / count(routing_decision IS NOT NULL)
  - `avg_latency_ms: f64` — average of `messages.metadata.elapsed_ms`
  - `cost_threshold_count: i64` — count of `cost_threshold_exceeded = 1`
  - `by_rule: Vec<RuleBucket>` — per-rule breakdown, sorted by hit_count DESC
- `compute_token_stats` reads all 4 in the SAME scan as the existing per-day / per-model / image_tokens query — no extra DB round-trips. One separate query for the by_rule group-by.
- 1 new test (token_stats_aggregates_s12_cost_fields) — seeds 3 messages with distinct rule_ids, verifies SUM / COUNT / AVG / group-by all return expected values
- 1 new test (migrations_apply_v4_cost_columns) — verifies schema_version reaches 4 + defaults are 0 / 0.0

#### 4. Stats modal: 4 new tiles + by_rule breakdown

**Commit:** `3df45c0` on `master`
- **本月 Cost (S12)** tile — real USD from `period_cost_total_usd`; falls back to char/4 `total_cost` (label flips to "预估成本") on pre-S12 DBs that have no S12 cost data
- **Fallback 命中率 (S12)** tile — integer percent of `fallback_hit_rate`; sub-line "已 fallback / 已路由"
- **平均 Latency (S12)** tile — 1-decimal seconds from `avg_latency_ms`; sub-line "来自 elapsed_ms 平均"
- **Cost Threshold 触发** tile — integer count of `cost_threshold_count`; sub-line "本周期内无超支" when 0
- **By Rule (S12)** table — new breakdown grouped by `routing_decision.rule_id`, sorted by hit_count DESC, columns: 规则 / 命中数 / 成本 (USD). Pre-S12 messages bucket under `no_rule` so the breakdown always renders something useful

#### 5. Per-turn CLI bar

**Commit:** `3df45c0` on `master`
- One-line muted bar under each assistant message:
  - Format: `💰 $0.0234 · ⏱ 3.4s · 🛡 vision_fallback_config`
  - Each segment is omitted when its field is missing (0 cost / null latency / null rule_id) — pre-S12 messages get no bar at all
  - Threshold breach adds `🛡 cost_threshold_exceeded` when rule_id missing, and `message-bar-warn` CSS class (amber color) for visual emphasis
- Pure formatter `formatMessageBar()` + thin DOM wrapper `buildMessageBar()` — pure function is unit-testable without a DOM
- `finishStream` extracts `cost_estimate_usd` from `usage` top-level, `cost_threshold_exceeded` + `rule_id` from `routing_decision`, passes all 3 to `message_record_usage`, then renders the bar AFTER the DB write resolves
- 12 new vitest tests in `src/messageBar.test.ts` (trio / cost-only / latency-only / rule-only / sub-second / hidden-zero-cost / threshold fallback / rule_id-wins / 4-decimal / negative-cost-ignored / zero-or-negative-elapsed)

#### 6. Version bump

3 files: `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` from `0.1.4` → `0.1.5`

### ❌ 不包含 (deferred to v0.1.6+)

- **S15 plugin list UI** (HANDOFF.md §2.1 v0.1.5 scope 决定). 触发条件: cn 4 个 REST endpoint 加好 + 用户装 2+ 第三方 plugin + 出现 security incident / feature request
- **CI 端到端集成测试** — 需要 hermes-agent-cn + hermes-tray CI 跑 cross-project integration test
- **tray 端 v0.1.5 binary CI upload 验证** — 之前 v0.1.4 release.yml upload-artifact 路径写错 (修了 c7e2f3d), 本次 v0.1.5 release 后从 GitHub Actions 实际跑一次确认 0 → 3 asset
- **by_provider 饼图** — NEEDS_BACKLOG §5.1 提到, 但 v0.1.5 by_rule breakdown 已经覆盖了大部分 "cost from where" 需求; by_provider 等 v0.1.6+ 重新评估

---

## 决策点 (decision made 2026-07-03)

| Decision | Final pick | 理由 |
|---|---|---|
| 4 个新 aggregate 用 4 个 Tauri command 还是扩 token_stats? | **扩 token_stats** | 同一行 scan 已经能拿到所有数据; 4 个独立 command = 4 次 round-trip + 4 个 React 端 fetch 编排; v0.1.4 的 recent_routing_decision / recent_elapsed_ms 也是直接扩 TokenStats, 保持一致 |
| 真实 cost_estimate_usd 放 column 还是 metadata JSON? | **column + JSON 镜像** | SUM/COUNT/AVG 在 column 上 O(1); 镜像到 JSON 是给 legacy json_extract 读者 + 单消息详情页用; 两个路径不冲突 |
| cost 字段放 routing_decision 里还是顶层 metadata? | **都放, routing_decision 优先** | 顶层 metadata.cost_estimate_usd 给简单读; routing_decision.cost_estimate_usd 给"它和 routing 决策是一起的"语境; merge helper 先写 routing_decision 再 mirror 到顶层 |
| fallback_hit_rate 分母用全部 message 还是只 routed? | **只 routed** | pre-S12 messages 没有任何 routing_decision, 拿全部 message 当分母会让百分比被稀释到接近 0, 失真; 只看 routed 才是 "routing 行为的命中率" |
| CLI bar 总是显示还是按数据? | **按数据** | pre-S12 message / S12 没推 cost 的 message → 不显示 bar; 避免视觉噪音 |
| S15 plugin UI 跟 v0.1.5 一起发? | **❌ 不发** | v0.1.5 应 2-3 天小步快跑, S15 串行依赖 5-8 天不值; 强绑会污染 release 内容 (独立产品决策不该混) |
| By Rule breakdown 还是 By Provider? | **By Rule** | NEEDS_BACKLOG §5.1 提到 by_provider, 但 S12 routing_decision.rule_id 已经包含了 "我用了哪个 rule", 覆盖了大部分 "cost from where" 需求; by_provider 是 rule_id 的子集 (rule → provider 映射), 等 v0.1.6+ 用户实际想看时再做 |

---

## 升级路径 (v0.1.4 → v0.1.5)

| 字段 | v0.1.4 | v0.1.5 | 迁移影响 |
|---|---|---|---|
| `messages.cost_estimate_usd` | 列不存在 | REAL DEFAULT 0.0 | 老 messages = 0.0, 新 messages 由 S12 推送 |
| `messages.cost_threshold_exceeded` | 列不存在 | INTEGER DEFAULT 0 | 老 messages = 0, 新 messages 由 S12 推送 |
| `messages.metadata.routing_decision.cost_estimate_usd` | 字段不存在 | f64 镜像 | 老 metadata = 缺省, 新 metadata 写入 |
| `messages.metadata.routing_decision.cost_threshold_exceeded` | 字段不存在 | bool 镜像 | 同上 |
| `messages.metadata.cost_estimate_usd` (顶层) | 字段不存在 | f64 镜像 | 同上 |
| `TokenStats.period_cost_total_usd` | 字段不存在 | 0.0 | 老 DB = 0.0, 新数据累计 |
| `TokenStats.fallback_hit_rate` | 字段不存在 | 0.0 | 同上 |
| `TokenStats.avg_latency_ms` | 字段不存在 | 0.0 | 同上 |
| `TokenStats.cost_threshold_count` | 字段不存在 | 0 | 同上 |
| `TokenStats.by_rule` | 字段不存在 | [] | 同上 |
| Per-turn CLI bar | 不存在 | 渲染 when S12 数据存在 | pre-S12 messages 无 bar; 新 messages 自动有 |

**降级兼容**: 前端 `TokenStats` interface 用 optional + `?? 0` / `?? []` 防御, 老 DB 自动兼容 (json_extract 读 NULL 返回 0 / NULL)。

**Schema migration**: `migrations/0004_add_cost_metadata.sql` 通过 `include_str!` 在编译时嵌入, MSI 安装后无需 `migrations/` 目录。`run_migrations` 在启动时自动 apply v4 到 v0.1.4 DB (smoke test 验证过: fresh cwd 8s 不崩, schema_version 4 行 v1+v2+v3+v4)。

---

## 安装包 (post-tag)

`gh release create v0.1.5` 后的 3 个 binary:
- `hermes-tray-tauri_0.1.5_x64_en-US.msi` (Windows MSI)
- `hermes-tray-tauri_0.1.5_x64-setup.exe` (NSIS installer)
- `hermes-tray-tauri_0.1.5_x64.exe` (Portable)

> gh 2.96 在 Windows 上用 Windows Credential Manager (DPAPI) 存 oauth_token, **mavis session 拿不到**, binary 上传需要 user 跑。命令清单: `GH_RELEASE_UPLOAD.md` (root) — 跟 v0.1.4 同流程, 把 `v0.1.4` 替换为 `v0.1.5` 即可。

---

## 测试覆盖

| 类别 | New cases | File |
|---|---|---|
| Backend: S12 cost 列写入 | 2 | `src-tauri/tests/db_session_message_test.rs` (persists_s12_cost_columns / persists_threshold_flag_set) |
| Backend: schema v4 migration | 1 | `src-tauri/tests/db_session_message_test.rs` (migrations_apply_v4_cost_columns) |
| Backend: aggregate + by_rule | 1 | `src-tauri/tests/db_session_message_test.rs` (token_stats_aggregates_s12_cost_fields) |
| Frontend: message bar format | 12 | `src/messageBar.test.ts` |
| **合计** | **16** | |

**总数**: 123 vitest (was 111 in v0.1.4, +12 messageBar) + 150 cargo (was 146, +4 S12) = **273/273 passed**。

---

## 下一步

- **NEEDS_BACKLOG §1 S12-agent Phase 3 收尾** (tray T-Q-S9 真值替换) — ✅ done in v0.1.5, char/4 已被 real cost 完全替代
- **NEEDS_BACKLOG §4 S15-agent Plugin Marketplace** (5-7d) — 推到 v0.1.6+, 触发条件见 HANDOFF.md §2.1
- **by_provider 饼图** — v0.1.6+ 重新评估
- **CI 端到端集成测试 setup** — hermes-tray CI + hermes-agent-cn CI 跑 cross-project integration test
- **v0.1.5 release.yml fix 验证** — c7e2f3d 修了 upload-artifact path 错误, v0.1.5 release 后从 GitHub Actions tab 确认 0 → 3 asset (release CI 第一次真成功)
