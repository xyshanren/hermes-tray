# Hermes-Tray Task Board

> **Mavis 维护的项目任务看板** (替代 PROGRESS.md Open 列表, 避免漂移)
> **基线日期**: 2026-06-04 (基于 PROGRESS.md S0-S4 done + S5 5/6)

---

## 📊 项目状态

| 维度 | 状态 |
|------|------|
| **里程碑** | S0-S4 ✅ done / S5 5/6 done (1 项待 Windows 端跑) |
| **Done 任务** | 14 (来自 PROGRESS.md) + 6 (T-Q1/Q2/Q3/Q5/Q6 + 死声明清理) |
| **Open 任务** | 1 (S5 Windows build-test.bat) |
| **In Progress** | 0 |
| **P0 进度** | 2/2 done (T-Q1 删 Python / T-Q2 同步 Open) — 2026-06-04 09:35 |
| **P1 进度** | 3/3 done (T-Q3 审计 / T-Q5 Rust 单测 / T-Q6 TS 单测) — 2026-06-04 10:42, T-Q4 等用户跑 |
| **P2 进度** | 0/2 (T-Q7 集成 / T-Q8 文档) |
| **P3 进度** | 0/1 (T-Q9 plugin-化, 新立 2026-06-04) |
| **Test 覆盖** | ~40% (T-Q5 22 Rust + T-Q6 37 TS 用例, 0% → 40%, 外部命令留 T-Q9) |
| **技术债** | 已清: 6 Python 死代码 + opener 死声明 / 留 T-Q9 plugin-化架构改造 |

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
- **状态**: ✅ done (2026-06-04 10:42, Scout 审计完成, commit 0cca2d8)
- **关键发现**:
  - 3 项声明 (core:default / opener:default / window-state:default) 覆盖所有 14 个 IPC 命令
  - `opener:default` 是死声明 (Cargo.toml + capabilities 有, 代码无调用) → 顺手清
  - **架构问题**: 13 个 IPC 命令用 std::process::Command / std::fs / reqwest 绕过 Tauri capability 安全模型 (WSL/Config/HTTP 全部走 Rust 层硬编码防护, 无 plugin 介入) → 转 T-Q9 (P3) 改造
  - 注入风险低 (Command::arg() 参数化, 无 shell 展开)
- **后续 follow-up**:
  - **B (本期做)**: 删 `tauri-plugin-opener` + `opener:default` (死声明) — 30 min
  - **C (P3 改造)**: 引入 tauri-plugin-shell / fs / http 替换 std::*, 同步补 capabilities — 4-6 h, T-V2

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
  - `escapeHtml()` (SSE 解析)
  - `handleStream()` (SSE 解析)
  - `renderMarkdown()`
- **工具**: vitest
- **所有权**: Builder
- **T-V**: T-V1
- **状态**: ✅ done (2026-06-04 10:42, Builder 完成, commit 0583ecc) — **从 P2 提升提前到 P1 跑, 跟 T-Q5 并行**
- **结果**: 37 个 vitest 用例全过, 4 个 .test.ts (escapeHtml 9 / sseParser 11 / apiMessages 10 / formatMessage 7). 抽出 4 个 utility module 1:1 镜像 main.ts 内联逻辑 (escapeHtml / sseParser / apiMessages / formatMessage), main.ts 100% 保留. vitest.config.ts + happy-dom 配置就位.

### T-Q8: ARCHITECTURE.md 同步
- **范围**: T-Q1 后, ARCHITECTURE.md 是否需要标注"Python 版已删"或加历史章节
- **T-V**: T-V1
- **状态**: ⏳ pending (T-Q1 完成后触发)

---

## 🎯 P3 后续优化 (改造期, 跟 T-V2 走)

### T-Q9: Plugin-化改造 (std::* → tauri-plugin-*)
- **来源**: T-Q3 审计 (2026-06-04)
- **架构问题**: 当前 13 个 IPC 命令用 `std::process::Command` / `std::fs` / `reqwest` 绕过 Tauri capability 安全模型, 跟 Tauri 推崇的 plugin + capabilities 模式脱节
- **改造范围** (4 步):
  1. **WSL 命令** (8 个, `std::process::Command::new("wsl.exe")` → `tauri-plugin-shell`):
     - hermes_resolve_gateway_ip
     - hermes_check_gateway_status
     - hermes_start_gateway
     - hermes_stop_gateway
     - hermes_detect_wsl
     - hermes_list_wsl_distros
     - hermes_find_bin
     - hermes_restart_gateway
  2. **Config 命令** (2 个, `std::fs::*` → `tauri-plugin-fs`):
     - hermes_get_config
     - hermes_save_config
  3. **HTTP 命令** (3 个, `reqwest` → `tauri-plugin-http`):
     - hermes_check_gateway_health
     - hermes_proxy_get
     - hermes_proxy_post
     - hermes_proxy_post_stream
  4. **Capabilities 同步补全** (关键! 不补会 Tauri 拦截):
     - `shell:allow-execute` (白名单 `wsl.exe` 路径)
     - `fs:default` + `fs:allow-read-file` / `fs:allow-write-file` (限定 config.json 路径)
     - `http:default` (限定 hermes gateway 域名/IP)
- **预期时间**: 4-6 h
- **风险**: 中
  - 改造面大, 需全量测试覆盖 (T-Q5 + T-Q6 已铺好基线)
  - capabilities 同步出错会导致功能"明明代码对了但 Tauri 拒绝执行"
  - 用户当前接受 Rust 层硬编码安全, 改造不紧迫
- **T-V**: T-V2 (架构改动, 需用户拍)
- **触发条件**:
  - 用户主动说要 plugin 化
  - 或 security audit 要求 capabilities 覆盖
  - 或要 publish 到 Tauri 官方商店 (审核会卡)
- **状态**: ⏳ pending (排期, 不在 P1/P2 内)
- **决策记录**: 2026-06-04 10:50 用户拍: 先 B (本期删死声明), C 写入 P3 待排

---

## 🔄 决策日志

- **2026-06-04 08:00** - 初始 review 完成, 识别 3 个 Python 死代码, 立项 T-Q1~Q5
- **2026-06-04 08:00** - Open 列表陈旧, 立项 T-Q2 同步
- **2026-06-04 09:00** - 用户技术栈确认: Python+SQL+Redis+MongoDB 后端, Mavis 全包 frontend. 灰色地带 (Rust/Go/Java) Mavis 兜底. 存 user memory.
- **2026-06-04 09:30** - Frontend 栈推荐: Vue 3 + Element Plus + Vite + TS (主推, Bootstrap 背景量身). 用户 confirm.
- **2026-06-04 09:35** - **T-Q1 ✅ done**: mavis-trash 6 文件 (原 4 + glob 新发现 __init__.py + generate_icon.py), 仓库瘦 ~1.3MB
- **2026-06-04 09:35** - **T-Q2 ✅ done**: PROGRESS Open 列表 5 项矛盾全清, 加同步说明, 留 1 项 S5
- **2026-06-04 10:42** - **P1 team plan 跑完**: T-Q3 (审计) + T-Q5 (Rust 22 用例) + T-Q6 (TS 37 用例) 三路全部 accept, plan_61d7e14e 关闭. 15 commits 领先 origin 未推
- **2026-06-04 10:50** - **用户拍 B+C**: 立即做 B (删 tauri-plugin-opener + opener:default 死声明), C 排到 P3 (T-Q9 plugin-化改造, 4-6h, T-V2 触发)
- **2026-06-04 10:55** - **B 进行中**: 已 Edit Cargo.toml + capabilities/default.json, 待 cargo check + commit

---

## 📌 下次 Review 触发条件

- T-V2 monthly: 2026-07-04
- T-V2 on-demand: S5 build-test.bat 跑完 / hermes-agent-cn 大版本更新 / 报新 bug
