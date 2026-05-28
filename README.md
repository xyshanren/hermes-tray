# Hermes Tray

Windows 系统托盘应用 + 聊天界面，用于连接 WSL/Linux 中的 Hermes Agent。

## 功能特性

- 📥 系统托盘图标，常驻后台运行
- 💬 聊天界面，支持流式响应
- ⚡ 一键启动/停止 Hermes Gateway
- 🔌 自动检测 WSL2 IP 地址
- 🚪 关闭窗口最小化到托盘，而非退出应用

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

1. 启动 hermes-tray，状态显示"已连接"表示 Gateway 正常
2. 在聊天窗口输入消息，与 Hermes AI 对话
3. 点击窗口关闭按钮，最小化到系统托盘
4. 右键托盘图标：
   - 显示窗口 - 重新打开聊天界面
   - 启动 Gateway - 启动 WSL 中的 Hermes Gateway
   - 停止 Gateway - 停止 Gateway 进程
   - 退出 - 完全退出应用

## 托盘菜单

| 菜单项 | 功能 |
|--------|------|
| 显示窗口 | 打开聊天界面 |
| 启动 Gateway | 在 WSL 中启动 `hermes gateway start` |
| 停止 Gateway | 停止 Hermes Gateway 进程 |
| 重启 Gateway | 重启 Hermes Gateway（停止 → 启动） |
| 退出 | 关闭应用（Gateway 继续运行） |

## 文档

| 文档 | 说明 |
|------|------|
| [产品需求文档](docs/product-requirements.md) | 用户故事、功能/非功能需求、发布计划 |
| [架构设计文档](docs/architecture.md) | 系统架构、模块设计、数据结构、安全设计 |
| [开发指南](docs/development-guide.md) | 环境搭建、项目结构、命令参考、调试技巧 |

## 技术栈

- **前端**: TypeScript + Vite + Tauri 2
- **后端**: Rust + reqwest
- **通信**: HTTP + SSE 流式

## 许可证

MIT
