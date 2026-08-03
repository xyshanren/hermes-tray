# Hermes Tray — Roadmap (v0.2.0 STABLE + v0.2.1 → v0.3.0)

> **v0.2.0 STABLE** shipped (commit `d7ee96f`, 8/8 manual MSI
> verification). **v0.2.1 patch** in flight (commit `2790386`,
> CI run `29835017855` in progress, tag pushed, cron self-checking).
> This document plans the v0.3.0 cycle per the 2026-07-21 UI design
> audit: 4 phases over ~6.5 days, against the 20 reference SVGs in
> `D:\work\workspace\Qoder\hermes-tray设计\assets\svg-pages\`.

---

## Current state (2026-07-22 14:30)

- v0.2.0 STABLE shipped (tag `v0.2.0`, commit `d7ee96f`).
- v0.2.1 patch shipped (tag `v0.2.1`, commit `2790386`,
  Release run `29835017855` ✅). 5 post-release fixes on top of
  v0.2.0: voice transcription snake_case + closeable error toasts,
  routed model display in footer, persona library single-column,
  paste-import share link entry, build fix (drop
  pauseWhenPageIsHidden).
- **v0.2.1.1 post-release rebrand** (commit `e040736` on master,
  **no hotfix tag** — 走 D 方案,v0.3.0 第一个 release 才显形):
  - `productName`: `hermes-tray-tauri` → `Hermes 助手`
  - `version` bump: `0.2.0` → `0.2.1`(v0.2.1 release 时漏补的修)
  - `bundle.windows.wix.language: ["zh-CN"]` — MSI 内部 string table
    走中文("添加/删除程序" 面板里的 Publisher / Install location)
  - 托盘 tooltip: `Hermes Tray - Hermes 助手` → `Hermes 助手`(去尾巴)
  - 接下来的 msi 出来会是 `Hermes 助手_0.2.1_x64_zh-CN.msi`
- 464 frontend tests + 133 Rust lib tests passing. Bundle 1.23 MB JS /
  55.41 kB CSS.
- P3.2 备份/恢复 modal **SHIPPED** (alpha-32 + 32.2 hotfixes).
- **2026-07-21 UI design audit** completed against
  `D:\work\workspace\Qoder\hermes-tray设计\` (交互说明文档 + 交付物清单
  + 20 张 PNG/SVG 设计稿). See § UI Design Audit below.
- **Next**: v0.3.0 — Phase 1 (CSS catch-up + design token fix) →
  Phase 2 (Toast + Persona redesign) → Phase 3 (Search keyboard nav +
  Stats grid + 细节) → Phase 4 (3 long-tail + mavis-team audit).
- **Cross-project**: aimc(`D:\work\workspace\Qoder\aimc`) 是新的中介
  gateway,hermes-tray 这边 v0.2.1 的 `routing_decision` SSE chunk 设计
  是为它准备的,但 aimc 还没实现 SSE 注入。Phase 1 一并做。

## What this round covers (P3 modal-by-modal, ordered)

Each item ships as an independent `alpha-N` release, **verified
end-to-end by you via a checklist** before the next item starts.
No batch releases; no ship-then-verify-later.

### Long-tail issues carried into v0.3.0 (caught during v0.2-beta manual MSI verification, 2026-07-08)

These three are deferred because they survived a complete uninstall
+ reinstall of the v0.2-beta alpha-31.1 hotfix msi and a forced
hard-reload of the Tauri WebView — meaning we cannot reliably
determine if they are bugs in code, msi-bundling, or Windows
installer behaviour without a deeper cross-tool audit. They are
NOT in scope for v0.3 release-blocking fixes; they land in
v0.3.0 alongside the agent-team audit pass:

| # | Long-tail bug | Likely root cause hypothesis | Recommended diagnostic |
|---|---|---|---|
| 1 | One specific session has dark code bubbles where CJK text is invisible | Marked.js highlight.ts output for pre code blocks has a hard-coded `#…` colour that doesn't inherit `--code-text`. Possibly session-specific because the source markdown happened to have characters that triggered a different grammar scope. | Standalone HTML repro with raw `markdown-it` → see if the rendered HTML uses `<span class="hljs-…">` with colour overrides. |
| 2 | Header model selector still reads `hermes-agent` even after gateway is reachable | `fetchModelInfo()` cached the CONFIG.defaultModel fallback on initial boot when gateway was unreachable; never re-fetched after the WebSocket-style reconnect. | Add a `reload` button to the model pill + listen to `connectionStatus === 'connected'` and re-fetch. Trigger from main.ts. |
| 3 | User bubble still left-aligned after fresh install + Ctrl+Shift+R | The Tauri WebView cache invalidation appears to not cover the alpha-25/alpha-27 styles.css edits when the msi was rebuilt from a fresh tag. Maybe a `dist/` cache hit on the release side or the user installed over an earlier unreleased install that had no right-align rule. | Open the WebView DevTools (right-click → Inspect) and read `getComputedStyle(document.querySelector('.message.user')).alignSelf` — should be `flex-end`. If it is and the bubble is still left, the issue is `.messages` flex container direction. If it isn't, CSS didn't load. |

### Cross-cutting audit that requires multi-agent review

Going beyond single-CSS-rule fixes, the following cross-file
audits are good candidates for the **mavis-team** skill (per
the user's 2026-07-08 instruction "代码量大/问题复杂/需要交叉审
查等情况时可以用专门的 agent 去做"). They are intentionally
NOT done as a single-pass fix in alpha-N form, because they
need:

- One agent to enumerate the regression sources (WebView cache
  vs CSS rule vs JSX render vs Tailwind utility vs design token
  cascade vs theme class).
- One agent to triage.
- One agent to apply the fix and write the regression test.
- One agent to do the manual MSI verification step before
  claiming "fixed".

| # | Audit | Why one-shot fix won't work |
|---|---|---|
| A | **Tauri WebView CSS cache behaviour** — five different alpha-* commits since 2026-07-04 have shipped styles.css edits that required user-side Ctrl+Shift+R or full reinstall to take effect (alpha-24, alpha-25, alpha-27, alpha-30, alpha-31.1). Need to either (a) embed a dev-mode CSS cache-bust button in the settings page, or (b) document the "always uninstall + reinstall, never hot-patch" workflow into the release-runbook. | Requires WebView / dist pipeline investigation across tauri-build → bundle → msi → WebView rendering. Multi-system audit. |
| B | **Markdown highlight colour chain** — long-tail #1 (CJK invisible in dark code bubbles for one session). Needs: (a) one agent to capture an HTML repro, (b) one to audit marked.js + highlight.js config, (c) one to fix `.message-content pre span` colour overrides in styles.css. | Highlighting layer + design tokens + specific CJK characters behave differently. |
| C | **fetchModelInfo lifecycle + connection-event-driven refresh** — long-tail #2. Needs (a) audit of where `state.connectionStatus` is set in main.ts, (b) decide re-fetch trigger (per-state-change vs explicit button), (c) implement + test. | Lifecycle + 3 OS bundle paths. |

### 3.2 · Backup / Restore modal — SHIPPED (alpha-32 + 32.2)

**Design refs**: `03-create-backup-light.svg`, `04-restore-backup-light.svg`,
`09-create-backup-dark.svg`, `10-restore-backup-dark.svg`.

**Shipped in alpha-32**: single backup modal with 2 stacked cards (not
tab nav) per AGENTS.md §4. Rust `tauri-plugin-dialog = "2"` + native
file picker. 14+ missing CSS rules added. Tests: 430 → 433.

**Hotfixed in alpha-32.2** (3 bugs): hide WebView2 native password
reveal; mismatch validation requires both sides ≥8 chars; settings
modal stays open when backup opens (z-index 150 vs 100).

**Hard requirements all met**: ✅ 2-step restore (checkbox + 5s
countdown) · ✅ password eye + strength bar · ✅ danger outline (NOT
solid red) · ✅ modal 560px + max-height 90vh.

**Out of scope (deferred)**:
- Auto-backup schedule
- Argon2id memory cost tuning

### 3.1 · Token 用量与成本统计 (after 3.2 verified)

**Design ref**: `05-token-usage-modal.svg` + dark variant.
- Top 6 stat cards (Total Token / Estimated Cost / Messages / Sessions
  / Image Token / Recent Vision) in a 3×2 grid with consistent heights.
- Segmented control 时间切换: 今日 / 本周 / 本月 / 全部.
- 每日 token 用量 SVG bar chart (alpha-21 has a partial 实现 but
  with alpha-21 chart svg + design 05 mismatch in spacing).
- 按模型 table: Model / Input tok / Output tok / 费用 (CNY default).
  - alpha-23 added `unknown_model_buckets` + `is_pricing_known` filter;
    design 05 shows 4 columns + 可排序 header.
- Currency format:
  - `< 0.01` → `￥0.0001`
  - `< 1` → `￥0.123`
  - `< 100` → `￥1.23`
  - `>= 100` → `￥1,234`

### 3.3 · Search modal + Ctrl+K trigger (after 3.1)

**Design ref**: `12-search-modal.svg`.
- Cmd palette style: input at top, results below.
- Ctrl+K global hotkey to open; Escape closes.
- Search across: sessions (title + first message excerpt), personas
  (name + description), tokens (cost-above-threshold sessions).
- Empty / no-results state with helpful hints.

### 3.4 · Persona library + form

**Design ref**: `13-persona-library.svg`, `14-persona-form.svg`.
- Library: avatar grid + category filter chips + drag-reorder.
- Form: avatar picker (emoji + SVG upload), name + description,
  tone-of-voice presets, default-model override.

### 3.5 · Inline rename (sidebar 双击)

**Design ref**: `20-inline-rename.svg`.
- Hover only: show ✏️ icon next to title.
- Validation state (empty / too-long) inline.
- Escape cancels, Enter commits, blur also commits (v0.1.5 behaviour).

### 3.6 · Attachment preview

**Design ref**: `19-attachment-preview.svg`.
- Thumbnail strip below input box (alpha-21 has partial).
- Click → full preview in modal (image / PDF / text).
- Per-attachment ✕ delete button.

### 3.7 · Per-session project override picker (alpha-32.5)

**Why**: users can only set a *default* project path in settings.
Backend `session_update` already accepts `project_dir` +
`project_context` patches (alpha-23); frontend never exposed it.

**Design**: clickable dropdown on chat-view header project chip:
- Current → shows current project (or "未关联项目")
- Recent → last 5 unique project paths (MRU, db_config `recent_project_paths`)
- 📂 浏览... → native folder picker → `scanProject` + `session_update`
- 🚫 清除项目关联 → `project_dir = null`

**Hard requirements**: re-runs `scanProject` on pick; scan failure
toast + keep old value; per-session override ≠ default path.

---

## UI Design Audit (2026-07-21)

> 对照 `D:\work\workspace\Qoder\hermes-tray设计\` 设计文档（交互说明
> 文档 + 交付物清单 + 20 张 PNG/SVG）与当前实现的全面审查。

### 系统性问题

| # | 问题 | 严重度 | 影响范围 |
|---|---|---|---|
| U1 | **CSS 类缺失** — 12 个视图共 47 个 JSX class 在 styles.css 无对应规则，元素裸奔 | 🔴 致命 | 设置(12)、快捷键(10)、分享导入(8)、聊天(9)、输入(3)、会话列表(2)、确认(2)、统计(2) |
| U2 | **Design Token 偏移** — bg-primary/secondary/tertiary 整体偏暗一档；dark 模式 text-primary 偏暗；缺 `--accent` token | 🔴 高 | 全局 |
| U3 | **字体未引入** — 设计稿要求 Inter / Sarasa Gothic SC，当前用系统字体栈 | 🟡 中 | 全局 |
| U4 | **Toast 位置+结构** — 设计稿要求右上角 + 4px 语义色竖条 + error 手动关闭；当前 sonner 默认右下角 | 🔴 高 | Toast |
| U5 | **Modal 动画** — 设计稿 120ms + translateY(+8px→0)；当前 200ms + scale(0.95) + translateY(-10px→0) | 🟡 中 | 所有 Modal |
| U6 | **Focus trap 缺失** — Modal 无 Tab 循环 + 首元素自动聚焦 | 🔴 高 (a11y) | 所有 Modal |
| U7 | **Button active 态** — 设计稿要求 scale(0.98) + #3A48CC；当前无 | 🟡 中 | 全局按钮 |

### U1 全量 CSS 类缺失清单 (47 个 class, 按组件分组)

**根因**: alpha-16~22 Preact 拆分时 JSX 中写了语义化 class，但对应 CSS
规则从未补入 styles.css（部分由 Tailwind utility 覆盖了基本布局，
但视觉细节如背景/边框/间距/颜色全部丢失）。

#### ① 设置窗口 (12 个) — 最严重
- `.settings-group` 分区容器 (无卡片背景/圆角/间距)
- `.settings-danger-zone` 危险区红色描边容器
- `.settings-danger-grid` 4 按钮 2×2 网格
- `.settings-danger-btn` 红色描边按钮
- `.settings-danger-icon` 按钮内 emoji 图标
- `.settings-danger-confirm` 二次确认面板
- `.settings-danger-confirm-actions` 确认按钮行
- `.settings-danger-warning` 警告文字
- `.settings-test-row` 连接测试行
- `.settings-status` 状态圆点
- `.settings-url-preview` URL 预览 code 块
- `.settings-confirm-row` 确认行布局

#### ② 快捷键面板 (10 个) — 完全裸奔
- `.modal-shortcuts` 宽度定义 (设计稿 480px)
- `.shortcuts-body` 滚动区域
- `.shortcuts-group` 分组容器
- `.shortcuts-group-name` 分组标题
- `.shortcuts-list` 列表
- `.shortcuts-row` 每行 flex
- `.shortcut-desc` 描述文字
- `.shortcut-keys` 键组容器
- `.shortcut-key` 单个 kbd 键帽
- `.shortcuts-footer-hint` 底部提示

#### ③ 分享导入 (8 个) — 完全裸奔
- `.modal-share-import` 宽度定义
- `.share-import-content` 内容区
- `.share-import-field` 字段行
- `.share-import-value` 字段值
- `.share-import-role` 角色标签
- `.share-import-messages` 消息预览列表
- `.share-import-preview` 预览容器
- `.share-import-warning` 警告提示

#### ④ 聊天视图 (9 个)
- `.chat-view` 主容器
- `.first-run-welcome` 首次欢迎卡片
- `.no-network-card` 无网络卡片
- `.is-streaming` 流式状态指示
- `.message-attachments` 附件容器
- `.message-attachment` 单个附件
- `.message-attachment-file` 文件附件
- `.message-attachment-thumb` 缩略图
- `.welcome-message` 欢迎消息

#### ⑤ 聊天输入 (3 个)
- `.send-btn` 发送按钮
- `.char-count` 字数统计
- `.password-input` 密码输入框

#### ⑥ 会话列表 (2 个)
- `.sessions-list-view` 容器
- `.session-persona-emoji` persona 图标

#### ⑦ 确认对话框 (2 个)
- `.modal-confirm` 宽度定义
- `.confirm-message` 消息文字

#### ⑧ Token 统计 (2 个)
- `.stats-totals-cell-vision` 视觉 token 卡
- `.stats-totals-trace` 追踪卡

### 设置窗口额外修复项 (非 CSS 缺失)

1. Modal 宽度 400px → **640px**
2. 去掉 "默认模型 (T-Q-S12-light)" 中的内部编号

### 组件级差异

| # | 组件 | 设计稿 | 当前 | 优先级 |
|---|---|---|---|---|
| C1 | Persona 库 | 卡片网格 2×2 + 彩色圆头像 + 绿色默认徽章 | 纵向列表行 + emoji | 🔴 |
| C2 | Persona 表单 | 深色底 prompt 编辑器 + 字数计数 + 清空 | 普通 textarea | 🔴 |
| C3 | 搜索键盘导航 | ↑↓ + Enter + meta + 黄色高亮 | 仅点击 | 🔴 |
| C4 | Token 统计卡片 | 6 张 3×2 网格 | 3 张 1 行 | 🟡 |
| C5 | Token 模型表 | 可排序表头 | 不可排序 | 🟡 |
| C6 | 行内重命名 | 4 态 (默认/编辑/保存中/错误) | 2 态 | 🟡 |
| C7 | 附件预览 | 80×80 缩略图网格 + 点击预览 | 行内预览条 | 🟡 |
| C8 | 快捷键面板 | 搜索过滤 + kbd 灰底圆角 | 无搜索 | 🟡 |
| C9 | 货币格式 | ¥ 分级精度 + 千分位 | 未完整实现 | 🟡 |

### Modal 尺寸

| Modal | 设计稿 | 当前 | 状态 |
|---|---|---|---|
| Settings | 640px | 400px | ❌ |
| Search | 560px | 560px | ✅ |
| Persona | 640px | 640px | ✅ |
| Token Stats | 640px | 720px | ⚠️ 偏大 |
| Backup | 560px | 560px | ✅ |
| Shortcuts | 480px | 400px | ❌ |

---

## v0.3.0 开发计划 (2026-07-21 更新)

```
alpha-32.5  per-session project override picker     (0.5d)
       ↓
v0.3.0 大发版:
  ┌─ 已完成 ─────────────────────────────────────────┐
  │ alpha-32.3 (Issue 4 三件套)             ✅ done  │
  │ alpha-32.4 (5 修复)                     ✅ done  │
  └──────────────────────────────────────────────────┘
  ┌─ Phase 1: 基础层 + CSS 补全              2d ─────┐
  │ · Design Token 修正 (bg 档位 + accent)           │
  │ · 引入 Inter + Sarasa Gothic SC 字体             │
  │ · Modal 遮罩/阴影/动画参数修正                   │
  │ · Button active 态 + Input focus 光晕            │
  │ · U1 全量 CSS 补全 (47 class, 8 组件)            │
  │   - 设置窗口 12 + 快捷键 10 + 分享导入 8         │
  │   - 聊天视图 9 + 输入 3 + 列表 2 + 确认 2 + 统计 2│
  │ · Settings 640px / Shortcuts 480px / Stats 640px │
  │ · **aimc SSE 注入 + tray 端 consumed**  ←  cross-project│
  │   - aimc 侧: gateway/proxy.py _forward_stream 在 first │
  │     chunk 后注入 `event: routing_decision` SSE event,  │
  │     payload: {chosen_channel, model, cost_estimate_usd}│
  │     (~0.5d aimc 侧)                               │
  │   - tray 侧: chat-stream.ts 解析新字段 → 写到      │
  │     state.routingDecision;footer pill 读 chosen_channel│
  │     + model;stats page by_model 表加 "渠道" 列     │
  │     (key 改 model+channel 二元组);~0.3d tray 侧     │
  │   - 详见 § aimc SSE 注入 (v0.3.0 kickoff 后再开 sub- │
  │     section 列全 spec)                            │
  │ · **FirstRunWelcome: persona chip = set, not create**  ← 2026-07-27 试用发现│
  │   - bug: 在"新会话"空页点推荐 Persona 卡片会**再创 1 个新 session** (跟点 │
  │     "创建第一个会话" 按钮完全等价). 截图证据: sidebar 立刻多 1 个"新会话/刚│
  │     刚". alpha-20 留的 known shortcut: code 注释 `cosmetic for now`         │
  │     (chat-view.tsx:87-89) + test `Persona chip click should also call      │
  │     onCreateSession` (chat-view.test.tsx:357) 都 mirror 了同一行为,        │
  │     chip 还没把 persona 名字传给 createSession()                          │
  │   - 修: chip onClick = set state.selectedWelcomePersona(name) + 视觉高亮   │
  │     (`persona-chip.selected` + `aria-pressed`); CTA 按钮文案随选中变      │
  │     "用 {name} 开始 →"; CTA 才真创建,把 persona 传给 createSession(),    │
  │     创建完 state 清空 (一次性). 下游 `sessions.persona_id` schema 已就绪   │
  │     (alpha-23 加 model 字段时一并预留)                                     │
  │   - 涉及: views/chat-view.tsx (~20 行) + chat-view-store.ts (新 state 1 行)│
  │     + chat-view.test.tsx (改 1 个 expectation). 估时: ~0.3d               │
  │ · **External link: 走系统默认浏览器, 不要再替换 WebView**  ← 2026-07-27 试用 │
  │   - bug: 在 assistant 消息里点 `<a href>` (例如 AI 给的 aliyun 链接), 整个   │
  │     WebView 被替换成外网页面 (用户看到 aliyun 登录页占满整个 app 窗口), 无  │
  │     返回按钮, **卡死**. 比 first-run-welcome 严重 — 那个能继续用, 这个直接  │
  │     困在外网.                                                          │
  │   - 根因: `chat-view.tsx:228` `dangerouslySetInnerHTML={{__html:           │
  │     formatMessage(msg.content)}}` 把 marked.parse 的 HTML 直接渲染, 没拦  │
  │     截 click. `tauri-plugin-shell` (Cargo.toml:26) 装了但前端 0 import;   │
  │     `grep @tauri-apps/plugin-shell` 0 命中. CSP `security: {}` 也是空,   │
  │     整个 WebView 默认 in-app navigation.                                  │
  │   - 修: chat-view 顶层 useEffect 挂 `document.addEventListener("click",   │
  │     ...)` 拦截 `tagName === "A"` → `e.preventDefault()` →                 │
  │     `@tauri-apps/plugin-shell` 的 `open(href)`. 跟 Slack / VS Code /      │
  │     Notion 一致: 点外链 → 系统默认浏览器打开, app 不动, alt-tab 切回.       │
  │   - 涉及: 1 npm 包 (`@tauri-apps/plugin-shell`) + chat-view.tsx ~20 行    │
  │     + chat-view.test.tsx (mock plugin-shell, 验 open 被 call + prevent).   │
  │     估时: ~0.2d                                                          │
  │ · **Image attachment: DB 持久化丢 dataUrl, reload 后看不到图**  ← 试用    │
  │   - 现象: 上传图片发送后**当前 session** user 消息气泡能正常显示缩略图    │
  │     (chat-input-store attachment thumb + chat view AttachmentStrip 都对).  │
  │     但**切到别的 session 再切回来** / **关 app 重开**, user 消息里的图     │
  │     全消失. 时点 B + C 确认. 截图证据: 用户 7-27 试发 2 张图, 当前 session  │
  │     显示正常, 切 session / 重启后图空.                                     │
  │   - 根因 (DB 持久化路径): `main.ts:1466-1470` 把 attachment metadata 存   │
  │     `messages.metadata` JSON blob 时**只写 {name, type, size}, 丢 dataUrl │
  │     + id**. 加载 session 时从 metadata 读回 attachment 对象没 dataUrl,     │
  │     `<img src={undefined}>` 不显示. 省 DB 空间初衷 OK, 但没设计 re-fetch   │
  │   - 修法 sketch (~0.5-0.8d):                                              │
  │     1. 新表 `message_attachments` (id, message_id, name, mime, size, data  │
  │        BLOB, sort_idx) — 把 attachment bytes 跟 metadata 分离, 不挤 JSON   │
  │     2. schema migration 0006 (跟 v0.2-alpha-23 unknown_model_buckets 一类  │
  │        idempotent 加表, `IF NOT EXISTS` + index on `message_id`)          │
  │     3. 新 Tauri command `hermes_message_attach(message_id, attachment)`  │
  │        + `hermes_message_attachments(message_id)` (返回完整 list 含       │
  │        dataUrl, 转成 data: URL 给前端)                                    │
  │     4. chat-view.tsx loadSession: 拉 attachments 注入到 chatStore 内存    │
  │        message, 渲染层 0 改动 (AttachmentStrip 仍读 a.dataUrl)            │
  │   - 备选更轻方案: 直接把 dataUrl 塞 `messages.metadata` JSON blob (0       │
  │     schema 改动), 但 4 张图 × 10MB base64 ≈ 53MB/msg, SQLite JSON blob     │
  │     单条会卡 — 不推荐                                                      │
  │   - 不阻塞 v0.2.2 (用户截图显示当前 session OK). 严重度: 高 (multi-modal   │
  │     体验折半, 但不是 critical 卡死 — 切 session 还能聊). alpha-33 必修   │
  │ · **Chat input: paste 截图/剪贴板图变 attachment**  ← 2026-07-27 试用     │
  │   - 现象: 在 chat input textarea 里 Ctrl+V 粘贴截图工具/剪贴板里的图,  完  │
  │     全没反应 (浏览器默认把图片当 text 塞进 textarea, 出现一坨 base64 字符  │
  │     看着像卡住, 实际 fileToAttachment 没被调, attachment 流程完全没走).  跟│
  │     drop / 点 📎 按钮走的不是同条路径, 只是 1 个 listener 缺失.          │
  │   - 根因: `main.ts:1097` 有 `drop` listener 调 `addAttachments`, 但**没有  │
  │     对应的 `paste` listener**; chat-input-view.tsx 的 form / textarea 也  │
  │     没 onPaste. 全局 `addEventListener("paste", ...)` 0 命中. 唯一 paste  │
  │     handler 在 share-modal (paste-import 分享链接), 跟 chat input 无关.  │
  │   - 修法 sketch (~15 min): main.ts drop listener 旁边加 paste 同款,     │
  │     `e.clipboardData.items` 里 `kind === "file"` → `getAsFile()` 收集     │
  │     File[] → `addAttachments(files)` (复用现有路径). `files.length === 0`│
  │     时不 preventDefault, 浏览器纯文本 paste 行为正常.                    │
  │   - 边界: 纯文本 paste → 不拦; 多图 paste → 走 attachment (10MB / 4 张  │
  │     上限已就绪); drop 跟 paste 共用 addAttachments, MIME / 体积检查复用.  │
  │   - 涉及: main.ts ~15 行, 0 新依赖, 0 新 Tauri command, 0 新 state.    │
  │     估时: ~0.05d                                                          │
  │ · **Attachment strip: 跟 text bubble 并排, 把 user 气泡撑宽**  ← 试用     │
  │   - 现象: user 消息里有 12 字短文本 + 2 张缩略图, 整个 user 气泡宽度 ~340px │
  │     (text bubble + 12px gap + 168px 缩略图 strip), 视觉上"短文本 + 图"应该│
  │     紧贴 ~140px 而不是 ~340px. user 觉得"把对话框撑大了, 不太美观".     │
  │   - 根因 (styles.css): `.message.user` row `max-width: 100%` 满 chat 宽, │
  │     但 row 内的两个 flex child — `.message-content` (fit-content, max 80%)│
  │     + `.message-attachments` (display:flex, 2 张 80x80 thumb + 8px gap)   │
  │     — 默认横向并排. `flex-wrap: wrap` 写在 .message-attachments 内部, 但   │
  │     只 wrap 缩略图之间的行, 不 wrap .message-attachments 跟 .message-content│
  │     之间. 2 张缩略图 + 168px < 80% chat width, flex 算法判断"一行够" →  │
  │     不 wrap → text + 2 thumbs 横排, 撑宽 user 气泡.                     │
  │   - 修法 sketch (~5-10 min): `.message-attachments` 加 `flex-basis: 100%`│
  │     (或 `width: 100%`), 强制换到 text bubble 下面另起一行. 缩略图 80x80   │
  │     保留 OK; 若 2 张图想保持并排 (168px < 140px user bubble 时会 wrap),  │
  │     可降 64x60 → 128px ≈ user bubble 140px.                              │
  │   - 备选: 给 user 气泡加 max-width 兜底, 但会盖过现有 80% cap, 不推荐.  │
  │   - 涉及: styles.css 1-2 行, 0 新逻辑. 估时: ~0.02d. 跟 CSS catch-up      │
  │     (alpha-33a) 天然合拍, 一并收.                                       │
  │ · **30s health check 推 chatStore, ChatView 全树 re-render, 选中文丢失** │
  │   - 现象: 对话框每 ~30s "快速刷新一下" (限 chat 容器内). 用户选中 chat 内│
  │     文字后, 30s 内被清掉. 视觉上跟 alpha-32.4 那个 health check 加的 30s  │
  │     interval 同时段出现.                                                │
  │   - 根因链路: main.ts:1414 `setInterval(checkConnection, 30000)` →        │
  │     line 1553 `checkConnection` 进入时 `updateConnectionStatus('connecting')`│
  │     → line 1726 `chatStore.setConnectionStatus(offline)` → chat-view-store.ts│
  │     284-287 `state.connectionStatus = status; notify()` → ChatView line 424│
  │     `useState(state)` 整引用变 → line 434 `useEffect(()=>scrollTop=…, [state])`│
  │     auto-scroll 到底 + 整树 re-render → 浏览器在 reflow 时清掉 text   │
  │     selection. 30s 周期: connected→connecting(2 次不同值)→connected  →  │
  │     early return (`chat-view-store.ts:285`) 挡不住, 至少 notify 2 次.   │
  │   - 修法 sketch (~3 行 fix, ~0.05d): `main.ts:1552-1557` 把 'connecting' │
  │     中间态**不**走 chatStore 路径, 只改 DOM (statusText / className 已经 │
  │     在 line 1727-1729 直接改). terminal 态 ('connected' / 'disconnected')│
  │     仍走 store, 但稳定时 next tick 早 return → 0 notify. 30s 健康时 0   │
  │     re-render, 断网时 1 次 re-render (之前是 2 次).                  │
  │   - 附: ChatView line 434 `useEffect [state]` 是 over-eager — 改成     │
  │     `[state.messages, state.streaming, state.fatal]` 也行, 但更彻底的   │
  │     是修源头 (不让 store 抖), 推荐前者.                                │
  │   - 涉及: main.ts ~3 行, 0 新依赖, 0 新 store. 估时: ~0.05d.            │
  │ · **SSE 错误一报错就上 fatal banner, 跟 connection dot 矛盾**  ← 试用    │
  │   - 现象: 用户在 assistant streaming 中途, 偶尔出现红色 fatal banner    │
  │     "连接失败: error decoding response body (http://127.0.0.1:8642)",   │
  │     但右上角 dot 仍显示绿"已连接". health check 跟 SSE 错误走的是两条  │
  │     独立的 truth source, 互不更新.                                       │
  │   - 根因: `src/lib/chat-stream.ts:340-351` catch 块无差别 `setError`   │
  │     + 进 fatal banner; 但没调 `updateConnectionStatus` → dot 仍 connected.│
  │     "error decoding response body" 几乎都是 mid-stream 偶发 (网络瞬断   │
  │     / agent 端 JSON 略变), 不是真断网.                                  │
  │   - 修法 sketch (~0.3d): 区分"send 握手失败" vs "mid-stream chunk 失败"│
  │     - 握手失败 (openStream 之前) → setError + updateConnectionStatus    │
  │       ('disconnected') + 上 fatal banner                                  │
  │     - mid-stream chunk 失败 (openStream 之后) → 只在 assistant bubble  │
  │       末尾 append 错误 (abortStream 已 done) + **不**上 banner, **不**动 │
  │       dot. 这样下次 send 仍能正常连.                                     │
  │   - 实现: chat-stream.ts 在 try 块顶部放 `let isFirstChunk = true;`    │
  │     进 catch 看 flag 走两条路径. 估时 ~0.3d. alpha-33b 收.            │
  │ · **User bubble 真正没 right-align**  ← 2026-08-03 试用 (修正)        │
  │   - 现象: 截图里两个 user 气泡的"右边沿"明显不对齐到同一条垂直线, 第一  │
  │     个 2 行 wrap 的气泡更靠左, 没贴到 chat 容器右边缘. 用户 (跟 mavis 之前│
  │     错估) 都以为是中文断行问题, 实际是 CSS 布局层问题.                  │
  │   - 根因: `.message` 是 `display: flex` (默认 row), `.message.user`    │
  │     row 整体 right-align (align-self: flex-end + margin-left: auto),   │
  │     但 row **内部** default `justify-content: flex-start` → child     │
  │     (text bubble) 仍然 left-align in row. 视觉上 row 跟 chat 容器右边缘│
  │     贴齐了, 但 child 还在 row 最左 → 看起来 text bubble 没贴右.         │
  │   - 修法 sketch (~0.02d): `.message.user` 加 `flex-direction: column; │
  │     align-items: flex-end;` — children 内部 stack 上下 + 横向 right.  │
  │     不动 `.message.assistant` (它在左, 不需要改). 跟 alpha-33a CSS     │
  │     catch-up 一起收.                                                    │
  │ · **Assistant bubble: 加 Copy markdown 按钮 (右上 hover)**  ← 试用     │
  │   - 现象: assistant 消息气泡右上没 copy 按钮. 业界 baseline (ChatGPT /  │
  │     飞书 AI / Slack) 全有 — 用户选中 → 复制 → 粘到 IDE / 文档.        │
  │   - 修法 sketch (~0.2d): assistant bubble 容器加 `position: relative` │
  │     + child `<CopyButton content={msg.content} />` 绝对定位右上, 默认  │
  │     opacity 0 / hover opacity 1. 点击 → `navigator.clipboard.writeText  │
  │     (rawContent)` (复制 raw markdown, 不是渲染后 HTML — 粘到 IDE 仍可用)│
  │     . 0 新依赖, ~30 行. alpha-33a 收.                                  │
  │ · **Markdown CSS polish: 跟 ChatGPT 那种 "polish" 还差一截**  ← 试用  │
  │   - 现状: marked@18 + highlight.js@11 + 基础 ul/ol/li/code/pre/h1-3   │
  │     /blockquote 都已配. 但跟 ChatGPT / 飞书 AI 比:                      │
  │     1. h1-h3 字号差太小 (1.25/1.15/1.05em) → 层级拉不开                  │
  │     2. `p` 段落没 margin → 段落连成一片                                  │
  │     3. inline code 跟 text 同色 (只换 bg) → "代码字" 不分明              │
  │     4. `a` 链接无下划线 (hover 才有) → 不像"可点"                       │
  │     5. task list (`- [ ]`) 没配 → checkbox 不显示                       │
  │     6. `table` 表格没配 → 没法用                                          │
  │     7. `hr` 横线没配 → 没法用                                            │
  │     8. code block 没头部 (filename / Copy 按钮) → 复制要等 #9           │
  │   - 修法 (~0.5-0.8d, CSS only, 不动 markdown 库):                       │
  │     Phase A (~0.3d): p 间距 / h1-h3 字号差拉到 1.4/1.25/1.1 / a 默认下划 │
  │     线 (lightgray) / inline code 加 color #c7254e / li 缩进 1.5em      │
  │     Phase B (~0.5d): table 边框 + cell padding / task list checkbox    │
  │     (marked v18 默认 GFM) / hr border-top / code block 包一层 div +   │
  │     Copy 头部按钮                                                        │
  │   - 跟 alpha-33a "U1 全量 CSS 补全 (47 class, 8 组件)" 天然合拍.       │
  │ · **Assistant bubble: 点赞 / 点踩 / 重新生成 / 分享按钮**  ← 试用,   │
  │   alpha-34+ 评估                                                          │
  │   - 用户视角: 跟 #9 (Copy 按钮) 同位 (assistant bubble 底部 action bar)│
  │   - 价值方: 跟 #9 不一样 — Copy 是 user convenience; 反馈按钮是       │
  │     **agent-facing** (RLHF / 微调数据 / 路由权重调整).                  │
  │   - 关键前提: **hermes-agent-cn 端是否接 feedback pipeline**. 如果      │
  │     endpoint 已存在 (`/v1/feedback` 之类) 且 agent 端会消费,          │
  │     tray 端就接 → 真有 data flywheel. 如果 endpoint 接收但 dead field, │
  │     **不**做 — UI 是 dead code 占地方.                                │
  │   - 重新生成 (~0.3d): abort + resend 当前 chat-stream 实现不一定干净.  │
  │     估时保守.                                                            │
  │   - 分享 (~0.05d): share-modal.tsx 已有, 直接调.                       │
  │   - 状态: 等用户跟 hermes-agent-cn 确认 feedback 用途后再定.            │
  │   - 估时: ~0.05d (分享) / ~0.3d (重答) / ~0.3d tray + ~0.5d agent (反馈)│
  └──────────────────────────────────────────────────┘
  ┌─ Phase 2: Toast + Persona 重做            1.5d ──┐
  │ · Toast → 右上角 + 4px 竖条 + error 手动关闭    │
  │ · Persona 库 → 卡片网格 + 默认徽章              │
  │ · Persona 表单 → 深色 prompt 编辑器 + 字数计数   │
  └──────────────────────────────────────────────────┘
  ┌─ Phase 3: 搜索 + Token 统计 + 细节       1.5d ──┐
  │ · 搜索 ↑↓ 键盘导航 + meta + 黄色高亮           │
  │ · Token 6 卡 3×2 + 可排序模型表 + ¥ 分级格式    │
  │ · 行内重命名 4 态 / 附件网格 / 快捷键搜索       │
  │ · Focus trap + aria-label 补全                   │
  └──────────────────────────────────────────────────┘
  ┌─ Phase 4: 长尾 + 审计                    1d ─────┐
  │ · 3 long-tail (CJK / model selector / bubble)    │
  │ · mavis-team 跨文件 audit (A/B/C)               │
  └──────────────────────────────────────────────────┘

总计: ~6.5d (含 alpha-32.5)
发版节奏: alpha-33 (Phase 1) → alpha-34 (Phase 2+3) → v0.3.0 (Phase 4)
```

---

## alpha-34+ tray 端跨项目增量 (2026-08-03 规划, 16:00 更新)

> 来源: 2026-08-03 v0.2.2 试用 + hermes-agent-cn 端反馈 + 16:00 SSE event schema 草稿。所有 feature 都依赖 **SSE event 协议 (B 方案, 跟 AIMC `routing_decision` event 同 pattern)**, 实施时跟 hermes-cn 端 K-5 PR 一起 review。

### 范围 (alpha-34 起, 估时合计 ~1.1d tray + ~1.2d agent)

| # | feature | tray | agent | 关联 |
|---|---|---|---|---|
| 12 | `/learn` 命令触发 UI (LearnPreview modal) | ~0.3d | ~0.5d | event: `learn_preview` |
| 13 | `/journey` 列表 + edit UI (Settings 新 section "Journeys") | ~0.5d | ~0.5d | event: `journey_list` / `journey_edit_request` |
| 14 | skill 评分 (per-skill 1-5 星 widget on /journey card, 选项 a) | ~0.3d | ~0.2d | 跟 #13 一起做 |

### 推迟 (alpha-34+ 之外, 跟 CAND-080 evolution loop + axiom 3 闭环一起)

- **评分 skill 输出 (选项 b)** — 给每条 assistant response 评 1-5 星, 喂 evolution loop 训练。~1d, **跟 CAND-080 sub-layers 实施时一起做** (跟 axiom 3 闭环 1 个 sprint 收)。先等 hermes-cn 端 axiom 3 spec 定。

### SSE Event Schema 草稿 (hermes-cn 端 K-5 决定, tray 端 consumer)

```
Event 命名 (跟 OpenAI SSE 标准, snake_case):
- learn_trigger      → 开始蒸馏 (agent 收到 /learn 后发)
- learn_preview      → SKILL.md 准备好, 等用户 review  (弹 LearnPreview modal)
- learn_commit       → 用户确认, 落库
- journey_list       → 现有 skill 列表 (弹 /journey 列表用)
- journey_edit_request → 编辑某 skill 请求 (弹 edit form)

Payload schema (snake_case JSON):
{
  "action": "<skill_name | form_field_update | commit | cancel>",
  "skill_md": "<string, optional>",
  "metadata": { "<任意字段>", ... },
  "turn_id": "<string>",
  "session_id": "<string>",
  "version": <int>
}

触发时机 (OpenAI SSE stream 兼容):
- 在 chat.completion response 流里
- 格式: event: <name>\ndata: <json>\n\n

错误路径:
- tray 解析失败 → 静默 + logger.warn (不阻断 chat flow)
- agent emit 失败 → fallback text 走普通 text path (UI 没出来
  时 user 仍能 chat 完整完成, 不卡死)
```

### tray 端实施 3 件事 (按 mavis memory "UI 设计前必查后端 pipeline" + Cherry-pick split bug 防护)

1. **走 B 方案 (SSE event, 跟 AIMC `routing_decision` event 同 pattern)** — hermes-agent-cn 端 parse `/learn` / `/journey` command, SSE 流里塞自定义 event (5 个命名见上), tray 端 `chat-stream.ts:172-180` 已经在 SSE chunk 上抓 `routing_decision` — 加新 listener 时**共用**解析路径。**两侧都不本地 parse `/`**, 零冲突。
2. **实施前 grep hermes-agent-cn 端 SSE event schema** — 避免跟 AIMC `routing_decision` 撞名 + 跟 hermes-cn 端 K-5 spec 对齐。
3. **跟 hermes-cn 端 K-5 PR 一起 review** — SSE event 协议需要双方对齐, 不是 tray 单方面定。Event 命名 (5 个) / payload schema / 触发时机 / 错误路径 都要一起 spec (上面草稿先给个 baseline)。

### 不在 alpha-34 范围 (next sprint K-5 borrow 时再评估)

- **`/goal` UI 触发** — 暂不需要, `/goal` 全 text-based, tray 现有 chat input 处理已够。如果未来 upstream `/goal` 加 modal (e.g. contract preview), 镜像即可, 标 "watch upstream `/goal`"。
- **评价 agent output 按钮 (like / dislike)** — 2026-08-03 hermes-agent-cn 端确认**没有 feedback pipeline**, grep `feedback|like|dislike|thumbs|/v1/feedback` 0 hit → **不做** (memory 2026-08-03 lesson 防护)。

### 跨项目 cross-ref

- hermes-agent-cn (WSL `~/hermes-agent-cn`) — K-5 PR 跟 tray alpha-34 同一 sprint review, SSE event schema 5 个 event 在 K-5 spec
- AIMC (`D:\work\workspace\Qoder\aimc`) — `gateway/proxy.py:_forward_stream` SSE `event: routing_decision` 注入是同 pattern, 命名风格 (snake_case JSON payload) 跟 K-5 spec 对齐
- hermes-cn (`D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\2026-07-23-upstream-borrow\`) — CAND-080 剩余 sub-layers + K-5 + axiom 3 evolution loop (跟 评分 skill 输出 一并做)

---

## P2 candidates (deferred from v0.2, eligible for v0.3)

| Item | Deferral reason | Re-eval when |
|---|---|---|
| Assistant avatar 🤖 → SVG Hermes logo | Cross-platform emoji baseline is acceptable; SVG asset bundle is a separate round | v0.3 kickoff |
| Sidebar top 5 icons (add 📊 / 🛡) | Adding all 5 makes the sidebar visually heavy; backup/stats reachable from main area | When sidebar width budget allows |
| shadcn/ui full migration (13 components) | Current Tailwind class usage is stable; migration is a separate round with risk of regressions | TBD — only if v0.3 surface area grows beyond Preact patterns |
| Animation audit (150 / 250 / 400ms ease-out tier) | alpha-22~26 already have ~150ms transitions; full audit needs dedicated round | When animation passes become a complaint topic |
| Dark mode full design-02 audit (vs current `01-main-chat-dark.png`) | alpha-24 rewrote token but no pixel comparison done | After all light-mode polish lands |
| **MSI v0.2.0-beta hyphen bug** — `0.2.0-beta` rejected by Windows bundle path; dropped to `0.2.0` in alpha-29. Lesson: keep `version` numeric in `tauri.conf.json` + `Cargo.toml` even if `package.json` says pre-release (npm allows hyphen, Rust+Windows bundles do not) | Documented in agent-memory "Re-tag operation" lesson; needs cross-ref into `tauri-release-ci` topic file | Document this round |

## Out of scope for v0.3 entirely (v0.4 or later)

- Multi-window chat (each session as its own Tauri window)
- Mobile companion app (Tauri mobile shells exist; not in v0.2 roadmap)
- Plugin marketplace (v2 was a stretch goal, deferred)
- Auto-update from GitHub releases (v0.2 sets the wiring in alpha-15
  release notes page; auto-update itself needs additional Tauri's
  `updater` plugin configuration in `tauri.conf.json`)