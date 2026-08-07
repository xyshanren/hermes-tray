# alpha-35 候选 — post-manual-verification polish

> 状态: **plan-only**, 未实现。完整 spec 落在本文件, ROADMAP.md §v0.3.0 引用本文件。
>
> 来源: 2026-08-05 用户装 alpha-34 MSI 后手动验证焦点陷阱时反馈的 4 个问题/改进候选。
> 上一个 alpha: [alpha-34（PR #3 MERGED, commit 9b9f128）](https://github.com/xyshanren/hermes-tray/pull/3)
>
> 拆分建议: 2 个独立 PR
> - **alpha-35a** = B (bubble-copy-btn CSS) + F' (Ctrl+/ IME 文档 gap), 估时 ~0.2d
> - **alpha-35b** = V (footer 版本号) + S (分享按钮 ↗/↙ 区分), 估时 ~0.3d
>
> 全部纯前端改动, **零 Rust 变更**。符合 v0.3 周期 "后端冻结" 约束。

---

## 概述

alpha-34 ship 后用户装 MSI 试用, 手动验证焦点陷阱时反馈 4 个问题:

1. assistant 气泡右侧的 "复制" 按钮被挤成竖向窄条 (CSS 完全缺失)
2. 主窗口 / footer / tray / settings / splash 任何位置都看不到 `0.2.2` 版本号
3. `?` 快捷键 "没反应" — 实际绑定是 `Ctrl+/`, UI 文档没说明, 中文 IME 激活时会被拦截
4. 顶栏 "分享" 按钮未弹 modal — 发送方按钮按设计就是 copy-to-clipboard, 认知错位在 icon/文案不区分方向

4 个全是**纯前端**改动。

---

## B. assistant 复制按钮 CSS 补全 + 文案改 "复制" (~0.15d)

### 根因

- `src/views/chat-view.tsx:293-301` 在每条 assistant 气泡末尾渲染 `<button class="bubble-copy-btn">` (icon 为 📋 / ✓, tooltip "复制 Markdown 源码")。
- `src/styles.css` 3906 行内 **完全无 `.bubble-copy-btn` / `.bubble-copy-btn.copied` 规则** (已 grep 确认 0 命中)。
- 浏览器默认 `<button>` 在 `.message.assistant` flex 容器内被窄化: 灰色背景 + 1px border + 浏览器内置 padding + 没有 `width / min-width`, 被挤成竖向窄条; icon 几乎不可见。
- tooltip 文案 "复制 Markdown 源码" 对用户语义模糊 (Markdown 是什么? 普通复制不就够了?), 实际行为是把 `msg.content` (sanitized GFM HTML 之前的 raw markdown 串) 放进剪贴板。

### 修法

- **`src/styles.css`** — 在 `.message.assistant .message-content` 块 (~1076-1080 行附近) 下追加:
  - `.message.assistant { position: relative }` 让绝对定位的按钮有锚点。
  - `.bubble-copy-btn` 的定位 / 尺寸 / 配色 / hover / focus 规则: 吸顶右上 (top 6px, right 8px), 圆形 28×28, 默认透明度 0 (hover 时 fade in), `--bg-tertiary` + `--text-muted` start, hover 升 `--bg-tertiary` + `--text-secondary`, focus-visible 走 `--ring` (indigo glow), 点击后 `.copied` 状态色翻 `--success` + 锁 `pointer-events` 防连击。
  - 显式写 `width` / `height` / `flex-shrink: 0` / `line-height: 1` / `padding: 0`, 避免再次被默认样式带窄。
  - `.message.user` 范围内不渲染这个按钮 (`AssistantBubble` 里才有), 不用 user selector 限定。
- **`src/views/chat-view.tsx`**:
  - L296-297: `title` / `aria-label` 文案从 "复制 Markdown 源码" 简化为 "复制" (hover 显示), "已复制 Markdown" 简化为 "已复制"。
  - 把 emoji `📋 / ✓` 换成 inline SVG (Material `content_copy` / `check`, 14×14, `fill="currentColor"`), 避免不同操作系统 emoji 渲染宽度差异再次把按钮挤歪。
- **测试**: 不新增 (纯 CSS 改动 + 文案调整)。

### 验收

1. 装 alpha-35a MSI 后打开任意会话, assistant 气泡右上角出现**圆角矩形**按钮 (28×28, icon 居中), 不再是被挤的灰色竖条。
2. 鼠标 hover / 键盘 focus-visible: 按钮 fade in (opacity 0→1), 背景 `--bg-tertiary`, icon 颜色 `--text-muted` → `--text-secondary`, 过渡 ≤ 150ms。
3. 键盘 Tab 可聚焦到该按钮, focus ring 走 `--ring` (indigo glow), 按 Enter / Space 触发复制。
4. 点击后 icon 变为对勾 SVG, 按钮色翻 `--success`, ~1.8s 后恢复; hover 时显示 tooltip "复制", 复制瞬间显示 "已复制"。
5. 在浅色 / 深色主题下分别走一遍; 按钮在两种主题下都 readable (不是默认浏览器灰)。
6. `npm run build` 通过; `npm test` 475/475 (含 2 新增的 IME note 测试); production CSS 总和仍 < 80 kB 预算。

---

## V. 主窗口 footer 显示版本号 (~0.1d)

### 根因

- `src-tauri/Cargo.toml:3` `version = "0.2.2"` 是当前真实版本, 但 grep 全前端代码 `app_version` / `getVersion` / `version` 0 命中 (除 README/CHANGELOG/ROADMAP 等文档), Tauri 端也没有任何 frontend-facing command 暴露这个值。
- 用户在 tray 菜单 / 主窗口 / footer / settings modal / splash 任何位置都看不到 `0.2.x` 这个数字, bug 报告时需要用户手动回去翻 release notes 才能确认装的是哪个 alpha。

### 修法 (方案 a — vite define, 严禁改 Rust 后端)

> **决策理由**: 方案 b (运行时 invoke Rust command) 跟用户硬性要求 "alpha-35 严禁改 Rust 后端" 冲突; 方案 c (硬编码 index.html) 失去单源。方案 a 跟 Rust 端 `app.handle().config().package.version` 一致, alpha-36+ 想换方案 b 时只改 1 个文件, call site 不动。

- **`vite.config.ts`** — 增加 `define: { __HERMES_VERSION__: JSON.stringify(require('./src-tauri/tauri.conf.json').version) }`, try/catch fallback `"0.0.0-dev"` (CI 子目录可能拿不到 config)。
- **`src/types.ts`** (或新建 `src/build-info.ts`) — `declare const __HERMES_VERSION__: string; export const APP_VERSION: string = __HERMES_VERSION__;`; 纯字符串常量, 便于以后切到 runtime invoke。
- **`src/main.ts`** (或 `src/lib/boot.ts`) — 在 DOMContentLoaded 末尾把 `APP_VERSION` 写到 footer 右侧新增 `<span id="app-version" class="app-version">v${APP_VERSION}</span>`。
- **`src/styles.css`** — 加 `.app-version` 4 条规则: `font-size: 11px; color: var(--text-muted); padding: 0 8px; align-self: center;`。
- **`index.html`** — footer `<footer class="input-area">` 内部新增 `<span id="app-version">v0.0.0-dev</span>` 占位 (main.ts 启动时替换)。
- **不动 `Cargo.toml` / `tauri.conf.json` / `package.json`** —— 避免无谓的 Rust 端 churn; 这次 alpha 仍是 alpha-34 基础上 bump, semver 不变。

### 验收

1. 装 alpha-35b MSI 后打开主窗口, footer 出现 `v0.2.2` 字号小、颜色 muted 的版本号, 浅色 / 深色主题下都 readable。
2. `grep -r "__HERMES_VERSION__" dist/` 确认常量被 inlined 进 bundle (无运行时 IPC)。
3. alpha-36 发版时只需 `tauri.conf.json.version` + `Cargo.toml.version` 同步 bump, footer 自动同步, 无需手动改前端。

---

## S. 分享按钮重设计 — ↗ vs ↙ 区分 + hover tooltip (~0.2d)

### 根因

- `index.html:115-126` 顶栏右侧实际有 2 个 share 相关按钮:
  - `#share-link-btn` (↗ 发送方 — Material `share` icon `M18 16.08 ...`), 点击 → `copySessionShareLink(invoke, showToast, ...)` → 复制 share URL 到剪贴板 + toast, **不弹 modal** (`src/lib/share-ui.ts:33-40`)。
  - `#share-import-btn` (↙ 接收方 — 向下箭头 + 底线 `M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z`), 点击 → `shareStore.setPasteOpen(true)` → 弹 paste-import modal (`src/lib/share-ui.ts:45-47`)。
- 用户体验上两个按钮都叫 "分享" (一个 title "复制分享链接 (T-Q-S10)", 另一个 "导入分享的会话（粘贴链接）"), icon 都是常见 share 形态, 没明确区分 "我发给别人" vs "别人发给我" 的方向。

### 修法

- **`index.html:115-126`**:
  - `#share-link-btn` 改 `title` 为 "复制分享链接", icon 保留 Material share (已经是 outgoing 形态);
  - `#share-import-btn` 改 `title` 为 "导入分享链接", icon 强化 inbound 方向 (例如 Material `inbox`), 明确是 "进来" 方向;
  - 两个按钮之间加视觉分隔 (`border-left: 1px solid var(--border)` 在 import-btn 上 + `margin-left: 6px; padding-left: 8px;`), 让 "成对" 语义清晰。
- **`src/styles.css`** — 在 `#share-import-btn` 上加 `margin-left: 6px; border-left: 1px solid var(--border); padding-left: 8px;`。
- **`src/views/chat-view.tsx` 不动**; **`src/lib/share-ui.ts` 的两个 click listener 不动**; 本次纯 HTML / CSS / title 文案调整, **不引入新行为** (发送方按钮行为不变成弹 modal, 避免破坏 alpha-15 引入的 copy-即走的快速路径)。

### 验收

1. 装 alpha-35b MSI 后看顶栏: 紧邻 settings 按钮的 2 个 share 按钮之间出现 1px 竖向 border, 两个 icon 方向感明确 (一出一进)。
2. hover `↗`: tooltip "复制分享链接"; hover `↙`: tooltip "导入分享链接"。
3. 点 ↗ 行为不变: toast "已复制链接", 无 modal。
4. 点 ↙ 行为不变: 弹 paste-import modal, 可粘贴 share URL。
5. `npm run build` 通过; `npm test` 473/473 (不引入新行为)。

---

## F'. Ctrl+/ 中文 IME 文档 gap (~0.05d)

### 根因

- `src/main.ts:1255-1259` 实际绑定是 `(e.ctrlKey || e.metaKey) && e.key === '/'` (**无 Shift 要求**)。
- `src/views/shortcuts-modal-store.ts:74` 的 SHORTCUT_GROUPS 列出 `{ keys: ["Ctrl", "/"], description: "显示快捷键面板" }`, **没有** `?` (`Shift+/`) 的独立条目。
- 用户从 Mac / 通用 IDE 习惯按 `?` 唤出快捷键面板 (VSCode / Slack / GitHub 都用 `?`), 按了没反应 → 报 bug。
- 中文 IME 激活 (composing) 状态下, 浏览器会把 `Ctrl+/` 拦截给 IME (搜狗 / 微软拼音 / QQ 输入法都会), 不冒泡到 `window` keydown listener; 这是已知浏览器行为, 跟 `?` 是不是绑定无关, 但跟用户文档 gap 加在一起让问题更模糊。

### 修法 (仅文档 gap, 不引入 `?` 绑定)

> **决策理由**: `?` 物理键就是 `Shift+/`, listen `Shift+/` 会跟英文输入冲突 (用户在 textarea 输入问号被吞掉); 跟 IME 拦截路径相同; 文档 gap 已经能解释清楚。

- **`src/views/shortcuts-modal-store.ts`** — 把 `ShortcutRow` 改成 discriminated union:
  ```ts
  export type ShortcutRow =
    | { type?: "shortcut"; keys: string[]; description: string }
    | { type: "note"; text: string };
  ```
  在 SHORTCUT_GROUPS 的 "全局" 组的 `Ctrl+/` 行**下方追加一条 note row**, 文案: "提示：中文输入法激活时 Ctrl+/ 会被 IME 拦截, 请切换到英文模式或按 Esc 退出候选后再试。"
- **`src/views/shortcuts-modal-view.tsx:88-100`** — 加 `isShortcutRow` 类型谓词 (`!('text' in row)`), row 渲染分支 dispatch:
  - shortcut row → `<li class="shortcuts-row">` 原样
  - note row → `<li class="shortcuts-note"><span class="shortcuts-note-text">{row.text}</span></li>`
- **`src/views/shortcuts-modal-view.tsx:47-58`** filter — 加 `isShortcutRow(row) &&` 前置守卫, note row 永远不参与搜索过滤。
- **`src/styles.css`** — 加 `.shortcuts-note` 4 条规则 + `::before` ⓘ icon: muted 文字, 1px dashed 上边框, 圆角, 11px 字号, `--text-muted`。
- **`src/views/shortcuts-modal.test.tsx`** — 4 处更新 + 2 处新增:
  - "has exactly 7 shortcuts total" → "7 shortcuts + 1 note"
  - "each shortcut has at least one key + description" → skip note row guard
  - 新增 "global group carries an IME doc-gap note under Ctrl+/" (asserts SHORTCUT_GROUPS)
  - "renders 3 group sections + 7 rows" → "+ 1 IME note"
  - 新增 "renders the IME note text inside the global group" (asserts view DOM)
- **`src/main.ts`** — **不改**。

### 验收

1. 装 alpha-35a MSI 后按 `Ctrl+/` 仍然弹 shortcuts modal (行为不变)。
2. 打开 shortcuts modal, "全局" 组 `Ctrl+/` 行下方出现一行 muted 提示 (ⓘ icon + "提示：中文输入法激活时 Ctrl+/ 会被 IME 拦截, 请切换到英文模式或按 Esc 退出候选后再试。")。
3. 搜索 "Ctrl" 时该 note row 不出现 (filter 不参与 note row)。
4. 测试: 新增 2 个测试 + 改写 2 个测试通过; 473 → 475/475 frontend tests passing。
5. `npm run build` 通过; `cargo` / `clippy` / `fmt --check` 仍 0 警告 (无 Rust 改动)。

---

## 总工作量

| ID | 候选 | 估时 | 拆分粒度建议 |
|---|---|---|---|
| B | bubble-copy-btn CSS + 文案 | 0.15d | **alpha-35a** (独立 ship: 1 文件 CSS + 1 文件 JSX 微调 + 0 Rust) |
| F' | Ctrl+/ IME 文档 gap | 0.05d | **alpha-35a** (同 B 批 ship: 1 store + 1 view + 1 CSS + 1 测试) |
| V | footer 版本号 | 0.1d | **alpha-35b** (独立 ship: 1 build config + 1 新 constants file + 1 footer 注入 + 0 Rust) |
| S | 分享按钮 ↗ vs ↙ 重设计 | 0.2d | **alpha-35b** (同 V 批 ship: 1 HTML + 1 CSS 微调 + 0 行为变化) |
| **合计** | | **0.5d** | **2 PR**: 35a (B+F') + 35b (V+S) |

外加 **PR 前本地检查 ~10 分钟** (按 memory 强制要求):

```bash
cd src-tauri
cargo clippy --manifest-path Cargo.toml -- -D warnings    # 应 0 改动但仍要过
cargo fmt --manifest-path Cargo.toml --check               # 应 0 改动
cd ..
npm run build                                             # 前端 tsc + vite build
npm test                                                  # vitest 单元测试
```

---

## 依赖关系 / 风险

- **B ↔ V / S / F' 零依赖**: CSS 文件不同段, 行为正交。
- **V ↔ S / F' 零依赖**: V 改 vite config + 新 constants file, S 改 index.html, F' 改 shortcuts modal, 互不影响。
- **风险 1 (V)**: 方案 a (vite define) 要求 `vite.config.ts` 在 dev mode 下也能拿到 `tauri.conf.json`; 如果 dev 时 `pnpm dev` / `npm run tauri dev` 跑在 `tauri.conf.json` 不存在的路径下 (例如 CI 子目录) 会失败 → 在 `vite.config.ts` 里包 try/catch fallback 到 `"0.0.0-dev"`。
- **风险 2 (S)**: icon 替换要从 Material icon font set 选一对同尺寸同笔触的 in/out; 如果改 SVG path, fill 要跟现有 settings / persona / share-import SVG 保持一致 (当前是 `fill="currentColor"`), 避免视觉风格错位。
- **风险 3 (F')**: `shortcuts-modal-store.ts` 的 `ShortcutRow` 类型如果加 `type: "note"`, 要确认没有其他 modal 共用同一 union; 目前该类型只在 shortcuts modal 用, 安全。

---

## 不在范围 (明确划线)

- **Rust 后端代码** (用户硬性要求): tray tooltip / settings modal / splash screen 的版本号展示一律 alpha-36+ 再说。本次 V 仅覆盖 footer。
- **发送方按钮行为变更** (保持 copy-to-clipboard 单步路径): 不引入 "分享 modal" 承载发送方流程; UX 改进通过 icon + 文案 + tooltip + 视觉分隔解决。
- **新增 `?` 键绑定**: 与 IME 拦截路径相同, 且会冲突英文输入问号。
- **splash / settings / tray tooltip 版本号**: alpha-36 候选, 本轮不动。
- **Cargo.toml / tauri.conf.json / package.json 三处 version bump**: alpha-34 已经是 0.2.2 (CHANGELOG §v0.2.2 段), alpha-35 仍走 polish 路径, 不 bump。

---

## 验收 checklist (合并 4 项给发版前一次性走)

- [ ] **B**: assistant 气泡右上角出现圆形复制按钮 (28×28, icon 居中), hover / focus / copied 三个态都 visible; 浅色 + 深色主题都 OK; `bubble-copy-btn` 在 `src/styles.css` 有完整规则 (grep 验证)。
- [ ] **B**: tooltip "复制" / "已复制", 键盘可达。
- [ ] **V**: 主窗口 footer 显示 `v0.2.2` (muted 文字); dev / prod bundle 都能拿到 `__HERMES_VERSION__` 常量; `vite.config.ts` 改动不破坏 `npm run tauri dev`。
- [ ] **S**: 顶栏 share 按钮对 (↗ out / ↙ in) 有视觉分隔 (border-left), tooltip 文案分别为 "复制分享链接" / "导入分享链接"; 点击行为不变。
- [ ] **F'**: shortcuts modal "全局" 组有 IME 提示行; 新增 2 测试通过; 475/475 frontend tests。
- [ ] `npm run build` 通过, JS bundle < 1.5 MB、CSS < 80 kB。
- [ ] `npm test` 475/475 passing; `cargo clippy --all-targets -- -D warnings` 0; `cargo fmt --check` clean (0 Rust 改动, 仍需跑)。
- [ ] 手动 MSI 验证 4 个验收项; CHANGELOG.md 顶部 alpha-35 段写完; ROADMAP.md v0.3.0 §P4 long-tail 把这次解决的 "竖条按钮" 从长尾移到 done (版本号仍在 pending 35b)。

---

## 参考文件清单 (绝对路径)

### 修改目标

- `src/styles.css` — B 追加 `.bubble-copy-btn` 规则; S 加 share 按钮分隔; F' 加 `.shortcuts-note`; V 加 `.app-version`
- `src/views/chat-view.tsx` — B 改 tooltip 文案 + icon SVG
- `src/views/shortcuts-modal-store.ts` — F' 把 ShortcutRow 改 union + IME note row
- `src/views/shortcuts-modal-view.tsx` — F' 渲染 note 行 + 类型谓词
- `src/views/shortcuts-modal.test.tsx` — F' 改写 2 断言 + 新增 2 测试
- `index.html` — S 改 2 个 share 按钮 title + icon; V 加 footer version span 占位
- `src/main.ts` — V 在 DOMContentLoaded 末尾注入 version text
- `vite.config.ts` — V 加 `define.__HERMES_VERSION__`
- `src/types.ts` — V 加 `APP_VERSION` 常量 + ambient declare
- `CHANGELOG.md` — ship 时顶部加 alpha-35 段
- `ROADMAP.md` — §v0.3.0 同步插入 alpha-35 polish 引用段

### 不动但已确认状态

- `src/lib/share-ui.ts` — share 行为 listener 不动
- `src/views/share-modal-store.ts` — pasteOpen 流程不动
- `src/lib/tray-menu.ts` — tray tooltip 版本号不在本次范围
- `src-tauri/Cargo.toml` — version 不 bump
- `src-tauri/tauri.conf.json` — version 不 bump
- `package.json` — version 不 bump

### 设计稿参考

- `D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\` — 顶栏按钮风格、footer 视觉对齐参考 (特别是 01/02 main-chat 中 share 按钮的视觉权重对比)
