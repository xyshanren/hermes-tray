# Hermes Tray Phase 1 实现进度

## 已完成

### 核心代码
- [x] `gateway_manager.py` - Gateway 进程管理（支持 WSL2）
  - WSL2 自动检测
  - Windows 原生和 WSL2 双模式
  - 启动/停止/重启 Gateway
  - Hermes 健康检查
- [x] `config.py` - Hermes 配置读取（Web UI 端口、日志目录等）
- [x] `tray_app.py` - 系统托盘主应用
  - 托盘图标
  - 右键菜单（打开 Hermes、Gateway 管理、设置、日志、退出）
  - Gateway 状态动态显示
  - 后台状态更新线程

### 资源
- [x] `assets/icon.ico` - 托盘图标（蓝色圆形 + "H" 字母）
- [x] `assets/icon.png` - PNG 版本

### 构建脚本
- [x] `build.bat` - PyInstaller 打包脚本
- [x] `build-setup.bat` - Inno Setup 安装程序构建
- [x] `setup.iss` - Inno Setup 配置（支持自定义安装路径、开机自启）
- [x] `run.bat` - 测试运行脚本

### 文档
- [x] `README.md` - 项目说明
- [x] `requirements.txt` - Python 依赖
- [x] `package.json` - 项目元信息

## 测试结果

### WSL2 环境测试

```
使用 WSL2: True
Hermes 路径: /root/.local/bin/hermes
Gateway 运行状态: True
Hermes 健康状态: True
信息: Hermes Agent v0.10.0 (2026.4.16)
```

### 修复记录

**1. Hermes 导入错误修复**
- 问题：`setup.py` 导入 `apply_nous_provider_defaults`，实际函数名为 `apply_nous_managed_defaults`
- 修复：修改两处导入和调用
- 文件：`hermes_cli/setup.py` 第 23 行和第 839 行

**2. 编码问题修复**
- 问题：WSL 输出 UTF-8，Windows 默认 GBK 解码失败
- 修复：所有 WSL subprocess 调用移除 `text=True`，手动 UTF-8 解码
- 文件：`gateway_manager.py`

**3. 进程检测改进**
- 问题：`pgrep -f "hermes gateway"` 无法匹配 `hermes_cli.main gateway run`
- 修复：使用 `pgrep -a -f hermes` 并检查输出内容

### 当前状态

✅ **全部功能正常**
- WSL2 自动检测
- Gateway 状态检测
- Hermes 健康检查
- Gateway 启动/停止/重启（待 GUI 测试）

## 下一步

1. 运行 `run.bat` 测试 GUI
2. 运行 `build.bat` 打包 exe
3. 运行 `build-setup.bat` 生成安装程序
