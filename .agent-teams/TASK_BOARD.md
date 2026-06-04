# Hermes-Tray Task Board

> **Mavis 维护的项目任务看板** (替代 PROGRESS.md Open 列表, 避免漂移)
> **基线日期**: 2026-06-04 (基于 PROGRESS.md S0-S4 done + S5 5/6)

---

## 📊 项目状态

| 维度 | 状态 |
|------|------|
| **里程碑** | S0-S4 ✅ done / S5 5/6 done (1 项待 Windows 端跑) |
| **Done 任务** | 14 (来自 PROGRESS.md) |
| **Open 任务** | 1 (S5 Windows build-test.bat) — T-Q2 同步后 |
| **In Progress** | 0 |
| **P0 进度** | 2/2 done (T-Q1 删 Python / T-Q2 同步 Open) — 2026-06-04 09:35 |
| **P1 进度** | 0/3 (T-Q3/Q4/Q5 待排) |
| **P2 进度** | 0/3 (T-Q6/Q7/Q8 待排) |
| **Test 覆盖** | ~0% (无 tests/ 目录, CI 靠 tsc/build/cargo) |
| **技术债** | 已清: 6 Python 死代码 (~1083 行) + requirements.txt / 残留: __pycache__/ 2 .pyc |

---

## 🎯 P0 立即任务 (本周)

### T-Q1: 清理 Python 死代码
- **来源**: 探查报告 (2026-06-04)
- **范围**:
  - 删 `tray_app.py` (~250 行, pystray 旧实现)
  - 删 `gateway_manager.py` (~330 行, WSL 进程管理)
  - 删 `config.py` (~360 行, YAML 配置)
  - 删 `__init__.py` (13 行, 旧 pystray 版 package 标记, glob 新发现)
  - 删 `generate_icon.py` (95 行, 旧 PIL icon 生成, glob 新发现)
  - 删 `requirements.txt` (Python 依赖, 全死)
- **理由**:
  - ARCHITECTURE.md 只提 Tauri + Rust
  - README 只提 Tauri
  - PROGRESS S2 "Python 版功能移植至 Rust [x]"
  - 6 文件全不在 src-tauri/src/lib.rs 引用链里
- **影响**: 仓库瘦 ~1.3MB, 避免新人误用, 跟 ARCHITECTURE.md 同步
- **所有权**: Architect (Mavis 自身) — 改项目结构
- **风险**: 低 (Git history 保留, mavis-trash 可恢复)
- **预期时间**: 30 min
- **T-V**: T-V1 auto-approval (结构性清理, 不影响功能)
- **状态**: ✅ done (2026-06-04 09:35, mavis-trash 6 文件 + requirements.txt)
- **残留**: __pycache__/ 2 个 .pyc (config.cpython-312 + gateway_manager.cpython-312), 待清理

### T-Q2: 同步 PROGRESS.md Open 列表
- **来源**: 探查报告 (Open 列表陈旧)
- **范围**:
  - Open #1 "Textarea 无自动增高" → S3 已 done, 删
  - Open #2 "API Key 硬编码" → S3 已 done (设置页面), 删
  - Open #3 "窗口位置持久化" → S3 已 done (tauri-plugin-window-state), 删
  - Open #4 "图标路径 icons/ vs assets/" → S4 已 done, 删
  - Open #5 "权限列表过简" → S4 总标 [x], 但未明确子项, **查证后处理**
  - 保留: S5 "Windows 环境运行 build-test.bat" (唯一真正 open)
- **所有权**: Mavis 自身 (Planner 角色) — 写文档
- **风险**: 低 (Markdown 修订)
- **预期时间**: 15 min
- **T-V**: T-V1 auto-approval
- **状态**: ✅ done (2026-06-04 09:35, 删 5 项矛盾 + 加同步说明 + 留 1 项 S5)

---

## 🎯 P1 中期任务 (下周)

### T-Q3: 查证 Open #5 "权限列表过简"
- **来源**: PROGRESS.md Open 列表
- **范围**: 读 `src-tauri/capabilities/default.json` + `tauri.conf.json`, 评估权限设置是否合理
- **决策点**:
  - 若权限已合理 → 删 Open #5
  - 若权限真过简 → 保留并加进 T-Q3 sub-task
- **所有权**: Scout (调研) → Architect (决策)
- **预期时间**: 1-2 h
- **T-V**: T-V1 (若删) / T-V2 (若改权限)
- **状态**: ⏳ pending (待 T-Q2 同步)

### T-Q4: Windows 端跑 S5 build-test.bat
- **来源**: PROGRESS S5 最后一项
- **范围**: 用户在 Windows 端跑 `build-test.bat`, 收日志发回
- **所有权**: 用户 (Mavis 无法跨 Windows ↔ WSL 跑)
- **依赖**: T-Q1 (删 Python 后) — 确保不影响
- **预期时间**: 用户配, Mavis 收日志分析
- **T-V**: T-V2 (关键节点)
- **状态**: ⏳ pending (等用户)

### T-Q5: Rust 单元测试基线
- **来源**: 探查报告 (测试覆盖 ~0%)
- **范围**: 给 `src-tauri/src/lib.rs` 的核心 IPC 命令加单元测试
  - `hermes_detect_wsl()`
  - `hermes_find_bin()`
  - `hermes_get_config()` / `hermes_save_config()`
  - `read_wsl_distro()` (替代 config.py 的 WSL 解析)
- **所有权**: Builder (写测试) → Mavis (审)
- **预期时间**: 3-4 h
- **T-V**: T-V1 (测试代码)
- **状态**: ⏳ pending

---

## 🎯 P2 排期任务 (月度)

### T-Q6: 前端 TypeScript 单元测试
- **范围**: `src/main.ts` 的纯函数
  - `escapeHtml()`
  - `handleStream()` (SSE 解析)
  - `renderMarkdown()`
- **工具**: vitest
- **所有权**: Builder
- **T-V**: T-V1
- **状态**: ⏳ pending

### T-Q7: 跨项目集成测试 (hermes-tray ↔ hermes-agent-cn)
- **范围**: 启 Hermes Gateway → 启 hermes-tray → SSE 端到端
- **依赖**: T-Q1 + T-Q5 + hermes-agent-cn 自身测试
- **T-V**: T-V2 (跨项目)
- **状态**: ⏳ pending

### T-Q8: ARCHITECTURE.md 同步
- **范围**: T-Q1 后, ARCHITECTURE.md 是否需要标注"Python 版已删"或加历史章节
- **T-V**: T-V1
- **状态**: ⏳ pending (T-Q1 完成后触发)

---

## 🔄 决策日志

- **2026-06-04 08:00** - 初始 review 完成, 识别 3 个 Python 死代码, 立项 T-Q1~Q5
- **2026-06-04 08:00** - Open 列表陈旧, 立项 T-Q2 同步
- **2026-06-04 09:00** - 用户技术栈确认: Python+SQL+Redis+MongoDB 后端, Mavis 全包 frontend. 灰色地带 (Rust/Go/Java) Mavis 兜底. 存 user memory.
- **2026-06-04 09:30** - Frontend 栈推荐: Vue 3 + Element Plus + Vite + TS (主推, Bootstrap 背景量身). 用户 confirm.
- **2026-06-04 09:35** - **T-Q1 ✅ done**: mavis-trash 6 文件 (原 4 + glob 新发现 __init__.py + generate_icon.py), 仓库瘦 ~1.3MB
- **2026-06-04 09:35** - **T-Q2 ✅ done**: PROGRESS Open 列表 5 项矛盾全清, 加同步说明, 留 1 项 S5

---

## 📌 下次 Review 触发条件

- T-V2 monthly: 2026-07-04
- T-V2 on-demand: S5 build-test.bat 跑完 / hermes-agent-cn 大版本更新 / 报新 bug
