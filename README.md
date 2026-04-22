# Hermes Tray

Hermes 系统托盘应用 - Phase 1 最小可行产品

## 功能

- 系统托盘常驻
- 点击打开 Web UI
- Gateway 后台管理（启动/重启/停止）
- 开机自启
- **支持 WSL2 环境** - 自动检测并使用 WSL2 中的 Hermes

## 安装

### 方式一：直接运行（开发模式）

```bash
# 安装依赖
pip install -r requirements.txt

# 生成图标
python generate_icon.py

# 运行
python tray_app.py
```

### 方式二：打包成 EXE

```bash
# 打包
build.bat

# 生成安装程序（需要安装 Inno Setup）
build-setup.bat
```

## 使用

1. 运行 `Hermes Tray.exe`
2. 系统托盘出现 Hermes 图标
3. 右键点击图标显示菜单：
   - 打开 Hermes - 打开 Web UI
   - Gateway 管理 - 启动/停止/重启
   - 设置 - 打开配置文件
   - 查看日志 - 打开日志目录
   - 退出 - 关闭应用

## 依赖

- Python 3.9+
- pystray - 系统托盘
- Pillow - 图像处理
- psutil - 进程管理
- PyYAML - 配置文件解析

## 文件结构

```
hermes-tray/
├── tray_app.py          # 主入口
├── gateway_manager.py   # Gateway 管理
├── config.py            # 配置读取
├── generate_icon.py     # 图标生成
├── requirements.txt     # Python 依赖
├── build.bat            # 打包脚本
├── build-setup.bat      # 安装程序构建
├── setup.iss            # Inno Setup 配置
└── assets/
    └── icon.ico         # 托盘图标
```

## 配置

应用会读取 `~/.hermes/config.yaml` 获取配置：

- `gateway.port` - Web UI 端口（默认 8765）
- `log_dir` - 日志目录

## WSL2 支持

应用自动检测 WSL2 环境：

1. 检查 Windows 系统
2. 检查 wsl 命令可用
3. 检查 `/root/.local/bin/hermes` 是否存在

如果检测到 WSL2 环境，所有 Gateway 操作都会通过 `wsl` 命令执行：
- 进程检测：`wsl pgrep -f "hermes gateway"`
- 启动：`wsl bash -c "nohup hermes gateway start > /dev/null 2>&1 &"`
- 停止：`wsl hermes gateway stop`

## 版本

- v0.1.0 - 初始版本
  - 基础托盘功能
  - Gateway 管理
  - 开机自启
