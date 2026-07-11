# hermes-tray CANDIDATES.md — 候选池

> 2026-07-10 初稿 — 调研期间的想法记录
> 维护人: Mavis (跟 cn 同源思路)
> **状态语义**: 🟢 ready / 🟡 proposed / 🟠 blocked / 🔵 in-progress / ✅ shipped / ❌ rejected

---

## 文档目的

候选池, 不是计划. 跟现有文档区分:

| 文档 | 关注点 |
|---|---|
| **[ROADMAP.md](./ROADMAP.md)** | v0.2/v0.3 当前计划 (P3 modal-by-modal) + P2 deferred items |
| **[PROGRESS.md](./PROGRESS.md)** | 项目结构 + 现状盘点 |
| **[HANDOFF.md](./HANDOFF.md)** | session 交接上下文 |
| **[CANDIDATES.md](./CANDIDATES.md)** ← 本文件 | 长远的想法池, 调研产物, 不 commit-ready |
| **[AGENTS.md](./AGENTS.md)** | 项目级决策 + 教训 |

跟 cn 的 [CANDIDATES.md](../hermes-agent-cn/CANDIDATES.md) 同源, 但只关心 **hermes-tray 客户端** 视角. 跨项目 (server + client 协同) 候选会在两边都登记, 用 cross-ref 关联.

---

## 元数据约定

### [TRAY-CAND-NNN] 标题 (status, 类别)

- **状态**: 🟢 ready / 🟡 proposed / 🟠 blocked / 🔵 in-progress / ✅ shipped / ❌ rejected
- **来源**: 上游 commit / 外部项目 / 自创
- **估时**: 估时 (d = day, h = hour)
- **风险**: 🟢 低 / 🟡 中 / 🟠 高
- **价值**: 🟢 高 / 🟡 中 / 🟠 低
- **触发条件**: 任一满足 → 升级为 🟢 ready, 移到 NEEDS_BACKLOG 或开 commit
- **关联**: 跟其他候选或上游 commit 的关联
- **备注**: 自由格式说明

### 状态流转

- 提出 → 🟡 proposed (调研期间)
- 评估 → 🟢 ready (可执行, 等 commit)
- 接受 → 移到 NEEDS_BACKLOG 或单 commit, 删除本文件 [TRAY-CAND-NNN] 但保留 [TRAY-CAND-HIST-NNN]
- 拒绝 → ❌ rejected, 加理由, 留档

---

## 分类 A: MiniCPM-Desk-Pet 跨项目借鉴 (OpenBMB, AGPL-3.0)

> **来源**: https://github.com/OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0, OpenBMB)
> **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`
> ⚠️ **AGPL-3.0 警告**: 整个 MiniCPM 项目传染, **不能 cherry-pick 代码**. 只能借鉴模式 (architecture pattern), 不借鉴实现. 所有借鉴要自己写.

### [TRAY-CAND-001] ⚙️ Settings tabs 重构

- **状态**: 🟡 proposed
- **来源**: 外部项目 [OpenBMB/MiniCPM-Desk-Pet](https://github.com/OpenBMB/MiniCPM-Desk-Pet) (AGPL-3.0 ⚠️)
- **一句话**: 把 settings 从 section-based 改成 tabs-based, 模块化可扩展
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟢 高
- **触发条件**: settings UI 需要扩展时
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-002] 🏥 Doctor 启动健康检查 UI

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: 启动时显示 health check 结果, 一键跳到对应 fix
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟢 高
- **触发条件**: 部署/支持/用户自助反馈差
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-003] 📡 Settings → Agents tab + install hint banner

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: settings 加 Agents tab, 顶部 banner 提示已装 coding agent
- **估时**: 1 d
- **风险**: 🟢 低
- **价值**: 🟡 中
- **触发条件**: 适配多 coding agent 时
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-004] 🌐 i18n typesafe-i18n 实施

- **状态**: 🟡 proposed
- **来源**: 项目内部决策 (AGENTS.md 决策 #3)
- **一句话**: 用 typesafe-i18n 框架支持多语言, 至少中英双语
- **估时**: 1 d
- **风险**: 🟢 低
- **价值**: 🟡 中
- **触发条件**: 多语言需求浮现
- **详细分析**: 项目内部 AGENTS.md 决策 #3

### [TRAY-CAND-005] 🎨 Theme override + import/export

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: theme 可导入/导出, 用户跨设备同步
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟡 中
- **触发条件**: 个性化需求浮现
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-006] 🔌 Coding agent event subscriber

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: 订阅 server agent events, 渲染到 tray UI
- **估时**: 0.5-1 d
- **风险**: 🟡 中
- **价值**: 🟢 高
- **触发条件**: 适配多 coding agent 时
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-007] 💬 wecom/feishu approval bubble UI

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: enterprise IM 平台审批集成, 浮窗 UI
- **估时**: 1-2 d
- **风险**: 🟡 中
- **价值**: 🔴 极高
- **触发条件**: enterprise 场景需要 audit trail
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

### [TRAY-CAND-018] 🐾 Virtual Pet 形象实现

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: 桌面宠物显示, 状态动画
- **估时**: 1-2 d
- **风险**: 🟡 中
- **价值**: 🟢 高
- **触发条件**: gamification 规划
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-tray-notes\cross-pollination\pet-implementation.md`

### [TRAY-CAND-008] 🔍 Agent installation detector (本地扫描)

- **状态**: 🟡 proposed
- **来源**: 外部项目 OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0 ⚠️)
- **一句话**: 扫描本机已装 coding agent, 输出 JSON
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟢 高
- **触发条件**: 适配多 coding agent 时
- **详细分析**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`

---

## 分类 B: AGENTS.md / ROADMAP.md 决策遗留

> 来自 hermes-tray 现有决策文档中提到但未实施的候选.

### [TRAY-CAND-009] 🔧 DevTools toggle CSS cache button

- **状态**: 🟡 proposed
- **来源**: 项目内部 (AGENTS.md 教训)
- **一句话**: dev mode 加按钮, 用户可清 CSS cache 避免强刷
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟡 中
- **触发条件**: dev mode UX 改造时
- **备注**: 内部教训: Tauri WebView 不一定 reload 纯 CSS value 改动, 详见项目 AGENTS.md

### [TRAY-CAND-010] 🧩 `mountOverlay(store, root, view)` helper

- **状态**: 🟡 proposed
- **来源**: 项目内部 (AGENTS.md 教训)
- **一句话**: 抽 modal mount helper, 避免复制粘贴同步逻辑
- **估时**: 0.5 d
- **风险**: 🟢 低
- **价值**: 🟡 中
- **触发条件**: 新 modal 创建时
- **备注**: 内部教训: modal mount 必须 sync parent `.hidden` class, 详见项目 AGENTS.md

### [TRAY-CAND-011~015] ROADMAP.md P2 deferred items (5 items)

- **状态**: 🟡 proposed
- **来源**: 项目内部 ROADMAP.md P2 section
- **一句话**: 5 个 v0.2 deferred 但 v0.3 eligible 的项 (avatar / sidebar icons / shadcn migration / animation audit / dark mode audit)
- **备注**: 完整描述见项目内部 ROADMAP.md, 不在本文件复述

### [TRAY-CAND-016~017] ROADMAP.md out-of-scope items (v0.4+)

- **状态**: 🟡 proposed
- **来源**: 项目内部 ROADMAP.md out-of-scope section
- **一句话**: v0.3 范围外, v0.4+ 候选 (multi-window / mobile / plugin marketplace / auto-update)
- **备注**: 完整描述见项目内部 ROADMAP.md, 不在本文件复述

---

## 分类 C: 调研期间其他想法 (待补充)

> 不属于 MiniCPM 借鉴, 也不在 AGENTS.md / ROADMAP.md 中, 但值得记录.

(暂无, 后续调研补充)

---

## 触发条件总表

| 触发 | 看哪些 TRAY-CAND |
|---|---|
| hermes-tray v0.3.0 UX 改造 | TRAY-CAND-001 (tabs 重构) + TRAY-CAND-005 (theme override) |
| 出现海外 user | TRAY-CAND-004 (i18n) + TRAY-CAND-005 (theme) |
| hermes-tray 接多 coding agent | TRAY-CAND-003 (Agents tab) + TRAY-CAND-006 (event subscriber) + TRAY-CAND-008 (detector) |
| cn enterprise wecom/feishu approval | TRAY-CAND-007 (approval bubble UI) |
| 安装/部署/支持反馈差 | TRAY-CAND-002 (Doctor UI) |
| dev mode UX 反馈 | TRAY-CAND-009 (CSS cache toggle) + TRAY-CAND-010 (mountOverlay helper) |
| AGENTS.md 决策 #3 实施 (typesafe-i18n) | TRAY-CAND-004 |
| v0.4 规划 (multi-window / mobile / plugin) | TRAY-CAND-016~017 |

---

## 维护

- 新候选: 加 `### [TRAY-CAND-NNN] 标题` 章节, 填元数据, 加到触发总表
- 状态变更: 直接改状态 emoji, 加一行理由到 备注
- 接受: 移到 NEEDS_BACKLOG 或单 commit, 删除本文件 [TRAY-CAND-NNN] 但保留 [TRAY-CAND-HIST-NNN]
- 拒绝: ❌ rejected, 加理由, 留档
- 跨项目: 双端候选 (eg. doctor / event subscriber / approval) 在 cn CANDIDATES.md 也登记, 用 cross-ref 关联

---

## 引用

> **2026-07-11 调整**: 调研产物 (cross-pollination research docs) 已从项目移到 agent 工作目录, 不污染 git. 候选池本身 (本文件) 保留在项目.

- **cn 候选池**: [hermes-agent-cn/CANDIDATES.md](../hermes-agent-cn/CANDIDATES.md)
- **调研产物 INDEX**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\INDEX.md` — 4 个深度调研 (MiniCPM / Pet / OpenFugu / 4-layer 集成) 汇总
- **MiniCPM-Desk-Pet 调研**:
  - 深度分析: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\MiniCPM-Desk-Pet-vs-hermes-cn-tray.md`
  - Pet 形象选型: `D:\work\workspace\MiniMax\projects\hermes-tray-notes\cross-pollination\pet-implementation.md`
- **MiniCPM 项目**: https://github.com/OpenBMB/MiniCPM-Desk-Pet (AGPL-3.0, OpenBMB)
- **OpenFugu 调研**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\OpenFugu-vs-hermes-routing.md`
- **OpenFugu 项目**: https://github.com/trotsky1997/OpenFugu (Apache-2.0, trotsky1997)
- **四层架构集成**: `D:\work\workspace\MiniMax\projects\hermes-agent-cn-notes\cross-pollination\four-layer-orchestration-architecture.md`
- **hermes-tray 现状**:
  - ROADMAP.md: P3 modal-by-modal + P2 deferred
  - AGENTS.md: 决策 #1 shadcn/ui + 决策 #2 ad-hoc 状态 + 决策 #3 typesafe-i18n
  - HANDOFF.md: session 交接
- **调研日期**: 2026-07-10 ~ 11
- **hermes-tray HEAD**: master (post v0.2-beta, v0.3 modal-by-modal pass)
- **本文件状态**: 🟡 初稿, 18 个候选 (8 MiniCPM + 9 决策遗留 + 1 pet 形象)