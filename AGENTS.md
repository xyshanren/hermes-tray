# Hermes Chat (hermes-tray) — Agent Memory

> Project memory for hermes-tray. Read this first before touching any file.
> Updated 2026-07-21 21:35 — v0.2.0 STABLE shipped (commit `d7ee96f`,
> tag `v0.2.0`, 8/8 manual MSI verification). v0.2.1 patch in flight
> (commit `2790386`, tag pushed, CI in progress). 5 post-release fixes
> layered on top: voice transcription snake_case + closeable error
> toasts, routed model display in footer, persona library single-column
> layout, paste-import share link entry, build fix (drop
> pauseWhenPageIsHidden — sonner 2.0.7 ToasterProps doesn't declare
> it; same prop already removed in b911ee2 but re-introduced by `--theirs`
> conflict resolution during cherry-pick of 2c0f4a8).
> **Next**: v0.3.0 cycle (4 phases, ~6.5 days planned). Detail in
> `ROADMAP.md` § v0.3.0 开发计划.

---

## Project Snapshot

| 项 | 值 |
|---|---|
| 产品形态 | Tauri 2 桌面应用（Rust 后端 + WebView 前端） |
| 当前版本 | **v0.2.0 STABLE** (commit `d7ee96f`, tag `v0.2.0`). **v0.2.1 patch** in flight (commit `2790386`, CI in progress) |
| 上一版本 | v0.1.5（功能完整，UI 待重做） |
| 下一版本 | v0.3.0 — Phase 1 CSS catch-up → Phase 2 Toast/Persona → Phase 3 Search/Stats/细节 → Phase 4 long-tail + audit |
| 项目根 | `D:\work\workspace\Qoder\hermes-tray` |
| 前端 | Preact 10 + Vite + Tailwind v3 + shadcn/ui via preact/compat |
| 后端 | Rust + rusqlite + tokio + aes-gcm + argon2 |
| 测试 | 13 个 .test.ts 文件，430 tests passing (vitest + happy-dom) |
| 设计稿位置 | `D:\work\workspace\MiniMax\projects\hermes-tray-notes\`（20 张 SVG + 验收报告 + UI 设计要求） |
| 路线图 | [`ROADMAP.md`](./ROADMAP.md) — v0.2-beta → v0.3.0 P3 modal-by-modal + P2 deferred list |

---

## v0.2 Architecture Decisions（2026-07-04 已确认）

### 决策 ① 组件库：**A. shadcn/ui（搭配 Preact）**

- **路径**：vanilla TS 项目直接装 shadcn/ui 跑不起来（shadcn 是 React 专属）
- **解决方案**：加 Preact (3KB) + `preact/compat` 别名，shadcn 生成的源码基本不用改就能跑
- **设计哲学保留**：设计师选的"现代 + 国际化"基调，对应 shadcn/ui 的审美
- **风险**：main.ts 的 2681 行 DOM 操作要全部重写成 JSX（h()/className）—— 列入 Phase 0 子任务

### 决策 ② 状态管理：**A. 继续 ad-hoc + 模块化拆分**

- 当前没用任何状态库，5 个 modal 各自独立、会话列表用 invoke 拉数据
- 引入状态库收益不大，等真的痛了再上 nanostores
- **不引入 zustand / nanostores / pinia 等**

### 决策 ③ i18n：**A. typesafe-i18n**

- TypeScript 原生、tree-shake 友好、零运行时
- 配置：Phase 8 阶段做

---

## v0.2-alpha-26 当前状态（2026-07-07）

**Backend**: 唯一允许的越界改动 = `session_create` 加 `model: Option<&str>` 5th param
（alpha-23）。其他 Rust 代码零改动。其他"v0.2 keeps the backend frozen"约束保留。

**Frontend 完成度**:
- ✅ Phase A — chat-view Preact split (alpha-16)
- ✅ Phase B1/B2 — sessions-list + sidebar Preact split (alpha-17)
- ✅ Phase B2 — chat-input form Preact split (alpha-18)
- ✅ main.ts cleanup, lib helpers extracted (alpha-19)
- ✅ Phase B — 16 shortcuts modal + 17 splash screen (alpha-20)
- ✅ Phase B3 — 06 first-run welcome + 07 no-network cards (alpha-21)
- ✅ Phase B4 — 18 error block + fatal banner (alpha-22)
- ✅ Phase C — Step 9 mock-tauri.js + playwright pixel verification (alpha-22)
- ✅ Manual Tauri fixes — 4 bugs from manual verification (alpha-23)
- ✅ Design tokens + bubble layout + 4 manual fixes (alpha-24)
- ✅ **CRITICAL** user bubble right-alignment (alpha-25)
- ✅ Share-hash no-match toast fix (alpha-26)

**Outstanding (next)**:
- 🚧 v0.2 UI 第二轮改造 — 按设计稿深度像素级比对
- 🚧 Tag `v0.2-beta` push + GitHub Actions CI release
- 🚧 v0.2.0 stable tag + post-beta checklist (from HANDOFF.md)

---

## 关键技术约束（违反要回退重做）

### 1. 后端零改动原则（v0.2 范围）

所有 Tauri command 已实现并测试通过。v0.2 只动前端 + 1 个 migration（设置页新增字段）。

**后端已实现的 command（不要重新实现）**：
- `session_*`（create / get / list / search / update / delete / touch）
- `persona_*`（get / list / update）
- `token_stats`
- `export_session_markdown / json`
- `backup_create / verify / restore`（AES-256-GCM + Argon2id）
- `db_config_get / set`（设置页用这个存新字段）

**唯一允许的后端改动**：Phase 7 给 `config` 表加新 key 时写 1 个 migration。其他 Rust 代码不动。

### 2. CSS / 主题系统

- v0.1.5 的 `src/styles.css` 用 `:root` + `@media (prefers-color-scheme: dark)` 已经是双主题
- v0.2 起迁 Tailwind，**但 CSS 变量保留作为 token 来源**（双主题切换由 CSS 变量驱动）
- **不要硬编码颜色**，全部用 Tailwind class（颜色从 CSS 变量映射）
- alpha-24 起所有 dark-mode `@media (prefers-color-scheme)` 改 `.dark` class toggle
- alpha-24 起设计 token 在 `:root` + `.dark`，所有下游 var(--xxx) 引用

### 3. 设计还原度

- 每个 Phase 结束都要做"像素级对比"：Playwright 截图 vs 设计师 SVG，差异 < 5px
- 20 张 SVG 在 `D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\`
- 设计要求清单：`hermes-tray-UI设计要求.md`（同目录）

### 4. 用户截图暴露的硬性要求（绝对不能漏）

- ✅ 备份 modal 用**分离卡片式入口**（不再用 tab，绕开 CSS bug）
- ✅ 恢复操作**双重确认**：勾选 + 5s 倒计时按钮
- ✅ Token 统计用 **￥（人民币）**，不用 $
- ✅ 国内模型定价要加（qwen / kimi / ernie / doubao / glm / deepseek-cn），不能 fallback to USD
- ✅ 密码字段**眼睛图标 + 强度条**
- ✅ 危险操作必须**二次确认** + **视觉警示**（红色描边按钮，不实心红）

---

## v0.2 Manual Verification 教训（alpha-23 ~ alpha-26）

> 这 4 条是从 alpha-23~26 manual Tauri 验证里抠出来的可复用教训。**新功能
> 验收前先扫一遍**避免重复踩坑。

### 教训 ① 像素级 design 比对必须先确认左右 / 上下

**踩坑**：alpha-24 把 `.message.user` 写成 `align-self: flex-start`（左对齐），
但 design 01 SVG 实际是 user **右对齐**（iMessage 风格），assistant 在
左边带 avatar。**4 轮 CSS 改动才被用户用红框 + "左"/"右"标图纠正**。

**根因**：只看 chip 颜色不看**行的结构**（avatar 在哪边 + 哪边有 gap）。
SVG mockup 单一信号（chip 蓝）容易读反。

**防护**：
1. 改 bubble / 容器 alignment 之前，先把设计稿截图里 avatar 位置 / 文本
   起点 / chip 终点三个标记点用线标出来，确认 user 行 avatar 在哪一侧。
2. 用 image viewer 标注 "avatar side" + "chip side" 再写 CSS。

### 教训 ② Validator 函数不要 fold 不同 failure case

**踩坑**：`validateShareHash` 把 `no-match`（空 hash / 不匹配 `#share=`）
和 `decode-failed`（匹配但 base64 解码抛错）fold 成同一个
`{ reason: "decode-failed" }`，导致 `share-ui.ts` 在**每次冷启动**都弹
"URL 片段格式错误或已损坏"红 toast。

**根因**：上游 helper（`parseShareHash`）returns null 表示两种
case，下游 validator 不区分就一路传到 UI。

**防护**：
1. Validator 函数**先 pattern-test**，再调 decode。
2. 每个 distinct failure case 给独立 reason，UI 按 case 决定 toast /
   silently ignore / fallback。
3. 写 validator 之前列出"这个函数可能返回的所有状态"，确保 UI
   处理路径全覆盖。

### 教训 ③ Tauri WebView CSS cache ≠ Vite HMR

**踩坑**：alpha-25 改了 `align-self: flex-end`，HMR reload 后用户截图
仍左对齐。**原因是 Tauri WebView 不一定 reload 纯 CSS value 改动**
（HMR 检测到 Preact 组件没结构变化，可能跳过 style reload）。

**防护**：
1. CSS-only fix 让用户**Ctrl+Shift+R 强刷**而不是"再试一次"。
2. 如果强刷后还不生效，那才是真 bug。
3. v0.3 candidate: 在 dev mode 加一个 "DevTools toggle CSS cache" 按钮
   让用户能自己清。

### 教训 ④ Modal mount 必须 sync parent `.hidden` class

**踩坑**：同样的 bug 在 v0.2 命中了 3 个不同 modal：
- alpha-22 — shortcuts-modal-mount.tsx
- alpha-24 — confirm-modal-mount.tsx（session delete × 无反应）

**根因**：index.html 写 `<div id="confirm-modal" class="modal-overlay hidden">`，
Preact panel render 进 shell 但父级 `display: none` 没被同步。

**防护**：
1. 每个 `*-modal-mount.tsx` 必须 subscribe to its store + toggle parent
   `.hidden` class。
2. v0.3 candidate: 抽 helper `mountOverlay(store, root, view)` 包这套
   sync 逻辑，避免 4 处复制粘贴。

---

## 不在本项目 Memory 的（避免污染跨项目决策）

- Cargo 配置 / Tauri release 流程 / cherry-pick bug 模式 → 已下沉到全局 agent memory
- 通用 Tauri 开发技巧 → 不记录，下次 session 自己读 Cargo.toml + lib.rs
- 教训 ①②③④ 通用部分（看 SVG 不读结构 / validator fold case / WebView cache / modal hidden sync）→ 跨项目 reusable，下沉到 Mavis agent memory

---

## References

- **设计要求**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\hermes-tray-UI设计要求.md`
- **验收报告**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\验收报告.md`
- **开发计划**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\开发计划.md`
- **设计稿 SVG**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\01-20*.svg`
- **本轮 session 记录**：`HANDOFF.md` v0.2-alpha-23 → alpha-26 section