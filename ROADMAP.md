# Hermes Tray — Roadmap (v0.2.0 STABLE + v0.2.1 → v0.3.0)

> **v0.2.0 STABLE** shipped (commit `d7ee96f`, 8/8 manual MSI
> verification). **v0.2.1 patch** in flight (commit `2790386`,
> CI run `29835017855` in progress, tag pushed, cron self-checking).
> This document plans the v0.3.0 cycle per the 2026-07-21 UI design
> audit: 4 phases over ~6.5 days, against the 20 reference SVGs in
> `D:\work\workspace\Qoder\hermes-tray设计\assets\svg-pages\`.

---

## Current state (2026-07-21 21:35)

- v0.2.0 STABLE shipped (tag `v0.2.0`, commit `d7ee96f`).
- v0.2.1 patch in flight (tag `v0.2.1`, commit `2790386`,
  CI in progress). 5 post-release fixes on top of v0.2.0:
  voice transcription snake_case + closeable error toasts,
  routed model display in footer, persona library single-column,
  paste-import share link entry, build fix (drop
  pauseWhenPageIsHidden).
- 464 frontend tests + 133 Rust lib tests passing. Bundle 1.23 MB JS /
  55.41 kB CSS.
- P3.2 备份/恢复 modal **SHIPPED** (alpha-32 + 32.2 hotfixes).
- **2026-07-21 UI design audit** completed against
  `D:\work\workspace\Qoder\hermes-tray设计\` (交互说明文档 + 交付物清单
  + 20 张 PNG/SVG 设计稿). See § UI Design Audit below.
- **Next**: v0.3.0 — Phase 1 (CSS catch-up + design token fix) →
  Phase 2 (Toast + Persona redesign) → Phase 3 (Search keyboard nav +
  Stats grid + 细节) → Phase 4 (3 long-tail + mavis-team audit).

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