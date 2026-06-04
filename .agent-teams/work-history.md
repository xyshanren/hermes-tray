# Hermes-Tray Work History

> Mavis Agent Teams 工作历史 (追加式)
> 不删除历史记录, 只 append

---

## 2026-06-04 - 初始 Review + 项目骨架建立

### 探查记录

**触发**: Qoder 全栈 agent teams 维护模式启动

**读过的文件**:
- `PROGRESS.md` (50+ lines, S0-S5 milestones)
- `docs/architecture.md` (Tauri 2 + TS + Rust 架构)
- `README.md` (用户面文档)
- `tray_app.py` (250 行, pystray 旧实现, **死代码**)
- `gateway_manager.py` (330 行, WSL 进程管理, **死代码**)
- `config.py` (360 行, YAML 配置, **死代码**)
- `.gitignore` (38 行)
- `src/main.ts` (16127B, 当前 TS 前端)
- `.github/workflows/ci.yml` (1761B)
- `.github/workflows/release.yml` (2822B)
- `src-tauri/` 结构 (target/debug 已编译, 含大量 build artifact)

**关键发现**:

1. **3 个 Python 文件是死代码**
   - `tray_app.py` / `gateway_manager.py` / `config.py`
   - 证据: ARCHITECTURE.md 只提 Tauri + Rust, 不在 src-tauri/src/lib.rs 引用链
   - PROGRESS S2: "Python 版功能移植至 Rust [x]"

2. **PROGRESS.md Open 列表陈旧**
   - 5 项 Open 中 4 项跟 S3-S4 done 状态矛盾
   - Textarea 自动增高 / API Key 硬编码 / 窗口位置持久化 / 图标路径 — 都已 done
   - 唯一真 Open: S5 Windows 构建测试

3. **测试覆盖 ~0%**
   - 无 `tests/` 目录
   - CI 靠 tsc/build/cargo check/clippy/fmt, 无单测

4. **CI 完整** ✅
   - ci.yml: PR 触发, build + test (实际无测试)
   - release.yml: tag push 触发, 跨平台矩阵

5. **Python 死代码里的代码质量问题** (已删建议)
   - `tray_app.py:100` bare except 吞所有
   - `gateway_manager.py:255` shell 注入风险
   - `config.py:148` Windows 默认路径错 (Linux 路径)
   - 无单元测试

**立项任务** (见 TASK_BOARD.md):
- P0: T-Q1 删 Python 死代码 / T-Q2 同步 PROGRESS Open 列表
- P1: T-Q3 查证 Open #5 权限 / T-Q4 Windows 端 S5 build-test / T-Q5 Rust 单元测试
- P2: T-Q6 前端单测 / T-Q7 跨项目集成测试 / T-Q8 ARCHITECTURE 同步

**项目骨架建立**:
- `.agent-teams/config.yaml` — 项目 Agent Teams 配置
- `.agent-teams/TASK_BOARD.md` — 任务看板 (P0/P1/P2)
- `.agent-teams/work-history.md` — 本文件

**生成的报告**:
- `F:\work\workspace\MiniMax\projects\reports\qoder-hermes-tray-review.md`
  (8 章节: 概览 / 进度 / 死代码 / Rust 待审 / 架构 / 行动 / 骨架 / 总结)

**决策**:
- T-V1 auto-approval 用于: 删死代码 / 同步文档 / 写测试 (T-Q1, Q2, Q5, Q6, Q8)
- T-V2 user-approval 用于: Windows 端 S5 测试 / 跨项目集成 / 改架构 (T-Q3 改权限时, T-Q4, T-Q7)

**下一步**:
- 等用户 go/a 触发 T-Q1 删 Python 死代码
- 等用户 go/a 触发 T-Q2 同步 PROGRESS Open
- 等用户 Windows 端跑 S5 build-test.bat (T-Q4)

---

## 待追加 (下一次 review / 任务完成时)

- T-Q1 完成记录
- T-Q2 完成记录
- 用户 Windows 端 S5 build-test 结果
- ...

---

## 2026-06-04 09:35 - T-Q1 + T-Q2 完成 (P0 全清)

### T-Q1: 删 6 个 Python 死代码
- **执行**: mavis-trash 6 文件
  - `tray_app.py` (~250 行)
  - `gateway_manager.py` (~330 行)
  - `config.py` (~360 行)
  - `requirements.txt` (Python 依赖)
  - `__init__.py` (13 行, 旧 pystray 版 package 标记, **glob 新发现**)
  - `generate_icon.py` (95 行, 旧 PIL icon 生成, **glob 新发现**)
- **总清理量**: ~1083 行 Python + 87 字节 requirements.txt
- **新发现**: 原 review 只列了 3 个 Python 文件, glob `**/*.py` 找到 2 个遗漏 (`__init__.py` + `generate_icon.py`), 同样是 pystray 旧版遗留
- **验证**: `Get-ChildItem -Filter "*.py"` = 空
- **残留**: `__pycache__/` 还有 2 个 .pyc (`config.cpython-312.pyc` + `gateway_manager.cpython-312.pyc`), 用户授权后清
- **T-V**: T-V1 auto-approval (用户已 "go")

### T-Q2: 同步 PROGRESS.md Open 列表
- **执行**: Edit 工具, 替换 Open 表格
- **变更**:
  - 删 5 项矛盾 (Textarea / API Key / 窗口位置 / 图标路径 / 权限列表) — 实际全在 S3-S4 done
  - 加同步说明 (2026-06-04 T-Q2 done 注释)
  - 留 1 项 S5 #5 (Windows build-test.bat)
- **风险**: 低 (仅 Markdown 文档)
- **T-V**: T-V1 auto-approval

### P0 全清后状态
- 8 个任务: 2 done (T-Q1, T-Q2) + 6 pending (T-Q3-T-Q8)
- 仓库 Python 计数 = 0
- PROGRESS Open 列表 1 项 (S5 Windows 测试)
- 下一步: T-Q3 (查证 Open #5 权限, 实际 Open 列表已无此项) / T-Q4 (用户跑 S5) / T-Q5 (Rust 单测)

### 用户技术栈确认
- **后端**: Python + SQL + Redis + MongoDB (用户自做)
- **前端**: Mavis 全包 (TypeScript / React / Vue 等)
- **灰色**: Rust / Go / Java / C# 等用户不熟语言, Mavis 兜底
- **Frontend 栈选择 (2026-06-04 09:30 confirm)**: Vue 3 + Element Plus + Vite + TS (主推, Bootstrap 背景量身). 存 user memory.
- **hermes-tray 含义**: Tauri Rust 后端 + TS 前端 全归 Mavis/Builder, Python 死代码已清

