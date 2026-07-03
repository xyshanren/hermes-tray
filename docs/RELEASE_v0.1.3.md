# hermes-tray v0.1.3 — Release Notes (FINAL)

> **状态**: ✅ FINAL — release candidate 准备就绪，明天打 tag
> **发布时间窗**: 预计 2026-07-03 上午（决策后）
> **发布日期**: 2026-07-02 (release notes 落地)

---

## TL;DR

v0.1.3 是一个小版本号，但是**两个项目协同完成的关键跨项目 milestone**：

| 项目 | Commit | 摘要 |
|---|---|---|
| hermes-tray (master) | `1764d10` | S5+ quick capture: Ctrl+Shift+H 自动开新会话（pure frontend, 22 行 main.ts） |
| hermes-tray (master) | `922cf42` | PROGRESS.md 同步：Phase 0.6 ✅ done, v2.0-final tag |
| hermes-tray (master) | `78544b82` | PROGRESS sync + 本 release notes 草案 |
| hermes-agent-cn (cn) | `016383af8` | S13 STT 端点 `/v1/audio/transcriptions`（OpenAI-compat multipart）+ 14 个 web_server.py cherry-pick 残缺修复 |
| hermes-agent-cn (cn) | `3cf790170` | CHANGELOG_CN v0.17.0+cn.18 段 + NEEDS_BACKLOG §需求 2 done |

---

## 范围 (final)

### ✅ 包含

#### 1. S5+ quick capture
**Commit:** `1764d10` on `master`（pushed 2026-07-02）
- 文件: `hermes-tray/src/main.ts` L1975-L1998
- 行为: `Ctrl+Shift+H` 从 "唤起 + 聚焦输入框" 升级到 "复用 `createSession()` 直接开新会话 + 清空输入框 + focus"
- 实现细节: 复用 `createSession()` 已经负责 `currentSessionId = session.id` + 重置 `state.messages` + 刷新 sidebar + 失败 toast
- 新增行为: 收侧边栏到 focus 模式 + 清空 + focus 让用户立刻打字
- **Tests**: 90 vitest + 133 cargo = **223/223 passed in 3.85s**

#### 2. hermes-agent-cn S13 STT endpoint
**Commit:** `016383af8` on `cn`（pushed 2026-07-02）
- 文件: `hermes-cli/hermes_cli/web_server.py` (new endpoint + collateral fixes) + `tests/test_s13_audio_transcriptions.py` (new)
- 行为: `POST /v1/audio/transcriptions` 接 multipart/form-data (file + 可选 model)，返回 OpenAI-shape `{"text": "..."}` 或 `{"error": {...}}`
- Provider 路由: 复用 `stt.provider` config (`local` / `groq` / `openai` / `mistral` / `elevenlabs`) — **0 新 STT 实现**，全部走既有 `tools.transcription_tools.transcribe_audio()`
- 大小限制: `_MAX_TRANSCRIPTION_UPLOAD_BYTES = 25 MB`
- **Tests**: 8 TestClient + monkeypatch tests **8/8 passed in 2.17s** (happy path + model forwarding + 4 validation paths + crash isolation + helper shape)
- **Collateral fixes** (含在同 commit 里): 8 stdlib imports + 6 Pydantic class + 2 indent bug + 1 `@dataclass` import — 修完 `web_server.py` 才 import 得了

### ❌ 不包含（决策到 v0.1.4）

- **T-Q-S13 升级到真 S13 endpoint** — 改 `src-tauri/src/commands.rs` 把 placeholder STT URL 切到 hermes-agent-cn `/v1/audio/transcriptions` 真实调用——**今晚没时间 verify，留 v0.1.4**
- **集成测试** — 端到端 (tray + hermes-agent-cn server 同时跑) 实际 STT flow 验证 —— 留 v0.1.4 setup CI 后跑
- **CHANGELOG.md (root) v0.1.3 entry** — 等 tag 后 commit — 留 v0.1.4

---

## 决策点 (decision made 2026-07-02)

| Decision | Final pick | 理由 |
|---|---|---|
| Tray STT 升级是否进 v0.1.3? | **❌ 推迟到 v0.1.4** | 集成 verify 没时间；推 v0.1.3 让 hermes-tray 用户先用上 quick capture，STT 升级独立验证后单独发 |
| 集成测试路径 | **⏸ 留 v0.1.4** | CI 还没 setup，手动跑 fragile |
| Tag 命名 | `v0.1.3` (hermes-tray 单独) + `v0.17.0+cn.18` (hermes-agent-cn 单独) | 跨项目协调 release 反而增加风险，独立发但 release notes 互引 |

---

## 用户动作 (when ready)

```bash
# 1. 看 v0.1.3 候选
cd D:\work\workspace\Qoder\hermes-tray
git log --oneline -5
# c5b2acc chore(cleanup): drop v0.1.2 build artifacts
# 61102f5 chore(deps): pin Tauri npm packages to v0.1.2 verified versions
# 1764d10 T-Q-S5+: quick capture global shortcut (Ctrl+Shift+H now creates new session)
# 922cf42 docs(sync): PROGRESS — close S5 增强
# 78544b82 docs(sync): PROGRESS + v0.1.3 release plan (this doc)

# 2. 打 tag
git tag -a v0.1.3 78544b82 -m "v0.1.3 — S5+ quick capture global shortcut"
git push origin master --tags

# 3. 更新根 CHANGELOG.md (hermes-tray)
# 加 v0.1.3 entry，引用本文档
```

---

## 风险 & 已知 issues

| 风险 | 状态 |
|---|---|
| **hermes-agent-cn `web_server.py` 仍然有大量 cherry-pick 残缺** — 修了 S13 endpoint 触及的部分，但是否有其他未被引入的 route 也 broken 未知 | 今天 0 路由回归 → 205 routes 注册成功；其他 route 如果调用也按本模式错也会暴露 |
| **T-Q-S13 placeholder STT** 用户体验：tray 实际用时仍走 placeholder，直到 v0.1.4 | 文档化在 NEEDS_BACKLOG §需求 2 |
| **playwright + chromium 在 social-publisher venv** 是另一个 CodeArts 项目，本次 release 不动 | 自有 mavis memory 记 |

---

## Links

- [hermes-tray commit `1764d10`](https://github.com/xyshanren/hermes-tray/commit/1764d10) — S5+ quick capture
- [hermes-agent-cn commit `016383af8`](https://github.com/xyshanren/hermes-agent-cn/commit/016383af8) — S13 STT endpoint + collateral
- [hermes-agent-cn `NEEDS_BACKLOG.md` §需求 2](../../hermes-agent-cn/NEEDS_BACKLOG.md#需求-2-s13-agent---v1audiotranscriptions-端点--done-2026-07-02)
- [hermes-agent-cn `CHANGELOG_CN.md` v0.17.0+cn.18 段](../../hermes-agent-cn/CHANGELOG_CN.md#changelog--v0170cn18-needs_backlog-phase-1-s13-stt-端点)
- [`D:\work\workspace\MiniMax\HANDOFF.md`](../MiniMax/HANDOFF.md) — 跨项目 user-readable doc
- [ai-music-trainer `AGENTS.md`](../../ai-music-trainer/AGENTS.md) — 暂停状态
- [mavis agent memory](C:\Users\lixia\.mavis\agents\mavis\memory\MEMORY.md) — 完整今日交付账

---

## GitHub Release 安装包说明

上传到 https://github.com/xyshanren/hermes-tray/releases/tag/v0.1.3 时，把下面 3 个 binary 作为 assets：

### 1. `hermes-tray-tauri_0.1.3_x64_en-US.msi` (Windows MSI Installer · ~7 MB)

**适合**: 企业部署 / IT 管理员 / Group Policy / silent install / 已经熟悉 MSI 流程的用户。

**安装**:
- 双击，跟正常 Windows 安装器走流程
- **Silent install** (IT 用): `msiexec /i hermes-tray-tauri_0.1.3_x64_en-US.msi /qn`
- 默认安装到 `C:\Program Files\hermes-tray\`，卸载走"应用和功能"
- 升级时 Windows Installer 会自动处理版本号

### 2. `hermes-tray-tauri_0.1.3_x64-setup.exe` (NSIS Setup · ~3 MB)

**适合**: 大多数 Windows 用户 / 第一次装 / 想自定义安装路径和开始菜单项。

**安装**:
- 双击，会弹 NSIS 风格的"下一步"安装器
- 可选: 桌面快捷方式 / 开始菜单项 / 自定义安装路径
- 卸载走开始菜单的"卸载 hermes-tray"或"应用和功能"
- 体积比 MSI 小（不嵌 Windows Installer 公共组件）

### 3. `hermes-tray-tauri.exe` (Portable · ~17 MB)

**适合**: 高级用户 / 想 portable 跑 / 不想污染系统 / 临时测试 / debug。

**用法**:
- 直接双击运行，**不安装**，无注册表项，无开始菜单
- 卸载 = 删除文件
- 第一次跑会问 hermes-agent gateway IP/port，可走 tray 设置 UI 改
- **不推荐**给普通用户用：升级、卸载、依赖（VC++ runtime 等）都得手动管

### 共同要求

- **操作系统**: Windows 10+ x64 (Win11 22H2+ 推荐，含 WSL2 localhostForwarding)
- **运行时依赖**: 
  - WebView2 Runtime（Win11 自带 / Win10 需 [手动装](https://developer.microsoft.com/microsoft-edge/webview2/)）
  - **hermes-agent-cn gateway** 必须跑在 WSL2（默认 `127.0.0.1:8642`，可在 tray 设置改）
  - tray 默认会去 WSL 探测 hermes-agent IP，找不到则 fallback `172.31.98.230:8642`（可改）
- **S5+ quick capture** 默认全局热键 `Ctrl+Shift+H`（在 tray 设置里可改）

### 升级提示

从 v0.1.0 / v0.1.1 / v0.1.2 升级:
- 用 MSI 装的：直接装新版 MSI，Windows Installer 会处理
- 用 NSIS 装的：装新版，NSIS 会询问是否覆盖
- Portable 版：退出旧版，覆盖 exe

### 已知问题

- **T-Q-S13 语音输入** 依赖 hermes-agent-cn `v0.17.0+cn.18+` 的 `/v1/audio/transcriptions` 端点（已发布）。未跑过的话 tray 录音会失败，但**不会**影响其他功能（chat / quick capture 等）
- **NSIS 安装器下载** 首次 build 会从 GitHub 拉 NSIS 3 + nsis_tauri_utils.dll (~30s)，之后增量 build 复用

---

## 发布命令 (release 管理员参考)

```bash
# 1. push 4d0adbb version bump
cd D:\work\workspace\Qoder\hermes-tray
git push origin master

# 2. 创建 GitHub release + 上传 3 个 binary
gh release create v0.1.3 \
  --title "v0.1.3 — S5+ quick capture global shortcut" \
  --notes-file docs/RELEASE_v0.1.3.md \
  src-tauri\target\release\bundle\msi\hermes-tray-tauri_0.1.3_x64_en-US.msi \
  src-tauri\target\release\bundle\nsis\hermes-tray-tauri_0.1.3_x64-setup.exe \
  src-tauri\target\release\hermes-tray-tauri.exe
```

(已经存在的 v0.1.3 git tag 会被 gh release 自动关联)


## 历史

- **2026-07-02**: DRAFT → FINAL (本文档)
- **2026-07-02**: 落地 S5+ + S13 + cross-project doc sync
