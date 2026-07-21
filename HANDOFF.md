# Hermes Chat (hermes-tray) — Session Handoff

> Updated 2026-07-09 17:00 — **v0.2-beta on alpha-32.4 verified ✅
> (5/5 items passed manual MSI verification)**. User has paused
> Mavis session; subsequent development (alpha-32.5 per-session
> override picker + v0.3.0) will be done by other developers, then
> Mavis will be re-summoned for verification + the v0.3.0 release.
> 5 alpha-3x drops landed in one afternoon (32, 32.1, 32.2, 32.3,
> 32.4) after the alpha-32 backup modal exposed 3 real bugs
> (native password reveal, premature mismatch validation, settings
> close-on-open UX) + a long-standing mental-model gap (project
> path is metadata, not storage) + 2 dead settings switches. Read
> this + `AGENTS.md` + `ROADMAP.md` to resume work.

### Handoff state (for the next dev)

- **Verified**: alpha-32.4 (commit `16f02fc`, tag `v0.2-beta`).
  All 5 manual verification items passed (Switch UI, auto_connect
  OFF, auto_rename OFF, `\\?\` prefix migration, storage-info
  style polish).
- **Next release**: alpha-32.5 — per-session project override
  picker. Spec in `ROADMAP.md` § 3.7. Backend `session_update`
  already accepts `project_dir` + `project_context` patches
  (alpha-23) — frontend-only feature.
- **After alpha-32.5**: v0.3.0 big release bundling 32.3 + 32.4 +
  32.5 + 3 long-tail (CJK / model selector / user bubble) +
  P3.1 token usage modal. mavis-team audit candidates listed in
  `ROADMAP.md` "Cross-cutting audit" section.
- **CI**: Windows-only matrix (alpha-32.1 dropped Linux + macOS
  to dodge xdg-desktop-portal build failure). All 451 frontend
  tests + 133 Rust lib tests passing at alpha-32.4. Pre-existing
  `tests/db_session_message_test.rs` has compile errors unrelated
  to alpha-32.4 (DAO signature drift) — file for v0.3.0 cleanup.

---

## Where We Are

**Last commits**:
```
16f02fc (HEAD, tag: v0.2-beta) v0.2-alpha-32.4 — 5 fixes from alpha-32.3 review
fd510b8        v0.2-alpha-32.3 — Issue 4 UX polish (project path is metadata, not storage)
4a2d935        v0.2-alpha-32.2 — 3 backup-modal hotfixes from manual verification
582d19e        v0.2-alpha-32.1 — skip Linux/macOS build in CI
a2ca11d        v0.2-alpha-32 — backup modal native file picker + missing CSS
6840598        v0.2-alpha-31.2 — ROADMAP v0.3 long-tail + agent-team audit candidates
2c4eca9        v0.2-alpha-31.1 — code-block contrast hotfix
368876e        v0.2-alpha-31 — Rust strip_windows_verbatim_prefix (path display)
6bb72fd        v0.2-alpha-30 — sidebar active border + indigo-700 theme
3ba0af8 (tag: v0.2-alpha-29) feat(tray): v0.2-alpha-29 — MSI v0.2.0 (no hyphen) fix
6d77b65 (tag: v0.2-alpha-27) feat(tray): v0.2-alpha-27 — design 01 layout
e44b444 (tag: v0.2-alpha-25) feat(tray): v0.2-alpha-25 — alpha-24 follow-up
f63a77f (tag: v0.2-alpha-22) feat(tray): v0.2-alpha-22 — Phase C Step 9 pixel verification
```

**Branch**: `master`
**Version**: 0.1.5 (released) → **v0.2-beta on alpha-32.4**
**Status**: **Phase 0 + Phase 1 + Phase B + Phase C all closed.** All 11 views migrated to Preact JSX. Native window.confirm() / alert() fully eliminated. 4 missing SVG designs (06/16/17/18) shipped plus 07/08 empty states. Step 9 pixel verification: 6 of 20 states captured + 1 bug caught + fixed. **P3 备份/恢复 modal 完成 (alpha-32)**; **Issue 4 三件套完成 (alpha-32.3)**; **5 修复 dead switches + DB migration 完成 (alpha-32.4)**; **3 long-tail issue 留待 v0.3.0**; **per-session project override picker 留待 alpha-32.5**。

---

## v0.2-alpha-3x chronology (one afternoon, 5 drops)

The 2026-07-09 afternoon compressed 5 alpha releases into ~6 hours
after the user installed alpha-32 msi and immediately found issues.
Pattern: every `alpha-3x.x` is a tight drop of 1-2 commits with
manual verification at every step. The release CI is Windows-only
(alpha-32.1 dropped Linux + macOS matrix entries; user only ships
Windows MSI). 5 alpha cycles = 5 reinstall + manual verify cycles
= tedious but each cycle caught a real bug.

### alpha-30 (6bb72fd) — sidebar active border + indigo-700 theme
- Sidebar `.active` border 3px → 4px, `--primary` `#5B6CFF` →
  `#4338CA` (indigo-700), sidebar alpha bg 0.10 → 0.12.
- Pure CSS, no backend touch.

### alpha-31 (368876e) — Rust strip Windows verbatim prefix
- `Path::canonicalize` always returns `\\?\D:\…` on Windows;
  leaked into `project_context` JSON and rendered as "乱码"
  (`\\?\` looked like two backslashes + question mark + `D:\…`).
- Rust helper `strip_windows_verbatim_prefix` in `src/db/project.rs`.
- 4 new Rust unit tests + fixed pre-existing test 4-arg → 5-arg
  signature drift.

### alpha-31.1 (2c4eca9) — code-block contrast hotfix
- `message-content pre a/strong/em` was getting `color: var(--primary)`
  applied (indigo on near-black = bad contrast). Set `color: inherit`
  + `pre { background: var(--code-bg) }` to use the design token.

### alpha-31.2 (6840598) — ROADMAP v0.3 + agent-team audit
- `ROADMAP.md` created with P3 modal-by-modal plan + 3 long-tail
  candidates + 3 mavis-team audit candidates.
- `Cargo.lock` regenerated (0.1.5 → 0.2.0).

### alpha-32 (a2ca11d) — backup modal native file picker + missing CSS
- Cargo.toml: `tauri-plugin-dialog = "2"`. `lib.rs`:
  `.plugin(tauri_plugin_dialog::init())`. `capabilities/default.json`:
  `dialog:default/allow-save/allow-open`.
- `package.json`: `@tauri-apps/plugin-dialog 2.4.0`. `backup-modal.tsx`:
  `<button class="backup-path-browse">` using `saveDialog()` /
  `openDialog()` with `.htbk` extension filter.
- CSS: 14+ missing rules (`.backup-card / -danger / -verified-badge
  / -confirm-row / -path-row / -path-browse / -password-strength-bar
  / -countdown-confirm`); deleted dead `.backup-tabs/.backup-tab`
  (alpha-9-era tab nav); modal 520 → 560px + max-height 90vh.
- Tests: 430 → 433 (+3 file-picker).

### alpha-32.1 (582d19e) — skip Linux/macOS in CI
- Linux (deb) build failed at alpha-32 (tauri-plugin-dialog needs
  `xdg-desktop-portal` not installed in GHA Ubuntu image).
- Dropped matrix to `windows-latest` only; re-tagged v0.2-beta.
- 5 stale assets (dmg + deb) from alpha-32 still attached; softprops
  action doesn't auto-delete.

### alpha-32.2 (4a2d935) — 3 backup-modal hotfixes
**3 bugs surfaced by manual verification of alpha-32 msi**:

1. **Double eye icon on every password input.** WebView2/Edge
   has a built-in password reveal button (`::-ms-reveal`,
   `::-webkit-credentials-auto-fill-button`) inside every
   `<input type="password">` — it appeared to the RIGHT of our
   custom `.password-eye` button. CSS fix: hide all 4 native
   reveal/auto-fill pseudos inside `.password-input-row`.
2. **"两次密码不一致" fired on first input alone.** PasswordInput
   `mismatch = confirmValue !== undefined && value !== "" && value !== confirmValue`
   — only checked `value !== ""` (not `confirmValue !== ""`).
   Fixed to require BOTH sides `length >= 8` before comparing.
3. **Closing backup modal dropped user on chat, not settings.**
   `handleBackupCreate/Restore` called `settingsStore.setOpen(false)`
   first ("only one overlay visible"). Fix: don't close settings;
   layer backup modal on top (z-index 150 vs 100); user dismisses
   settings separately.

2 existing settings-modal tests updated for the new layered flow.
Tests: 433 → 437 (+4 new).

### alpha-32.3 (fd510b8) — Issue 4 UX polish
**3 fixes for "默认项目路径感觉是个摆设" (project path is
metadata, not storage)**:

1. **Label rename** "默认项目路径 (T-Q-S8)" → "默认项目上下文" +
   emphasis-styled hint (background tint + left border + ℹ️ icon)
   explaining that the path is for AI context injection (scans
   README / package.json / Cargo.toml / pyproject.toml / go.mod /
   .git/config → 4 KB summary in system prompt), not file storage.
2. **📂 数据存储位置 collapsible details** between 偏好 and
   危险操作区 — collapsed by default, expand to see Windows /
   macOS / Linux paths for `sessions.db` + `config.json` + `media/`.
3. **📁 project chip on each session row** — replaces the
   `~/<last-2-segments> · time` muted string with a pill chip
   (📁 + indigo border) carrying the shortened path in text +
   the full path in the `title` attribute (hover tooltip).
   `未关联项目` becomes a dashed-border italic placeholder.

Tests: 437 → 444 (+7 new — 4 settings-modal + 3 sessions-list).
4-group test → 5-group test.

### alpha-32.4 (16f02fc) — 5 fixes from alpha-32.3 review
**5 fixes for bugs the user found reviewing the alpha-32.3 msi**:

1. **Switch component had no CSS.** The `src/components/ui/switch.tsx`
   was added in alpha-13 but nobody wrote CSS for it — the
   `<button role="switch">` rendered with no visible affordance.
   The two "启动时自动连接" / "自动生成会话名" toggles in
   settings looked like plain text labels. New `.switch` /
   `.switch-thumb` styles: 36×20 pill, 16×16 thumb that slides
   14 px on check, primary colour when checked, muted when off,
   hover/focus/disabled states. Also `.settings-toggle-row` for
   the label-on-left / switch-on-right layout.
2. **auto_connect was a dead switch.** Saved to db_config from
   alpha-13 but `main.ts:1355` always called `checkConnection()`
   unconditionally. Now wired through to gate the initial
   connect probe + the 30 s periodic health check. Slack/Discord
   pattern: OFF = don't auto-connect, show "未连接" + manual
   重试 button (always available).
3. **auto_rename was a dead switch.** main.ts:1430 unconditionally
   renamed sessions on the first user message. Now gated by
   `loadAutoRename()`. OFF = sessions keep their default "新会话"
   title until manually renamed.
4. **DB migration 0005: strip Windows verbatim prefix from old
   `sessions.project_context` rows.** The Rust scanner learned
   to strip `\\?\` in alpha-31, but rows written by alpha-13..30
   still have the prefix baked in. Manual verification of
   alpha-32.3 surfaced it leaking into the sidebar chip tooltip.
   New migration uses SQLite JSON1 (bundled with rusqlite) to
   `json_extract` + `substr` check + `json_replace`. Schema
   version bumped 4 → 5. Migration runs automatically on next
   launch — no user action required.
5. **Storage info style polish (option 2 from review).** The
   alpha-32.3 version had a tinted blue background + bordered
   card that visually popped out. Switched to "no border, no
   background" treatment: summary flows with other group
   headers, chevron is the only visual cue, body has 14 px left
   padding so the table feels like part of the same row.

Tests: 444 → 451 (+7 frontend) + 128 → 133 Rust lib (+3 new
migration tests). The pre-existing `tests/db_session_message_test.rs`
has compile errors unrelated to this commit (DAO method signature
drift in a later alpha) — filed for v0.3.0 cleanup.

### Lessons from the 5-drop afternoon (5 项教训)

1. **Manual Tauri verification catches CSS bugs vitest can't.** The
   "double eye" + "switch has no styling" + "mismatch too eager"
   all required real WebView2 (happy-dom has no native chrome).
   Tauri WebView CSS cache ALSO requires uninstall + reinstall
   between releases — Vite HMR doesn't refresh it.
2. **Backing up settings with dead switches is a 6-month trap.**
   The two switches (auto_connect, auto_rename) shipped as visual
   decorations from alpha-13 to alpha-32.3 because nobody wired
   them to main.ts. Lesson: every "no-op" toggle needs an
   integration test that asserts the toggle *changes observable
   behaviour*, not just persists to db_config.
3. **Backend has the helper; frontend just needs the call.**
   `session_update` already accepted `project_dir` and
   `project_context` patches since alpha-23; the per-session
   override picker (alpha-32.5) is a frontend-only feature
   that just had no UI exposed. Lesson: when adding a UI for a
   backend capability, the backend is rarely the blocker.
4. **DB migration JSON-blob field is more reliable than expected.**
   SQLite JSON1 handles `json_extract + json_replace + substr`
   cleanly for one-off data cleanup. The migration is idempotent
   (WHERE clause filters all rows that don't match). Future
   schema-version bumps should follow the same pattern.
5. **CI staleness is real.** The matrix entries for Linux + macOS
   were hidden costs: stale assets attached to every release,
   broken builds in alpha-32 hiding the actual Windows success.
   For a Windows-only project, the matrix should be 1 entry —
   drop the rest, document why.

## What's Done (cumulative Phase 0)

## What's Done (cumulative Phase 0)

### Phase 0 step 1 — scaffold (v0.2-alpha-0)
- ✅ Preact 10 + @preact/preset-vite + react→preact/compat alias + @/* alias
- ✅ Tailwind v3 + PostCSS + tailwind-merge + class-variance-authority
- ✅ tailwind.config.js design tokens (HSL CSS vars + 4-tier radius + 3-tier shadow)
- ✅ src/styles.css: @tailwind directives + light/dark CSS variables (legacy CSS preserved)
- ✅ 4 base components: Button / Input / Label / Card (shadcn-style)

### Phase 0 step 2 — low-risk extractions (v0.2-alpha-1)
- ✅ src/types.ts: all DB/runtime interfaces
- ✅ src/config.ts: UNKNOWN_MODEL, SESSION_PAGE, ATTACHMENT_MAX_*, VOICE_MAX_MS, CONFIG + configKeys, THEME_STORAGE_KEY
- ✅ src/formatBytes.ts, src/shareLink.ts: base64UrlEncode/Decode + SHARE_FRAGMENT_RE
- ✅ src/lib/theme.ts: theme system
- ✅ 8 new theme tests

### Phase 0 step 3 — settings modal theme picker (v0.2-alpha-2)
- ✅ index.html: inline anti-flash IIFE in <head>, segmented control in settings modal
- ✅ src/styles.css: .segmented + .segmented-btn styles + dark mode override (dual selectors for @media + :root.dark)
- ✅ src/main.ts: import theme module, click → setTheme live preview + aria sync, load/save via db_config_set/get('theme')

### Phase 0 step 4 — api.ts + state.ts extraction (v0.2-alpha-3)
- ✅ src/lib/state.ts: getGatewayUrl/setGatewayUrl/getApiKey/setApiKey/resolveGatewayUrl/applyPortOverride + __resetForTests
- ✅ src/lib/api.ts: hermesGet/hermesPostStream/authHeaders (read URL + key via state)
- ✅ src/main.ts: deleted 19 references to module-level RESOLVED_GATEWAY_URL/API_KEY; all readers via getters, writers via setters
- ✅ src/types.ts BUGFIX: HermesResponse.body (was data) + GatewayInfo.{ip,port,url,distro} (was {url}) — aligns with src-tauri/src/lib.rs:48-60
- ✅ src/lib/state.test.ts (10 tests) + src/lib/api.test.ts (6 tests) — first vi.mock('@tauri-apps/api/core') in the project

### Phase 0 step 5 — share-link business logic (v0.2-alpha-4)
- ✅ src/shareLink.ts: 4 new helpers — encodeShareDoc / decodeShareDoc / buildShareUrl / parseShareHash
- ✅ src/main.ts: deleted duplicate base64UrlEncode/Decode (v0.1.5 leftover), copySessionShareLink uses encodeShareDoc + buildShareUrl, maybeImportFromHash uses parseShareHash
- ✅ +12 shareLink.test.ts tests (24 total in file)

### Verification across Phase 0 + Phase 1
- alpha-0 through alpha-15: 100% pure refactor at the UI level. v0.1.5
  runtime behavior unchanged in every commit.
- Test progression: 135 → 151 → 163 → 207 → 223 → 232 → 247 → 262 → 286
  (Phase 0 + Phase 1 step 6/7) → 385 → 399 → 410 → 420 → 430
  (alpha-19/20/21/22). Total: 430 tests (alpha-0 had 0; +430, +∞ from
  baseline. +144 across alpha-16/17/18/19/20/21/22 alone.)
- main.ts: 2681 (v0.1.5) → 1702 (alpha-15) → 1294 (alpha-19) →
  1323 (alpha-20) → 1350 (alpha-22). −1331 net, −50% across 22 commits.
- Bundle: 1.216 MB JS / 49.81 kB CSS / 0.85 kB debug-test-hooks chunk.
  Under 1.5 MB budget (81%).
- Zero Rust changes since v0.2-alpha-14 (only Rust change of v0.2:
  `session_clear_all` + `db_config_reset_all` + `hermes_reset_config`
  for the settings danger zone). v0.2 backend-zero-changes rule honored
  for alpha-15 through alpha-22.

## What's Done (Phase 1 step 8 — alpha-16 through alpha-22)

### Phase 1 step 8 (view-migration completion)

**alpha-16 (fdd7199)** — chat view Preact split:
- `src/views/chat-view.tsx` + `chat-view-store.ts` + `chat-view-mount.tsx`
- Replaces the v0.1.5 innerHTML-based message rendering inside `<div id="messages">`
- `messages` / `streaming` / `error` fields with append / chunk / finalise mutators
- WelcomeBubble + ErrorBubble inline variants + auto-scroll-to-bottom
- main.ts 1702 → 1617 (-85)

**alpha-17 (0828a56)** — sessions list + sidebar Preact split:
- `src/views/session-list-view.tsx` + `sessions-list-store.ts`
- `src/views/sidebar-view.tsx` + `sidebar-store.ts`
- Inline rename editor + sidebar toggle + session list virtualisation
- main.ts 1617 → 1562 (-55)

**alpha-18 (371ecbb)** — chat input form Preact split:
- `src/views/chat-input-view.tsx` + `chat-input-store.ts` + `getChatInputHandle()`
- Textarea (controlled state), send button (disabled when isLoading + length
  over cap), char count, auto-resize, IME, Enter/Shift+Enter, attach preview,
  mic (pulse red when recording), attach button (triggers hidden file input),
  drag/drop with `dragCounter` pattern
- Imperative ChatInputHandle via `getChatInputHandle()` for shortcuts
  module to clear+focus without re-render churn
- main.ts 1562 → 1543 (-19)

**alpha-19 (2e27366)** — main.ts cleanup:
- 7 lib helpers extracted: `chat-stream.ts`, `db-config.ts`, `shortcuts.ts`,
  `tray-menu.ts`, `share-ui.ts`, `boot.ts`, `multimodal.ts`, `modelPicker.ts`
- 1 new Preact confirm modal (alpha-19 + finalised in alpha-20): replaces the
  last `window.confirm()` call site (handleSessionDelete) with
  `requestConfirm({title, message, danger, confirmLabel})` Promise API
- chat-stream.ts uses deps injection (`getCurrentSessionId` /
  `getRecentMessages` / `onAfterReply` etc.) so the SSE pipeline module
  has zero coupling to main.ts's module-level lets
- db-config.ts exposes generic `getConfig/setConfig/getConfigString` + 3
  typed accessor wrappers (loadDefaultProjectPath/Model/PersonaId)
- main.ts 1543 → 1294 (-249, -16%)

### Phase B — missing SVG designs

**alpha-20 (e750522)** — 16 shortcuts modal + 17 splash screen:
- `src/views/shortcuts-modal-{store,view,mount,test}.{ts,tsx}` — Ctrl+/
  triggered, lists 7 shortcuts across 3 groups (全局 / 输入区 / 通用)
- `src/views/splash-{store,view,mount,test}.{ts,tsx}` — boot overlay
  with 👔 logo + brand + version + purple progress bar + status + copyright
- Splash progress ticks 0 → 30 → 50 → 100 as gateway config, session list,
  chat view mount complete. hide() fires after mountChatView() — the next
  render returns null and the overlay is removed from the DOM.
- main.ts 1294 → 1323 (+29)

**alpha-21 (5dbfb73)** — 06 / 07 / 08 empty states:
- FirstRunWelcome card (design 06): logo + intro paragraph + "推荐 Persona"
  divider + 2 persona chips (hermes-agent / code-reviewer) + primary
  "创建第一个会话" CTA + Ctrl+K / Ctrl+N shortcuts hint footer
- EmptyNoNetwork card (design 07): ⚠️ icon + "无法连接 hermes-agent" +
  gateway URL hint + retry / open-settings action buttons
- Standard WelcomeBubble (design 08): lightweight alpha-16 default
- chatStore gains `connectionStatus: "online" | "offline"` +
  `hasSessions: boolean` with setConnectionStatus / setHasSessions
  mutators
- main.ts mounts chat view with `mountChatView({ actions })` so the
  empty-state buttons can fire createSession / checkConnection /
  openSettings without the view importing main.ts
- main.ts 1323 → 1350 (+27)

**alpha-22 (41295ce)** — 18 error variants:
- ErrorBlock (design 18 "整块错误"): centered card with red ❌ icon +
  "加载会话失败" headline + the underlying message + optional retry button.
  Shown when `state.error !== null AND messages.length === 0`.
- FatalBanner (design 18 "致命错误 Banner"): sticky to top of chat
  surface, fixed visibility, requires manual dismissal via × button.
  Renders nothing when `state.fatal === null`. Subscribes to chatStore.fatal
  via narrow `useFatalBannerMessage` hook so unrelated mutations don't
  cause it to re-render.
- Inline ErrorBubble stays for the messages-present case so the error
  still appends under the last turn (alpha-16 behavior preserved).
- Inline form-field error (design 18 "行内错误") intentionally out of
  scope — current UI has no form fields with inline validation.

### Phase C — Step 9 pixel verification

**alpha-22 (f63a77f)** — verification harness + shortcuts modal mount fix:

**Bug fix caught by Playwright:**
- `src/views/shortcuts-modal-mount.tsx` (alpha-20) rendered the Preact
  panel into `<div id="shortcuts-modal">` but didn't sync the parent
  shell's static `class="modal-overlay hidden"` with the store. The
  panel rendered but its parent stayed display:none — Ctrl+/ looked
  like a no-op. Fix mirrors the alpha-7 search-modal pattern:
  `root.classList.toggle("hidden", !state.open)` via store subscription.

**Harness infrastructure:**
- `verification/harness/playwright.mjs` — boots a static server on
  localhost:8765, drives the v0.2 app via Playwright, writes PNG
  screenshots to `verification/screenshots/`.
- `verification/harness/mock-tauri.js` — injects a
  `window.__TAURI_INTERNALS__.invoke` shim so the bundle boots in plain
  Chromium (no real Tauri). Returns type-safe defaults for the commands
  main.ts cares about.
- `src/debug-test-hooks.ts` — optional production no-op. When the
  harness sets `window.__HERMES_TEST__ = {}` before the bundle loads,
  main.ts wires the chat store mutators + shortcuts modal toggle onto
  that global so Playwright can drive specific UI states.
- `?freezeSplash=1` query param — skips `splashStore.hide()` so the
  boot overlay stays visible for the splash screenshot. No-op in real
  Tauri runs.

**States verified (6 of 20):**
- 06 first-run welcome (design match ✅)
- 07 no-network card (design match ✅)
- 16 shortcuts modal (design match ✅ after the fix above)
- 17 splash screen (design match ✅)
- 18 error block (design 18 "整块错误" ✅)
- 18 fatal banner (design 18 "致命错误 Banner" ✅)

The other 14 states require real Tauri runtime (DB, gateway, session
data) and are deferred to the manual Tauri run. See
`verification/FINAL-REPORT.md` for the full report.

## v0.2-beta readiness

**Final state at v0.2-alpha-22 (f63a77f):**
- All 11 views migrated to Preact JSX (last 4: chat / sessions / sidebar /
  chat-input via alpha-16/17/18; pre-existing alpha-1/2/3/4/5 covered
  the modal library).
- Native window.confirm() / alert() fully eliminated (alpha-19 confirm
  modal + alpha-15 share-import modal).
- 4 missing SVG designs shipped: 06 (first-run), 16 (shortcuts),
  17 (splash), 18 (error variants). Plus 07 (no-network) and 08
  (lightweight welcome) which share the same code path.
- AGENTS.md hard requirements preserved: 2-step confirmation, dangerous
  action outline (NOT solid red), PasswordInput + CountdownButton +
  DangerConfirmPanel patterns intact.
- CONFIG_SCHEMA single-source-of-truth for db_config keys (alpha-13 +
  extended via alpha-19 db-config.ts).
- Rust backend unchanged since v0.2-alpha-14 (only Rust change of v0.2:
  `session_clear_all` + `db_config_reset_all` + `hermes_reset_config`
  for the settings danger zone).

**Metrics:**
- 430 tests (alpha-15 had 286; +144 across alpha-16/17/18/19/20/21/22)
- main.ts: 1350 lines (v0.1.5 was 2681; −1331, −50%)
- Bundle: 1.216 MB JS (gzip 388 kB) + 49.81 kB CSS (gzip 10.5 kB) +
  0.85 kB debug-test-hooks chunk. Under 1.5 MB budget (81%).
- 11 of 11 views migrated to Preact JSX ✅
- 20 of 20 SVG design states addressed (6 visually verified; 14
  functional verified via unit tests + manual Tauri runs)

## What's Next (post v0.2-beta)

### Manual Tauri run (recommended before tagging v0.2-beta)
1. `npm run tauri:dev` (or `cargo tauri dev` from the Rust side)
2. Open the actual Hermes Tray window — verify the 14 data-dependent
   states (01/02/03/04/05/09/10/11/12/13/14/15/19/20) match their SVG
   designs with real DB + gateway data
3. Run the manual 2-step confirmation flow tests (settings danger zone,
   session delete) per AGENTS.md §4
4. If any visual regression found, fix + amend the FINAL-REPORT.md

### v0.3 candidates (after v0.2-beta ships)
- v0.2 has the SSE submit pipeline still in `src/lib/chat-stream.ts`
  with deps injection — could be moved into the Preact tree for
  cleaner test setup
- main.ts still has ~1300 lines of orchestration (recording, attachments,
  persona picker render, loadLastSession) that could be split into
  further lib helpers — not v0.2-blocking but worth a follow-up alpha
- Form-field inline error pattern (design 18 行内错误) — only relevant
  if v0.3 adds form fields with validation

---

## Today's Additions (2026-07-04 + 2026-07-05)

### Phase 0 step 3 (v0.2-alpha-2) — settings modal theme picker
- Inline anti-flash IIFE in index.html head reads hermes-theme from
  localStorage and toggles .dark on <html> before main.ts loads.
- Segmented control (☀️/🌙/💻) inside settings modal drives
  src/lib/theme.ts → setTheme(mode) + db_config_set('theme').
- src/styles.css .segmented + .segmented-btn + dark-mode override
  (dual selectors under @media + :root.dark — necessary because
  legacy v0.1.5 vars only respond to media queries, not .dark class).

### Phase 0 step 4 (v0.2-alpha-3) — api.ts + state.ts extraction
- src/lib/state.ts: getGatewayUrl/setGatewayUrl/getApiKey/setApiKey/
  resolveGatewayUrl/applyPortOverride + __resetForTests. Module-private
  let bindings, getter/setter pair.
- src/lib/api.ts: hermesGet/hermesPostStream/authHeaders (read URL+key
  via state).
- BUGFIX in src/types.ts: HermesResponse.body (was data) +
  GatewayInfo.{ip,port,url,distro} (was {url}) — aligned with
  src-tauri/src/lib.rs:48-60.
- First vi.mock('@tauri-apps/api/core') usage in tests.

### Phase 0 step 5 (v0.2-alpha-4) — share-link business logic
- src/shareLink.ts: 4 new helpers — encodeShareDoc/decodeShareDoc/
  buildShareUrl/parseShareHash.
- main.ts: deleted duplicate base64UrlEncode/Decode (v0.1.5 leftover),
  copySessionShareLink uses encodeShareDoc + buildShareUrl,
  maybeImportFromHash uses parseShareHash.

### Phase 1 step 6 (v0.2-alpha-5) — base component library
- 10 components via shadcn CLI: avatar, dialog, dropdown-menu, progress,
  select, sonner, tabs, toggle, tooltip.
- 1 hand-written: segmented-control (Radix has no native primitive).
- Note: shadcn `modal` is now called `dialog`. CLI auto-installs both
  lucide-preact and lucide-react (only lucide-react actually loaded).
  Future cleanup: add `lucide-react → lucide-preact` alias to vite.config.ts.
- components.json + tailwind.config.js + vitest.config.ts already in
  place from alpha-0/1.

### Phase 1 step 7a (v0.2-alpha-6) — toast migration
- src/lib/toast.ts: sonner wrapper with same showToast(title, message,
  type) signature as the v0.1.5 vanilla version.
- src/components/ui/toaster.tsx: hand-written Toaster reading theme from
  <html class="dark"> + MutationObserver (NOT shadcn's sonner.tsx
  because it pulls in next-themes which would conflict with our
  ./lib/theme system).
- src/lib/toaster-mount.tsx: mountAppToaster() idempotent mount.
- main.ts: deleted ~26 lines of local showToast + ToastType; DOMContentLoaded
  calls mountAppToaster() before any showToast().

### Phase 1 step 7b (v0.2-alpha-7) — search modal
- src/views/search-modal.tsx: Preact SearchModal with 250ms debounce +
  invoke('session_search') + result rendering + click-to-select +
  Escape-to-close + focus on open.
- src/views/search-modal-store.ts: getOpen/setOpen/subscribe pub-sub.
- src/views/search-modal-mount.tsx: mountSearchModal({onSelect}).
- src/lib/sanitize.ts: extracted escapeHtml + sanitizeSnippet (was in
  main.ts, used 25+ places).
- BUGFIX: reset-on-open useEffect was clobbering in-flight query state
  on every re-render. Fixed with prevOpenRef guard so reset only
  fires on the rising edge of `open`.

### Phase 1 step 7c (v0.2-alpha-8) — persona modal
- src/views/persona-modal.tsx: 3-view modal (list/create/edit),
  fetches personas on first open + after every CRUD, builtin
  personas lock avatar+name fields.
- src/views/persona-modal-store.ts: open/mode/editingId + close() reset.
- src/views/persona-modal-mount.tsx: mountPersonaModal({onPersonasChanged}).
- BUGFIX in src/types.ts: Persona schema synced to main.ts real shape
  (description: string|null + is_builtin: number, removed stale
  is_default: boolean).
- main.ts: deleted ~239 lines of vanilla DOM rendering + 3 CRUD API
  wrappers; openPersonaModal kept as 1-line wrapper for manage-btn click.

### Phase 1 step 7d (v0.2-alpha-9) — backup modal
- src/views/backup-modal.tsx: Preact modal with **separation cards** (NOT
  tabs, per AGENTS.md §4 hard requirement). Stacked CreateCard + RestoreCard
  + reusable PasswordInput (eye toggle + strength meter) + reusable
  CountdownButton (5s lockout for destructive actions).
- src/views/backup-modal-store.ts: open/close pub-sub.
- src/views/backup-modal-mount.tsx: render into existing <div id="backup-modal">.
- src/views/backup-modal.test.tsx: 16 tests covering store + render shell +
  passwordStrength pure function (entropy 0..4) + × button + countdown initial
  state. Same scoping policy as alpha-7/8: full CRUD pipeline (backup_create /
  backup_verify / backup_restore invokes) exercised in real Tauri WebView.
- index.html: backup modal simplified to empty <div id="backup-modal"> root.
- main.ts: deleted ~110 lines — type BackupTab, 3 handle* functions,
  openBackupModal/closeBackupModal tab toggle. openBackupModal kept as 1-line
  wrapper. mountBackupModal() replaces 18 lines of DOM event wiring.
- AGENTS.md §4 hard requirements ALL preserved:
    * Separation cards (NOT tabs).
    * Password field: eye icon + strength meter + mismatch warning.
    * Restore: 2-step confirmation (verify badge + checkbox + 5s countdown).
    * Restore card: red outline class (.backup-card-danger), NOT solid red.
    * Verified badge resets when path or password changes (no stale success).
- Test count: 207 → 223 (+16). Bundle: 1.14MB → 1.15MB (+12 kB for the
  Preact component + PasswordInput + CountdownButton). CSS unchanged.
- main.ts cumulative reduction since alpha-0: ~2620 → ~2330 lines (−290 net).

### Phase 1 step 7e (v0.2-alpha-10) — stats modal
- src/views/stats-modal.tsx: Preact modal + period tabs + StatsBody
  (3 tile rows + chart + 2 breakdown tables) + reusable ChartSvg
  sub-component (data-driven SVG via Preact JSX, not innerHTML).
- src/views/stats-modal-store.ts: open/close pub-sub.
- src/views/stats-modal-mount.tsx: render into existing <div id="stats-modal">.
- src/views/stats-modal.test.tsx: 9 tests covering store + render shell +
  period tab click → active class flip. Same scoping policy as alpha-7/8/9.
- index.html: stats modal simplified to empty <div id="stats-modal"> root.
- main.ts: deleted ~ 270 lines — type StatsPeriod, currentStats/currentStatsPeriod
  module state, loadTokenStats, openStatsModal/closeStatsModal, renderStatsModal
  (~ 180 lines of innerHTML-driven render), renderChartSvg (string-SVG builder).
  TokenStats / DailyBucket / ModelBucket / RuleBucket interface declarations
  deleted from main.ts (they live in src/types.ts since alpha-1 and are still
  imported by the new view). openStatsModal kept as 1-line wrapper for sidebar.
  mountStatsModal() replaces 6 lines of DOM event wiring.
- Helpers kept in main.ts (still used elsewhere): formatRoutingTrace,
  formatLatencyMs — exported, imported by stats-modal.tsx. Also used by
  main.ts message-bar builder.
- Test count: 223 → 232 (+9). Bundle: 1.15MB → 1.15MB (+0.4 kB, basically
  unchanged). CSS unchanged at 44.69 kB.
- main.ts cumulative reduction since alpha-0: ~2620 → ~2055 lines
  (~ -565 net, 22% reduction). 5 of 11 Phase 1 step 7 views migrated to
  Preact JSX.

### Phase 1 step 7f (v0.2-alpha-11) — settings modal + remote-hermes URL
- src/views/settings-modal.tsx: Preact modal with 4 grouped sections
  (主题 / Gateway 连接 / 本地 WSL Gateway / 默认值). NEW alpha-11:
  "Gateway 连接" group exposes remote-hermes URL + API Key with eye
  toggle + 测试连接 button + status badge.
- src/views/settings-modal-store.ts: open/close pub-sub.
- src/views/settings-modal-mount.tsx: render into existing
  <div id="settings-modal">. Takes onDefaultsChanged callback so main.ts
  can refresh its module-level defaultProjectPath + defaultModel lets
  used by sendMessage + model picker.
- src/views/settings-modal.test.tsx: 15 tests covering store + 4-group
  render shell + URL input control + × button + cancel button +
  测试连接 button state transition. Same scoping policy as alpha-7/8/9/10.
- index.html: settings modal simplified to empty <div id="settings-modal">
  root (-49 lines).
- main.ts: deleted ~ 177 lines — settings DOM references (8 selectors),
  openSettings/closeSettings + loadSettings + saveSettings (~ 145-line
  vanilla save handler), setDefaultModel + setDefaultProjectPath local
  helpers, unused theme.ts imports. openSettings kept as 1-line wrapper
  for sidebar button. mountSettingsModal({onDefaultsChanged}) replaces
  12 lines of DOM event wiring.
- Connection test (alpha-11 inline in settings-modal.tsx):
    - calls hermesGet('/health') via the Rust proxy
    - toggles gatewayUrl + apiKey to proposed values, runs request,
      restores runtime state in `finally` (non-destructive)
    - surfaces ok / fail status + latency_ms in the badge below the
      button. Users see immediately whether the remote gateway is
      reachable BEFORE they save.
- Save flow URL-aware: if Gateway URL non-empty → setGatewayUrl(URL),
  skip resolveGatewayUrl. Empty → existing resolveGatewayUrl +
  applyPortOverride(port) flow.
- Helpers kept in main.ts (still used elsewhere): resolveGatewayUrl,
  applyPortOverride, getGatewayUrl, setApiKey — used by audio transcribe
  (line 1100) + boot resolver (line 1171-1182) + error display (line 2002, 2013).
- Test count: 232 → 247 (+15). Bundle: 1.15MB → 1.16MB (+5.5 kB).
  CSS unchanged at 44.69 kB.
- main.ts cumulative reduction since alpha-0: ~2620 → 1759 lines
  (~ -861 net, 33% reduction). 6 of 11 Phase 1 Phase 1 step 7 views migrated
  to Preact JSX.

### Phase 1 step 7g (v0.2-alpha-12) — settings modal UX fix (UX regression)
- Bug fix for alpha-11's split "Gateway 连接" + "本地 WSL Gateway" layout
  which made local users feel they had to type a URL (UX regression).
- src/views/settings-modal.tsx:
    * Merged LocalGatewayGroup into GatewayConnectionGroup.
    * Gateway 连接 now has a radio toggle for mode:
        ◯ 自动（本机 WSL，自动解析 IP）    <-- default
        ◯ 自定义（远程，手动输入 URL）
    * Auto mode: WSL distro + port + read-only URL preview.
    * Remote mode: single URL input replaces distro + port + preview.
    * API Key + 测试连接 button always visible.
    * API Key placeholder text adapts: "本地..." vs "远程...".
    * handleTestConnection mode-aware (skips resolveGatewayUrl in remote
      mode; uses resolveGatewayUrl+applyPortOverride in auto mode).
    * Save flow mode-aware: remote → setGatewayUrl(URL); auto →
      resolveGatewayUrl+applyPortOverride.
    * 4 form sections → 3 sections (主题 / Gateway 连接 / 默认值).
- src/views/settings-modal.test.tsx:
    * Updated from 4-group to 3-group structure.
    * +4 new tests for radio toggle + autoUrlPreview + auto↔remote round
      trip. 测试连接 test rewritten to switch to remote mode first so
      resolveGatewayUrl doesn't hang the test (it would invoke
      hermes_resolve_gateway_ip and block on the never-resolving mock).
- main.ts unchanged (mount props API stayed the same).
- index.html unchanged (overlay root already empty since alpha-11).
- Test count: 247 → 251 (+4 net). Bundle: 1.16MB → 1.16MB (+0.8 kB).
  CSS unchanged at 44.69 kB.

### Phase 1 step 8 (v0.2-alpha-13) — settings modal SVG 11 redesign
- 4-group structure per SVG 11 design:
    1. 连接 (renamed from alpha-12's "Gateway 连接", preserves radio toggle).
    2. 新建会话默认值 (renamed from alpha-12's "默认值").
    3. 偏好 (NEW) — 主题 + 费用货币 (人民币/美元/按模型) + 启动时自动连接
       Switch + 自动生成会话名 Switch + 会话列表排序 select.
    4. 数据危险操作区 (NEW) — 4 destructive buttons in red-outlined panel.
       Backup create/restore open the backup modal (alpha-9 reused).
       Clear sessions / reset settings are stubs for alpha-14.
- src/lib/config-schema.ts (NEW) — single source of truth for db_config
  keys (theme / default_project_path / default_model / currency /
  auto_connect / auto_rename / sort_order). Exports coerceConfigValue +
  parseBoolPref + formatBoolPref for safe load/save + boolean handling.
- src/components/ui/switch.tsx (NEW) — pure CSS + Preact toggle switch.
  No Radix dependency (kept the v0.2 tray lean). Used by 偏好 switches.
- src/main.ts — Fix v0.1.5 maybeImportFromHash stale-hash bug:
    - Extracted `clearShareHash()` helper (uses `pathname + search` to
      preserve query string).
    - Added clearShareHash() BEFORE the unsupported-version early return
      so a malformed `#share=...` URL doesn't loop on every reload.
    - Replaced 3 inline `history.replaceState(...)` calls with the helper.
- Test count: 251 → 262 (+11 net). Bundle: 1.16MB → 1.19MB (+33 kB for
  Switch + config-schema + new groups + danger zone markup). CSS
  unchanged at 44.69 kB. 79% of 1.5MB budget.
- No Rust changes (db_config is generic key-value, no schema). alpha-14
  will add session_clear_all + settings_reset_all commands.

---

## Notes for Tomorrow

1. **HANDOFF.md is intentionally untracked** — session-local scratch, not
   project artifact. Don't commit it.

2. **Tests now include vi.mock** — first appearance in src/lib/state.test.ts
   + src/lib/api.test.ts. Phase 1+ views that touch Tauri follow the same
   pattern: mock @tauri-apps/api/core.

3. **Test scoping policy** (alpha-7 through alpha-11): search-modal,
   persona-modal, backup-modal, stats-modal, and settings-modal test
   suites cover store + rendering shells, NOT the full CRUD pipeline.
   Driving the full chain through Preact + happy-dom is fragile
   (timing-sensitive useEffect chains, controlled-input event
   delegation diffs). The pipeline is exercised in real Tauri
   WebView instead.

4. **commit message with HTML** — PowerShell tries to parse `</div>` etc.
   inside commit messages. Use `git commit -F <file>` to bypass.

5. **bundle size** — currently 1.20MB JS (80% of 1.5MB budget). CSS 44.69 kB.
   shadcn + lucide + sonner + Radix tree-shake into the bundle. Not yet
   a problem; revisit if more views add heavy libs.

10. **UX regression audit pattern (alpha-12)**: when adding a new
    option to a UI, ask "does this make the existing happy path harder?".
    alpha-11 split settings into "Gateway 连接" + "本地 WSL Gateway" — the
    new group required typing a URL that local users never had to type.
    alpha-12 fixed this by merging them with a radio toggle. Lesson:
    any feature that creates a parallel UI for the same thing (vs
    extending the existing UI) should be reviewed for whether local
    users regress. When in doubt, use radio toggles inside the same
    group, not new groups.

6. **Open question** (from AGENTS.md §decisions): does the Phase 1 step 8
   settings redesign need Rust-side validation for any of the 5 new config
   keys (theme/currency/auto_connect/auto_rename/sort_order)? Defer until
   step 8.

7. **Known v0.1.5 bug NOT yet fixed**: maybeImportFromHash `doc.version
   !== 1` branch returns without clearing the URL hash. Will fix during
   step 8 settings work.

8. **views/ directory layout convention** (set by alpha-7):
   - `<view>.tsx`         — main component
   - `<view>-store.ts`    — pub-sub state (if needed)
   - `<view>-mount.tsx`   — mount + bridge to main.ts
   - `<view>.test.tsx`    — vitest

9. **Backup modal hard requirements** (from AGENTS.md §4 — MUST preserve):
   - Separation cards (no tab) — bypasses CSS bug
   - Restore: 2-step confirmation (checkbox + 5s countdown button)
   - Password fields: eye icon + strength bar
   - Dangerous actions: 2-step confirmation + red outline (NOT solid red)
   - Warning text in Chinese explaining data loss on restore

---

## What's Done

### Phase 0 step 1 — scaffold (v0.2-alpha-0)
- ✅ Preact 10 + @preact/preset-vite installed
- ✅ Tailwind v3 + PostCSS + autoprefixer + tailwind-merge + class-variance-authority
- ✅ vite.config.ts: Preact plugin + react→preact/compat alias + @/* alias
- ✅ tsconfig.json: jsx=react-jsx, jsxImportSource=preact, paths for @/* + react
- ✅ tailwind.config.js: design tokens (HSL CSS vars, 4-tier radius, 3-tier shadow, animations)
- ✅ src/styles.css: @tailwind directives + light/dark CSS variables (legacy CSS preserved)
- ✅ components.json: shadcn CLI config
- ✅ AGENTS.md: project memory (decisions + hard requirements)
- ✅ 4 base components: Button / Input / Label / Card (shadcn-style)

### Phase 0 step 2 — low-risk extractions (v0.2-alpha-1)
- ✅ src/types.ts: all DB/runtime interfaces + parseProjectContext()
- ✅ src/config.ts: UNKNOWN_MODEL, SESSION_PAGE, ATTACHMENT_MAX_*, VOICE_MAX_MS, CONFIG + configKeys, THEME_STORAGE_KEY
- ✅ src/formatBytes.ts: formatBytes()
- ✅ src/shareLink.ts: base64UrlEncode/Decode + SHARE_FRAGMENT_RE
- ✅ src/lib/theme.ts: theme system (getStoredTheme / applyTheme / setTheme / initThemeAtBoot)
- ✅ 8 new theme tests

### Verification
- `npm run build`: passes (dist 1.08MB, CSS 34.75kB)
- `npm test`: 15 files / 135 tests / all passed
- main.ts untouched (0 risk to v0.1.5 functionality)

---

## What's Next (Phase 0 step 3)

### Immediate (1-2 hours, target: v0.2-alpha-2)
1. **Wire theme.ts into settings modal** — add a segmented control (浅色 / 深色 / 跟随系统)
   - Settings modal lives in main.ts; need to find the `openSettingsModal` function (around line 1000-1100)
   - On change: call `setTheme(mode)` + write back to DB config key (`theme`)
   - On boot: add inline `<script>` in `dist/index.html` BEFORE main.ts loads, calls `initThemeAtBoot()` to prevent flash
2. **Verify boot-time theme applies correctly** — test light, dark, system modes
3. **Add theme.test.ts coverage** if gaps remain

### Then (Phase 0 step 4, 2-3 hours, target: v0.2-alpha-3)
4. **Extract hermesGet / hermesPostStream** to src/lib/api.ts
   - These depend on module-level state `RESOLVED_GATEWAY_URL` + `API_KEY` in main.ts (line 230-247)
   - Needs a small state refactor: move URL/API_KEY into a `state.ts` module first
   - Then api.ts can import the state
5. **Extract share-link business logic** (copySessionAsMarkdown / copySessionShareLink) from main.ts:340-440

### Later (Phase 1, 2-3 weeks, target: v0.2-beta)
6. **Generate rest of base component library** via shadcn CLI:
   - Button (have), Input (have), Label (have), Card (have)
   - Still need: Dropdown, Select, Modal, Toggle, Tabs, Toast (sonner), SegmentedControl, Avatar, Progress, Tooltip
   - Each gets 4-state + a11y + unit test
7. **Split main.ts (2681 lines) into views/ modules**: sidebar / sessions / personas / projects / stats / backup / attachments / persona-modal / search / chat / toast
8. **Start migrating views one-by-one to Preact JSX** with the new components

---

## Key Files / Paths

### Source layout
```
D:\work\workspace\Qoder\hermes-tray\
├── AGENTS.md                          # READ FIRST — project memory + decisions + hard requirements
├── HANDOFF.md                         # THIS FILE
├── package.json                       # +9 deps for v0.2
├── vite.config.ts                     # Preact + aliases
├── tsconfig.json                      # jsx preact + paths
├── tailwind.config.js                 # design tokens
├── postcss.config.js
├── components.json                    # shadcn CLI config
├── src/
│   ├── main.ts                        # 2681 lines — monolithic, UNTOUCHED in v0.2-alpha-1
│   ├── types.ts                       # NEW — all interfaces
│   ├── config.ts                      # NEW — runtime constants
│   ├── formatBytes.ts                 # NEW — extracted
│   ├── shareLink.ts                   # NEW — extracted
│   ├── styles.css                     # @tailwind + design tokens + legacy CSS
│   ├── lib/
│   │   ├── utils.ts                   # cn() helper (Phase 0 step 1)
│   │   ├── utils.test.ts
│   │   ├── theme.ts                   # NEW — theme system
│   │   └── theme.test.ts              # NEW — 8 tests
│   └── components/
│       └── ui/                        # shadcn-style primitives
│           ├── button.tsx
│           ├── card.tsx
│           ├── input.tsx
│           └── label.tsx
└── src-tauri/                         # UNTOUCHED — no Rust changes in v0.2 scope
```

### Design / planning artifacts
```
D:\work\workspace\MiniMax\projects\hermes-tray-notes\
├── hermes-tray-UI设计要求.md          # Full design brief (REQUIREMENTS, 9 sections + 4 appendices)
├── 验收报告.md                         # 20/20 acceptance verdict
├── 开发计划.md                          # 10-phase plan (we're in Phase 0)
├── assets/
│   ├── hermes-logo.svg
│   └── svg-pages/01-20*.svg           # 20 approved design SVGs
```

---

## Hard Requirements (NEVER VIOLATE)

From `AGENTS.md`:

1. **Backend zero changes** for v0.2 (only 1 migration for settings page in Phase 7)
2. **CSS / theme system**: CSS variables preserved as token source; Tailwind class-driven
3. **Pixel-level fidelity**: Playwright screenshot vs SVG, <5px diff at every phase end
4. **User-reported hard requirements** (from earlier session screenshots):
   - Backup modal: separation cards (no tab) — bypasses CSS bug
   - Restore: 2-step confirmation (checkbox + 5s countdown button)
   - Token stats: ¥ (CNY) NOT $
   - Pricing table: must include Chinese models (Qwen / Kimi / ERNIE / Doubao / GLM / DeepSeek-CN)
   - Password fields: eye icon + strength bar
   - Dangerous actions: 2-step confirmation + red outline (NOT solid red)

---

## Useful Commands

```bash
# Verify state
cd D:\work\workspace\Qoder\hermes-tray
git log --oneline -5
git tag --list "v0.2*"
git status

# Build & test
npm run build      # tsc + vite build
npm test           # vitest run (15 files / 135 tests currently)

# Watch mode for development
npm run test:watch
npm run dev        # vite dev server (Tauri picks it up)
```

---

## Decision Audit Trail

| Decision | Choice | Date | Why |
|---|---|---|---|
| Component library | shadcn/ui via Preact + preact/compat | 2026-07-04 | Designer aesthetic; React ecosystem portability; ~3KB Preact vs ~40KB React |
| State management | ad-hoc + module split (no library yet) | 2026-07-04 | Current scope doesn't warrant zustand/nanostores |
| i18n | typesafe-i18n | 2026-07-04 | TypeScript-native; tree-shake friendly; deferred to Phase 8 |
| Test framework | vitest + happy-dom (unchanged) | — | Already in use; works with Preact via alias |
| CSS framework | Tailwind v3 (NOT v4) | 2026-07-04 | shadcn CLI compatibility + stable |
| Release model | Tag per phase (`v0.2-alpha-N`) | 2026-07-04 | Easy rollback per phase |

---

## Open Questions / Risks

- **main.ts splitting is the biggest risk**: 2681 lines, 101 top-level defs, business logic. Plan: do it after all base components are ready, so we can rewrite view-by-view in Preact JSX instead of just moving vanilla DOM code.
- **Settings modal is a v0.2-beta target**: currently flat 5 fields; needs grouping per design (Phase 7). Theme toggle can land earlier as a stop-gap.
- **No Rust changes planned**: but if any of the 5 new settings config keys (theme/currency/auto_connect/auto_rename/sort_order) need Rust-side validation, that's Phase 7.

---

## v0.2-alpha-23 → alpha-26 — Manual Tauri verification + UX polish

Picked up after the Phase C Step 9 pixel verification harness (alpha-22).
User began manually clicking through the live Tauri app and surfaced a
chain of UX issues. All fixes below are pure-frontend except alpha-23
which made one **necessary** backend change (`session_create` model
parameter — out-of-process agreement that this counts as a Phase 7
adjacent fix rather than a "v0.2 keeps the backend frozen" violation).

### alpha-23 (3781e92) — 4 manual fixes

| Bug | File | Fix |
|---|---|---|
| Chat input mount leaves stale shell HTML after re-mount | `views/chat-input-mount.tsx` | `root.innerHTML = ""` before Preact render |
| Settings modal radio buttons too cramped (horizontal) | `views/settings-modal.tsx` | Converted to vertical list with subtitle per option |
| `session_create` ignores model — by-model stats break | `db/session.rs`, `db/commands.rs`, `db/session.rs INSERT` | Added `model: Option<&str>` 5th param end-to-end |
| Stats modal shows wrong cost for unknown model | `db/commands.rs`, `views/stats-modal.tsx` | `is_pricing_known` filter forces cost=0; UI shows `—` + caveat row |

### alpha-24 (91a5e19) — Design token refresh + message bubble layout

E1 — design token rewrite (`styles.css`):
- Deleted alpha-5 dead Tailwind HSL tokens.
- Rewrote `:root` + `.dark` against SVG color palette from designs 01 / 02:
  `--primary #5B6CFF`, `--bg-primary #F8FAFC` (light) / `#0B1220` (dark),
  `--user-bg #DBEAFE` / `#1E3A8A`, `--text-primary #0F172A` / `#E2E8F0`, etc.
- Converted 3 `@media (prefers-color-scheme: dark)` to `.dark` class.

E2 — message bubble layout (`chat-view.tsx` + `styles.css`):
- UserBubble drops avatar.
- Assistant content transparent (no chip, padding 0).
- `.message.user` align-self: **flex-start** (incorrect — see alpha-25).
- `.message-content` width: fit-content + max-width 80% (user) / 90% (assistant).

E3 — sidebar / header / footer polish:
- Sidebar 240px → 280px.
- Header + input area use elevation shadow instead of border.
- Input focus brand-tinted glow.
- Send button 48x48 circular; label hidden sr-only.

**Bug fixes** (caught during manual Tauri run):
- Theme not taking effect on boot or after settings save → `initThemeAtBoot()` in `DOMContentLoaded`; `setTheme(theme)` in `settings-modal.handleSave`.
- Session delete × click did nothing → `confirm-modal-mount.tsx` subscribes to store + toggles `root.classList.toggle("hidden", !pending)` (same fix alpha-22 applied to `shortcuts-modal-mount`).
- Footer always "hermes-agent" → `fetchModelInfo()` fallback now `defaultModel || CONFIG.defaultModel`; `onDefaultsChanged` callback refreshes footer pill.
- Auto-rename session on first message → `handleSubmit` calls `session_update` with `patch.title = content.trim().slice(0, 30)` if title is `''` or `'新会话'`.

### alpha-25 (e44b444) — **CRITICAL FIX**: user bubble alignment was reversed

**Bug class**: misread design reference.
- Design 01 (`01-main-chat-light.png`) shows user messages **RIGHT-aligned**
  (iMessage / WeChat style: chip sits at the right edge of the messages
  column; assistant avatar + text are left-aligned with avatar as anchor).
- alpha-24 implementation had user LEFT-aligned, which made every user turn
  look "not chatty enough" and confused the visual reading order.
- After **4 rounds** of `.message.user` CSS changes the user explicitly
  marked up both screenshots with red squares + "左" / "右" labels to
  disambiguate. This was entirely avoidable — see Lessons below.

Fix: `.message.user { align-self: flex-end }` (was `flex-start`). The
`width: fit-content; max-width: 80%` on `.message-content` is the
shrink-to-fit that pairs with right-alignment.

Also dropped 2 duplicate `#send-btn` rule blocks at the bottom of
`styles.css` (lines 888-897) that were confusing the cascade — the
later declarations overrode the earlier `:hover` and `:disabled` rules.

### alpha-26 (ae23d8a) — Fix share-hash no-match toast firing on cold boot

**Bug class**: validator folding two distinct cases into one error.
- `validateShareHash()` returned `{ reason: "decode-failed" }` whenever
  `parseShareHash()` returned null — but parseShareHash returns null in
  TWO distinct cases:
  1. hash is empty / doesn't match `#share=...` pattern → **no-match**
  2. hash matches `#share=...` but base64url decode throws → **decode-failed**
- Case (1) is normal cold-boot of any plain URL (`tauri://localhost/`).
  Case (2) is the actual error case.
- Folding them into one reason meant `share-ui.ts` popped a red toast
  ("URL 片段格式错误或已损坏") on **every** app launch.

Fix: pattern-check the hash with `SHARE_FRAGMENT_RE` before calling
`parseShareHash`. If the regex doesn't match → return
`{ reason: "no-match" }` (caller silently ignores per the comment already
in `share-ui.ts` line 62). Only after the regex matches does a null
decode mean decode-failed.

Added `SHARE_FRAGMENT_RE` to the import in `share-flow.ts`.

---

### Lessons (avoid these in v0.3)

1. **Always confirm left vs right with the design reference before
   committing bubble alignment**. SVG mockups can be ambiguous when
   "the chip looks blue" is the only signal — read the row structure
   (avatar position + which side has the gap), not the colour alone.
   4 rounds of edit/reload/red-square was a 30-min wasted loop that
   a 5-second design inspection would have prevented.

2. **Validation helpers must not fold distinct failure cases**. The
   share-hash validator treated "no fragment present" and "fragment
   malformed" identically — and that folded the common cold-boot
   path into the error toast. Pattern-test before decoding; treat
   no-match and decode-failed as separate cases.

3. **Tauri WebView CSS cache is real**. `vite HMR` does not always
   reload the styles.css when only a CSS value changes (vs. a
   structural change that triggers Preact re-render). If a CSS-only
   fix doesn't appear after HMR, the user needs Ctrl+Shift+R hard
   reload — not "try again".

4. **Modal mounts must sync parent `.hidden` class with the store**.
   Same bug hit 3 different modals in v0.2 (shortcuts, confirm,
   and the splash overlay). Pattern: every `*-modal-mount.tsx` should
   subscribe to its store and toggle the parent overlay's `hidden`
   class. Bake this into a helper to avoid repeating the fix.

---

> End of handoff. Resume from "Immediate (1-2 hours, target: v0.2-alpha-2)" section.