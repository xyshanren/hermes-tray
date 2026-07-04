# Hermes Chat (hermes-tray) — Agent Memory

> Project memory for hermes-tray. Read this first before touching any file.
> Updated 2026-07-04 with v0.2 architecture decisions.

---

## Project Snapshot

| 项 | 值 |
|---|---|
| 产品形态 | Tauri 2 桌面应用（Rust 后端 + WebView 前端） |
| 当前版本 | v0.1.5（功能完整，UI 待重做） |
| 下一版本 | v0.2（UI 大改造，落地 20 张已验收 SVG 设计稿） |
| 项目根 | `D:\work\workspace\Qoder\hermes-tray` |
| 前端 | vanilla TS + Vite + vitest（v0.2 起：**vanilla TS + Preact + Tailwind + shadcn/ui**） |
| 后端 | Rust + rusqlite + tokio + aes-gcm + argon2 |
| 测试 | 13 个 .test.ts 文件（vitest + happy-dom） |
| 设计稿位置 | `D:\work\workspace\MiniMax\projects\hermes-tray-notes\`（20 张 SVG + 验收报告 + UI 设计要求） |

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

### 3. 设计还原度

- 每个 Phase 结束都要做"像素级对比"：Playwright 截图 vs 设计师 SVG，差异 < 5px
- 20 张 SVG 在 `D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\`
- 设计要求清单：`hermes-tray-UI设计要求.md`（同目录）

### 4. 用户截图暴露的硬性要求（绝对不能漏）

- ✅ 备份 modal 用**分离卡片式入口**（不再用 tab，绕开 CSS bug）
- ✅ 恢复操作**双重确认**：勾选 + 5s 倒计时按钮
- ✅ Token 统计用 **￥（人民币）**，不用 $
- ✅ 国内模型定价要加（qwen / kimi / ernie / doubao / glm / deepseek-cn），不能 fallback 到 USD
- ✅ 密码字段**眼睛图标 + 强度条**
- ✅ 危险操作必须**二次确认** + **视觉警示**（红色描边按钮，不实心红）

---

## 不在本项目 Memory 的（避免污染跨项目决策）

- Cargo 配置 / Tauri release 流程 / cherry-pick bug 模式 → 已下沉到全局 agent memory
- 通用 Tauri 开发技巧 → 不记录，下次 session 自己读 Cargo.toml + lib.rs

---

## References

- **设计要求**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\hermes-tray-UI设计要求.md`
- **验收报告**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\验收报告.md`
- **开发计划**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\开发计划.md`
- **设计稿 SVG**：`D:\work\workspace\MiniMax\projects\hermes-tray-notes\assets\svg-pages\01-20*.svg`