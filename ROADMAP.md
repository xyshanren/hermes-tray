# Hermes Tray — Roadmap (v0.2-beta → v0.3.0)

> v0.2-beta is shipped (alpha-29). This document plans the remaining
> modal-by-modal design passes against the 20 reference SVGs in
> `D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\`,
> plus the v0.3 candidate list explicitly deferred during v0.2 rounds.
>
> Each P3 modal ships in its own `alpha-N` commit, behind a separate
> v0.2.X release tag, with a manual MSI verification checklist the
> user runs end-to-end before the next P3 item starts.

---

## Current state (2026-07-08)

- v0.2-beta released with assets `hermes-tray-tauri_0.2.0_*`
  (Windows / macOS / Linux bundles for 3 OSes).
- `master` ahead of `origin/master` by 30+ commits (alpha-23~29).
- P1 (10-item UI pass against design 01 + 02) shipped in alpha-27.
- All 430 tests passing; build green on master.

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

### 3.2 · Backup / Restore modal (next up)

**Design refs**: `03-create-backup-light.svg`, `04-restore-backup-light.svg`,
`09-create-backup-dark.svg`, `10-restore-backup-dark.svg`.
v0.1.5 had a CSS bug where the two forms (create / restore) rendered
simultaneously under one tab nav, confusing users about flow. The new
design uses **separated card entries** — click "创建加密备份" opens
the create-only modal, click "恢复备份" opens the restore-only modal,
no shared tab state.

**Hard requirements (AGENTS.md §4)**:
- Restore flow must require TWO confirmations: (a) checkbox "我了解这
  会覆盖当前所有会话/Persona/统计" tick AND (b) a 5-second countdown
  button that flips from "请等待 5s..." to "确认恢复" only after elapsed.
- Password input must have an eye-icon visibility toggle.
- Password input must show a strength bar (weak / fair / strong — score
  by length + character class diversity).
- "数据" group buttons in settings must use `var(--danger)` outline
  (NOT solid red — to avoid impulse-click mistakes).

**P1 scope (this round)**:
1. Split into 2 separate Preact modal components:
   `create-backup-modal.tsx` (file picker for save location, password
   with strength + eye, confirm → calls `backup_create` Rust command).
   `restore-backup-modal.tsx` (file picker for `.htbk` upload, password
   with eye, danger confirmation flow).
2. Settings modal "数据" group wires: button opens the relevant modal.
3. Modal mount pattern uses `mountOverlay(store, root, view)` helper if
   we can land the abstractions cleanly this round. Otherwise the
   alpha-22/24 hidden-class sync pattern (each mount subscribes + toggles
   root classList).
4. Tests:
   - create-backup test: form validation (empty password disables submit)
   - restore-backup test: 5s countdown + checkbox disabled-state mgmt
5. alpha-30 commit + tag `v0.2.0` (no longer beta — version is now stable).

**Out of scope (deferred to v0.3)**:
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