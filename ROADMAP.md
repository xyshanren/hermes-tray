# Hermes Tray — Roadmap (v0.2-beta → v0.3.0)

> v0.2-beta is shipped on alpha-32.4 (Windows-only msi). This
> document plans the remaining modal-by-modal design passes
> against the 20 reference SVGs in
> `D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\`,
> plus the v0.3 candidate list explicitly deferred during v0.2 rounds.
>
> Each P3 modal ships in its own `alpha-N` commit, behind a
> force-pushed `v0.2-beta` tag, with a manual MSI verification
> checklist the user runs end-to-end before the next P3 item
> starts. The 2026-07-09 afternoon compressed 5 alpha drops
> (32, 32.1, 32.2, 32.3, 32.4) in ~6 hours after alpha-32 msi
> surfaced 3 real bugs + 1 mental-model gap + 2 dead switches.

---

## Current state (2026-07-09 16:54)

- v0.2-beta on alpha-32.4 (commit `16f02fc`). Windows msi + portable + nsis.
- 5 alpha drops in one afternoon (alpha-32 / 32.1 / 32.2 / 32.3 / 32.4).
- **P3.2 备份/恢复 modal 完成** (alpha-32) + 3 hotfixes (alpha-32.2).
- **Issue 4 三件套完成** (alpha-32.3): label rename + 数据存储位置 + 📁 chip.
- **5 修复 from review** (alpha-32.4): Switch CSS + auto_connect + auto_rename
  + DB migration 0005 (strip `\\?\` prefix) + storage info style polish.
- All 451 frontend tests + 133 Rust lib tests passing. Bundle 1.19 MB JS /
  39.27 kB CSS.
- Linux + macOS matrix dropped (alpha-32.1) — user only ships Windows msi.
- **Next**: alpha-32.5 per-session override picker → v0.3.0 big release
  (32.3 + 32.4 + 32.5 + 3 long-tail + P3.1 token usage modal).

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

### 3.2 · Backup / Restore modal ✅ SHIPPED (alpha-32 + 32.2)

**Design refs**: `03-create-backup-light.svg`, `04-restore-backup-light.svg`,
`09-create-backup-dark.svg`, `10-restore-backup-dark.svg`.

**Shipped in alpha-32**:
- Single backup modal with 2 stacked cards (not tab nav) per AGENTS.md §4.
- Rust `tauri-plugin-dialog = "2"` + `dialog:default/allow-save/allow-open`.
- 14+ missing CSS rules (`.backup-card / -danger / -verified-badge /
  -confirm-row / -path-row / -path-browse / -password-strength-bar /
  -countdown-confirm`); modal 520 → 560px.
- Tests: 430 → 433 (+3 file-picker tests).

**Hotfixed in alpha-32.2** (3 bugs from manual verification):
- Hide WebView2 native password reveal pseudos (double-eye bug).
- `mismatch` validation now requires BOTH sides `length >= 8` before
  comparing (premature "两次密码不一致" alert).
- Settings modal stays open when backup modal opens (z-index 150 vs 100).

**Hard requirements (AGENTS.md §4) all met**:
- ✅ Restore flow: checkbox + 5 s countdown button.
- ✅ Password input: eye-icon toggle + strength bar.
- ✅ Settings danger-zone uses `var(--danger)` outline (NOT solid red).
- ✅ Modal 560px + max-height 90vh + danger card outline.

**Out of scope (deferred)**:
- Auto-backup schedule (set up daily / weekly auto-backup from settings)
- Backup encryption strength upgrade (Argon2id memory cost tuning)

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

### 3.7 · Per-session project override picker (alpha-32.5) 🆕

**Why this exists**: Manual verification of alpha-32.3 surfaced
that users can only set a *default* project path in settings.
Switching projects requires: open settings → change path → new
session → switch back. Backend already supports per-session
override (`session_update` accepts `project_dir` +
`project_context` patches since alpha-23); the frontend just
never exposed it.

**Design**: A clickable dropdown on the chat-view header project
chip (where alpha-32.3 added the 📁 pill). Click → dropdown:
- **Current** ● — current project (or "未关联项目")
- **Recent** — last 5 unique project paths (MRU list, persisted
  in db_config or session_meta)
- **📂 浏览...** — native folder picker, calls `scanProject` +
  `session_update`
- **🚫 清除项目关联** — sets `project_dir = null`

Backend already supports the patch; this is frontend-only.

**Why this overlaps with Picker (option B)**: We don't need a
separate "new session picker" because the chip dropdown
effectively serves both: "新会话" creates a session with the
default, then the user clicks the chip to pick a different one
(2 clicks, same as a dedicated picker that adds a modal layer).

**Hard requirements (AGENTS.md §4)**:
- Picker re-runs `scanProject` so `project_context` JSON gets
  refreshed (name, version, languages, git remote).
- If the new path fails to scan, show a toast + keep the old
  project_dir (don't blank it out).
- `verified` / `understanding` workflow not affected (this is
  for chat, not for backup/restore).
- Per-session override does NOT change the default project path
  in settings (those are independent).

**P1 scope (this round)**:
1. Click handler on `.session-project-chip` → open dropdown.
2. MRU list (last 5 paths) read from a new db_config key
   `recent_project_paths` (JSON array, LRU).
3. Browse button → `@tauri-apps/plugin-dialog.open({ directory:
   true })` → call `scanProject` + `session_update` +
   `updateHeaderProjectChip()`.
4. Clear option → `session_update({ project_dir: null,
   project_context: null })`.
5. Tests:
   - picker click opens dropdown with current + MRU + browse + clear
   - browse path re-runs scan + updates chip
   - clear sets project_dir to null
6. alpha-32.5 commit + tag `v0.2-beta` (force-push).

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