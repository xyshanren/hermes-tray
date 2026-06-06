# Hermes Tray

[![CI](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml/badge.svg)](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml)

Windows 系统托盘应用 + 聊天界面，用于连接 WSL/Linux 中的 Hermes Agent。

## 功能特性

- 📥 系统托盘图标，常驻后台运行
- 💬 聊天界面，支持流式响应 & Markdown 渲染（代码高亮、表格）
- ⚙️ 设置页面：WSL 发行版、Gateway 端口、API Key 自由配置
- 🧠 模型名动态获取并在标题栏实时显示
- 📏 输入框字数限制 & 自动增高
- 🔌 **智能 gateway 连接** — 优先级链: `config override → 127.0.0.1 (Win11 localhostForwarding) → WSL eth0 IP → fallback`, 自动绕过 Windows 系统代理 (Clash 等)
- 🔌 自动检测 WSL2 IP 地址（支持任意 WSL 发行版）
- 🚪 关闭窗口最小化到托盘，而非退出应用
- 🪟 窗口位置/大小自动记忆
- 🛡️ Tauri 官方插件架构 (`tauri-plugin-shell/fs`) + capabilities 权限控制

## 系统要求

- Windows 10/11
- WSL2（Ubuntu 24.04 或其他发行版）
- 已安装 [hermes-agent-cn](https://github.com/xyshanren/hermes-agent-cn)

## 快速开始

### 1. 安装 hermes-agent-cn（WSL 中）

```bash
# 克隆并安装 Hermes Agent
git clone https://github.com/xyshanren/hermes-agent-cn.git
cd hermes-agent-cn
git checkout cn

# 创建虚拟环境
python -m venv hermes-venv
source hermes-venv/bin/activate

# 安装依赖
pip install -e .

# 初始化配置
hermes setup
# 配置 API Key（支持智谱、Kimi、DeepSeek、通义等国内模型）

# 启动 Gateway
hermes gateway start
```

### 2. 安装 hermes-tray

从 [Releases](https://github.com/xyshanren/hermes-tray/releases) 下载最新版本：
- `hermes-tray-tauri_0.1.0_x64-setup.exe` - NSIS 安装包
- `hermes-tray-tauri_0.1.0_x64_en-US.msi` - MSI 安装包

或自行编译：

```bash
# 克隆仓库
git clone https://github.com/xyshanren/hermes-tray.git
cd hermes-tray

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建发布
npm run tauri build
```

### 3. 配置（可选）

在 exe 同目录下创建 `config.json` 可配置 WSL 发行版：

```json
{
  "wsl_distro": "Ubuntu-24.04.4"
}
```

默认使用 `Ubuntu-24.04.4`。

## 使用说明

1. 启动 hermes-agent-cn gateway: `hermes gateway start` (WSL 里, 见 hermes-agent-cn 文档)
2. 启动 hermes-tray, 状态显示"已连接"表示 Gateway 正常
3. 在聊天窗口输入消息，与 Hermes AI 对话（流式响应 + Markdown 渲染）
4. 点击右上角 ⚙️ 按钮可修改 WSL 发行版、端口、API Key
5. 点击窗口关闭按钮, 最小化到系统托盘
6. 右键托盘图标:
   - 显示窗口 - 重新打开聊天界面
   - 退出 - 完全退出应用 (Gateway 继续在 WSL 跑, 跟 systemd 一起)

## 托盘菜单

| 菜单项 | 功能 |
|--------|------|
| 显示窗口 | 打开聊天界面 |
| 退出 | 关闭应用（Gateway 继续在 WSL 跑, 不受影响） |

> **说明**: Hermes Gateway 生命周期管理不在托盘里 — 完全交给 WSL 里的 `systemd` + `hermes gateway start/stop/restart` CLI. 详见 [架构文档 §Gateway 进程管理](docs/architecture.md) 章节.

## 文档

| 文档 | 说明 |
|------|------|
| [v0.1.0 Release Notes](docs/RELEASE_v0.1.0.md) | 首个公开版本的变更详情 + 安装 + 已知限制 + 路线图 |
| [产品需求文档](docs/product-requirements.md) | 用户故事、功能/非功能需求、发布计划 |
| [架构设计文档](docs/architecture.md) | 系统架构、模块设计、数据结构、安全设计 |
| [开发指南](docs/development-guide.md) | 环境搭建、项目结构、命令参考、调试技巧 |

## 技术栈

- **桌面框架**: [Tauri 2.x](https://tauri.app)
- **前端**: TypeScript + Vite + 原生 DOM (按需引入 Vue 3 + Element Plus, v0.2.0 计划)
- **后端**: Rust 1.85+
- **Tauri 插件**: `tauri-plugin-shell` (WSL 进程调用), `tauri-plugin-fs` (config 持久化), `tauri-plugin-window-state` (窗口位置记忆)
- **通信**: HTTP + SSE 流式 (OpenAI Chat Completions 协议)
- **测试**: pytest (集成, 21 tests / 8 scenarios), cargo test (Rust 单元, 49 tests), Vitest (TS 单元, 37 tests)

## 许可证

MIT
