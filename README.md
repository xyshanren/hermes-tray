# Hermes Tray

[![CI](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml/badge.svg)](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml)

Windows 系统托盘 + 聊天界面，连接 WSL/Linux 里的 Hermes Agent。

最新稳定版: **[v0.1.2](https://github.com/xyshanren/hermes-tray/releases/tag/v0.1.2)** (2026-06-26).
详见 [RELEASE_v0.1.2.md](docs/RELEASE_v0.1.2.md).

## 功能特性

### 核心 (S0–S6)
- 📥 系统托盘常驻，关窗最小化到托盘 (不退出)
- 💬 聊天界面，支持 SSE 流式响应 + Markdown (代码高亮 / 表格)
- 🗂️ 多会话管理：sidebar 列表 + 双击重命名 + 加载更多分页
- 🔍 SQLite FTS5 全文搜索 (Ctrl+K)，命中词高亮
- 🌐 全局热键 `Ctrl+Shift+H` 唤起 + 聚焦窗口
- ⚡ 托盘快捷操作：新建会话 / 续上次 / 搜索 / 3 个管理按钮

### AI 编排 (S7–S10, S12)
- 👤 **Persona 库**: 3 个内置 (通用 / 代码审查 / 翻译) + 自定义, picker 持久化默认 persona
- 📁 **项目上下文感知**: 设置默认项目路径, 新会话自动扫描 README/manifest/git, 注入 system prompt
- 📊 **Token / 成本统计**: 4 period 切换 + SVG stacked bar chart + per-model cost table
- 📤 **导出 / 分享**: 每会话 hover 显 "📤" 复制 Markdown; chat header "🔗" 复制 base64url share link
- 🔐 **加密本地备份**: AES-256-GCM + Argon2id, 密码保护, 完整备份/恢复流

### 多模态 (S13, S14)
- 🎤 **语音输入**: MediaRecorder 录音 → 调 hermes-agent STT → 文字填入框
- 🖼️ **图片拖拽**: 拖图到输入区, 多图 + 缩略图预览, 4 张/10MB 限制, OpenAI multimodal 格式

### OS 集成 + UI
- 🪟 窗口位置/大小自动记忆 (tauri-plugin-window-state)
- 🔌 智能 gateway 连接: config override → 127.0.0.1 → WSL eth0 IP → fallback, 自动绕过 Windows 系统代理
- 🛡️ Tauri 官方插件架构 + capabilities 权限控制
- 🎨 三主题支持: 亮色 / 暗色 / 系统跟随 (CSS variables)

## 系统要求

- Windows 10/11
- WSL2 (Ubuntu 24.04 或其他发行版)
- 已安装 [hermes-agent-cn](https://github.com/xyshanren/hermes-agent-cn) ≥ v0.17.0+cn.17
  - 真 E2E 语音/图片功能需要 hermes-agent 端配套 (见 [hermes-agent-cn/NEEDS_BACKLOG.md](https://github.com/xyshanren/hermes-agent-cn/blob/cn/NEEDS_BACKLOG.md))

## 快速开始

### 1. 安装 hermes-agent-cn (WSL 中)

```bash
git clone https://github.com/xyshanren/hermes-agent-cn.git
cd hermes-agent-cn
git checkout cn

python -m venv hermes-venv
source hermes-venv/bin/activate
pip install -e .
hermes setup              # 配置 API Key (智谱/Kimi/DeepSeek/通义/...)
hermes gateway start      # 启动 Gateway
```

### 2. 安装 hermes-tray

从 [Releases](https://github.com/xyshanren/hermes-tray/releases) 下载 v0.1.2:
- `hermes-tray-tauri_0.1.2_x64-setup.exe` (NSIS 安装包)
- `hermes-tray-tauri_0.1.2_x64_en-US.msi` (MSI 安装包)

或自行编译:

```bash
git clone https://github.com/xyshanren/hermes-tray.git
cd hermes-tray
npm install
npm run tauri dev       # 开发模式 (热重载)
npm run tauri build     # 生产构建
```

### 3. 配置 (UI 里)

启动 hermes-tray, 点击右上角 ⚙️ 打开 Settings:
- **WSL 发行版** — hermes-agent 跑哪个 distro (默认 Ubuntu-24.04.4)
- **Gateway 端口** — hermes gateway 监听端口 (默认 8642)
- **API Key** — hermes gateway 鉴权 key
- **默认项目路径** — T-Q-S8: 新会话自动扫这个目录的 README/manifest/git
- **默认 Model** — T-Q-S12-light: 无 persona 绑定时用的 model 名字

> **v0.1.0 升级说明**: 旧版 `config.json` 写到 exe 同目录, 在 `C:\Program Files\Hermes Tray\` 下没写权限. v0.1.1+ 已迁到 `%APPDATA%\com.hermes.tray\config.json`. 旧配置首次保存时自动备份.

## 使用说明

1. 启动 hermes-agent-cn gateway: `hermes gateway start` (WSL 里)
2. 启动 hermes-tray, header 状态点 "已连接" 表示 Gateway 正常
3. 输入消息 → Enter 发送, Shift+Enter 换行
4. 拖图片到输入区 → 附加为 multimodal
5. 点 🎤 录音 → 再次点击停止 → 文字自动填到输入框
6. 点击右上角 ⚙️ 改设置, 👤 改 Persona, 📊 看 token 成本, 💾 备份/恢复

## 托盘菜单

| 菜单项 | 功能 | 来源 |
|--------|------|------|
| 显示窗口 | 唤起 + 聚焦 chat 窗口 | 基础 |
| 新建会话 | 立即创建空 session 并切换 | T-Q-S6 |
| 续上次 | 加载最近 1 个 session | T-Q-S6 |
| 搜索 | 打开 FTS5 搜索 modal (Ctrl+K) | T-Q-S6 |
| Persona 库 (右键子菜单) | list / create / edit persona | T-Q-S7 |
| Token 成本 (右键子菜单) | 打开统计 modal (4 period 切换) | T-Q-S9 |
| 加密备份 (右键子菜单) | 创建/恢复 .htbk 加密备份 | T-Q-S11 |
| 退出 | 完全关闭应用 (Gateway 继续在 WSL 跑) | 基础 |

> **说明**: Hermes Gateway 生命周期管理**不在**托盘里 — 完全交给 WSL 里的 `systemd` + `hermes gateway start/stop/restart` CLI. 详见 [架构文档 §Gateway 进程管理](docs/architecture.md).

## 文档

| 文档 | 说明 |
|------|------|
| [v0.1.2 Release Notes](docs/RELEASE_v0.1.2.md) | S0–S10 全部 v2.0 功能 + 安装 + 已知限制 |
| [v0.1.1 Release Notes](docs/RELEASE_v0.1.1.md) | T-Q-NEW config 路径 bug 修复 |
| [v0.1.0 Release Notes](docs/RELEASE_v0.1.0.md) | 首个公开版本 |
| [v2.0 存储架构设计](docs/T-Q-S0-design.md) | SQLite schema + DAO 设计 (455 行) |
| [产品需求文档](docs/product-requirements.md) | 用户故事 / 功能 / 非功能需求 |
| [架构设计文档](docs/architecture.md) | 系统架构 / 模块设计 / 数据结构 / 安全 |
| [开发指南](docs/development-guide.md) | 环境搭建 / 项目结构 / 命令参考 / 调试 |

## 技术栈

- **桌面框架**: [Tauri 2.x](https://tauri.app)
- **前端**: TypeScript + Vite + 原生 DOM + CSS variables (无 UI 框架)
- **后端**: Rust 1.85+, r2d2 + rusqlite (bundled SQLite)
- **加密**: `aes-gcm` 0.10 + `argon2` 0.5 + `rand` 0.8
- **HTTP**: `reqwest` 0.12 (含 multipart / json / stream features)
- **Tauri 插件**: `tauri-plugin-shell` (WSL 进程调用), `tauri-plugin-fs` (capability), `tauri-plugin-window-state` (窗口位置记忆), `tauri-plugin-global-shortcut` (Ctrl+Shift+H)
- **通信**: HTTP + SSE 流式 (OpenAI Chat Completions 协议)
- **测试**: cargo test (Rust 单元 + 集成, **133 个** / ~48% 覆盖率), Vitest (TS 单元, **90 个**), happy-dom test env

## 路线图

| 状态 | 编号 | 任务 |
|------|------|------|
| ✅ done | S0–S11 | SQLite + 搜索 + 热键 + 托盘 + Persona + 项目 + 成本 + 导出 + 备份 |
| ✅ done | S12-light / S13 / S14 | 模型选择器 + 语音输入 + 图片拖拽 (tray 部分) |
| ⏸️ 等待 agent | S12-agent / S13-agent / S14-agent | hermes-agent-cn 配套 (NEEDS_BACKLOG.md Phase 1-3) |
| ❌ dropped | S15 | 插件系统 — 移到 hermes-agent (已有 `plugins.py` 框架) |

## 许可证

MIT
