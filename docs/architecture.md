# Hermes Tray — 架构设计文档

## 1. 系统架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Hermes Tray (桌面应用)                 │
│                                                         │
│  ┌─────────────────────┐     ┌──────────────────────┐   │
│  │   Tauri Frontend     │     │   Tauri Backend      │   │
│  │  (TypeScript/HTML)   │◄───►│   (Rust)             │   │
│  │                      │IPC  │                      │   │
│  │  • 聊天界面           │     │  • 托盘图标 & 菜单   │   │
│  │  • Toast 通知        │     │  • Gateway 进程管理   │   │
│  │  • 设置页面（Modal）  │     │  • HTTP 代理          │   │
│  └─────────────────────┘     └─────────┬────────────┘   │
                                         │
                                         │  WSL / Native
                                         ▼
                              ┌──────────────────────┐
                              │   Hermes Gateway     │
                              │  (Python 服务)       │
                              │  HTTP :11451         │
                              └──────────────────────┘
```

## 2. 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 桌面框架 | [Tauri 2.x](https://tauri.app) | 跨平台、小体积、Rust 安全后端 |
| 前端 | TypeScript + Vite + CSS | 轻量无框架依赖，HMR 开发体验好 |
| 后端 | Rust | 内存安全、高性能、Tauri 原生 |
| 流式通信 | Server-Sent Events (SSE) | Hermes API 原生支持，简单高效 |
| 进程管理 | `std::process::Command` | Rust 标准库，零依赖 |
| WSL 交互 | `wsl.exe -d <distro>` | WSL2 标准调用方式 |
| 配置存储 | `config.json` 文件 + `tauri-plugin-window-state` | API Key/端口/WSL 发行版持久化 + 窗口位置记忆 |

## 3. 模块设计

### 3.1 后端（Rust）— `src-tauri/src/lib.rs`

```
run()                          # 应用入口：初始化托盘、注册命令
├── TauriBuilder              # Tauri 应用构建器
│   ├── .plugin()             # Tauri 插件注册
│   ├── .invoke_handler()     # 注册 Tauri IPC 命令
│   └── .setup()              # 启动时创建托盘图标和菜单
│
├── Tray 管理                  # 系统托盘生命周期
│   ├── create_tray()         # 创建托盘图标 + 右键菜单
│   ├── update_tray_menu()    # 动态更新菜单（状态同步）
│   └── tray_event_handler()  # 菜单点击事件分发
│       ├── open_hermes       # 打开前端窗口
│       ├── start_gateway     # 启动 Gateway 进程
│       ├── stop_gateway      # 停止 Gateway 进程
│       ├── restart_gateway   # 重启 Gateway 进程
│       └── quit              # 退出应用
│
├── Tauri Commands (IPC)      # 前端调用的 Rust 函数
│   ├── 状态查询
│   │   ├── hermes_check_gateway_status()
│   │   ├── hermes_check_gateway_health()
│   │   ├── hermes_detect_wsl()
│   │   └── hermes_list_wsl_distros()
│   ├── Gateway 操作
│   │   ├── hermes_start_gateway()
│   │   ├── hermes_stop_gateway()
│   │   └── hermes_restart_gateway()
│   ├── 代理转发
│   │   ├── hermes_proxy_get()
│   │   ├── hermes_proxy_post()
│   │   └── hermes_proxy_post_stream()
│   ├── 配置
│   │   ├── hermes_save_config()
│   │   └── hermes_load_config()
│   └── 辅助
│       └── hermes_find_bin()
│
└── 工具函数
    ├── read_wsl_distro()     # 读取 / 检测 WSL 发行版
    ├── hermes_resolve_gateway_ip()  # 解析 Gateway 服务地址
    └── detect_wsl_ip()       # 获取 WSL 虚拟 IP
```

### 3.2 前端（TypeScript）— `src/main.ts`

```
应用初始化
├── mount()                   # DOM 就绪后启动
│   ├── createApp()           # 设置事件监听
│   └── startHealthCheck()   # 启动 30s 周期健康检查
│
├── 聊天核心
│   ├── sendMessage()         # 发送消息 → 调用 proxy_post_stream
│   ├── addMessage()          # 将消息添加到对话列表
│   └── handleStream()        # 处理 SSE 流式响应
│
├── 工具函数
│   ├── escapeHtml()          # HTML 转义（XSS 防护）
│   ├── showToast()           # Toast 通知展示
│   ├── updateSendButton()    # 发送按钮状态切换
│   ├── checkConnection()     # 健康检查执行
│   ├── autoResize()         # textarea 自动增高
│   └── openSettings()       # 设置 Modal 开关
│
└── 事件监听
    ├── gateway-notification  # 后端推送的通知事件
    └── 窗口生命周期事件
```

### 3.3 数据流

```
用户输入 → textarea → sendMessage()
  → invoke('hermes_proxy_post_stream')
  → Rust IPC → HTTP POST → Hermes Gateway (WSL)
  → SSE 响应流 → Rust IPC 转发
  → handleStream() 逐块渲染到 DOM
```

```
托盘菜单点击 → Rust tray_event_handler
  → Command::new("wsl") → Hermes Gateway 进程操作
  → app.emit("gateway-notification") → 前端 Toast
```

## 4. 数据结构

### Tauri IPC 命令参数/返回值

```rust
// Gateway 状态枚举
enum GatewayStatus { running, stopped, error }

// 健康检查响应
struct HermesResponse {
    ok: bool,           // API 返回状态
    message: String,    // 响应消息
    stdout: String,     // 标准输出 (非流式)
    stderr: String,     // 标准错误
}

// Gateway 进程信息
struct GatewayInfo {
    running: bool,      // 进程是否运行
    distro: String,     // 使用的 WSL 发行版
    wsl_ip: String,     // WSL 虚拟 IP
}
```

### 前端 TypeScript 接口

```typescript
interface ToastPayload {
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
}

interface GatewayInfo {
    running: boolean;
    distro: string;
    wsl_ip: string;
}
```

## 5. 安全设计

### 5.1 输入验证
- 所有 IPC 命令参数在前端使用 `escapeHtml()` 转义
- Rust 端对 `distro` 参数做合法性校验（只允许短横线 + 字母数字）

### 5.2 API Key 保护
- API Key 仅存储在本地（Tauri Store 或配置文件）
- 透传至 Hermes API 时通过 HTTP Header，不写日志

### 5.3 命令注入防护
- WSL 命令字符串使用参数数组而非 shell 拼接
- 禁止用户输入直接拼入 shell 命令

## 6. 部署架构

```
开发环境:
  ┌── Windows ──────────────────┐
  │  Hermes Tray (Tauri Dev)    │
  │  └─ vite HMR :1420          │
  └──────────┬──────────────────┘
             │ WSL
  ┌── WSL2 ──┴──────────────────┐
  │  Hermes Gateway :11451       │
  └─────────────────────────────┘

生产环境:
  ┌── Windows ──────────────────┐
  │  Hermes Tray (exe 安装包)    │
  │  └─ Tauri WebView 内嵌      │
  └──────────┬──────────────────┘
             │ WSL
  ┌── WSL2 ──┴──────────────────┐
  │  Hermes Gateway (系统服务)   │
  └─────────────────────────────┘
```
