# Hermes Tray — 架构设计文档

## 1. 系统架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Hermes Tray (桌面应用, Windows)        │
│                                                         │
│  ┌─────────────────────┐     ┌──────────────────────┐   │
│  │   Tauri Frontend     │     │   Tauri Backend      │   │
│  │  (TypeScript/HTML)   │◄───►│   (Rust)             │   │
│  │                      │IPC  │                      │   │
│  │  • 聊天界面           │     │  • 托盘图标 & 菜单   │   │
│  │  • Toast 通知        │     │  • HTTP 代理          │   │
│  │  • 设置页面（Modal）  │     │  • WSL 进程调用       │   │
│  └─────────────────────┘     └─────────┬────────────┘   │
│                                          │
│                                          │  HTTP + SSE
│                                          │  127.0.0.1:8642
│                                          │  (Win11 localhostForwarding)
│                                          ▼
│                               ┌──────────────────────┐
│                               │   hermes-agent-cn    │
│                               │   Gateway             │
│                               │  (Python 服务)       │
│                               │  systemd user service│
│                               │  HTTP :8642           │
│                               └──────────────────────┘
```

**关键架构决策 (v0.1.0)**:
- Hermes Tray 是 **多 client 之一** (其他还有 hermes-cli / Claude Code / OpenCode / 飞书 / 微信 等), 共享同一 hermes-agent-cn gateway
- Tray **不**管理 gateway 进程生命周期 (跟 systemd 抢控制权是反 UX, 见 v0.1.0 移除项)
- 模型选择 (本地 ollama / 云 deepseek / 其他) 完全由 hermes-agent-cn router 决定, 客户端不背锅

## 2. 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 桌面框架 | [Tauri 2.x](https://tauri.app) | 跨平台、小体积 (~12 MB)、Rust 安全后端 |
| 前端 | TypeScript + Vite + 原生 DOM | 轻量无框架依赖, HMR 开发体验好; 按需引入 Vue 3 + Element Plus (v0.2.0 计划) |
| 后端 | Rust 1.85+ | 内存安全、高性能、Tauri 原生 |
| Tauri 插件 | `tauri-plugin-shell` | WSL 进程调用, 走 capability 权限控制 |
| Tauri 插件 | `tauri-plugin-fs` | config.json 持久化 (未来路径) |
| Tauri 插件 | `tauri-plugin-window-state` | 窗口位置/大小自动记忆 |
| 流式通信 | Server-Sent Events (SSE) | hermes-agent-cn `/v1/chat/completions` 原生, OpenAI 兼容 |
| 进程调用 | `tauri-plugin-shell::ShellExt` (替代 `std::process::Command`) | 走 capability, 可审计可限制 |
| WSL 交互 | `wsl.exe -d <distro> bash -c "..."` | WSL2 标准调用方式, 透过插件 |
| 配置存储 | `config.json` 文件 (exe 旁) | 简单; v0.2.0 计划迁 `%APPDATA%` |
| HTTP 客户端 | `reqwest` 0.12 + SSE stream | 显式 `.no_proxy()` 绕过系统代理 |

## 3. 模块设计

### 3.1 后端（Rust）— `src-tauri/src/lib.rs`

```
run()                          # 应用入口: 初始化托盘、注册命令
├── TauriBuilder              # Tauri 应用构建器
│   ├── .plugin()             # Tauri 插件注册 (shell / fs / window-state)
│   ├── .invoke_handler()     # 注册 Tauri IPC 命令
│   └── .setup()              # 启动时创建托盘图标和菜单
│
├── Tray 管理                  # 系统托盘生命周期
│   ├── create_tray()         # 创建托盘图标 + 右键菜单 (简化: 只剩 显示窗口 / 退出)
│   └── tray_event_handler()  # 菜单点击事件分发
│       ├── show              # 打开前端窗口
│       └── quit              # 退出应用
│
├── Tauri Commands (IPC)      # 前端调用的 Rust 函数
│   ├── Gateway 状态查询 (只读, 不动进程)
│   │   ├── hermes_check_gateway_status()   # 查 gateway 进程是否在跑
│   │   ├── hermes_check_gateway_health()    # HTTP GET /health
│   │   ├── hermes_detect_wsl()              # 查 WSL 是否安装
│   │   ├── hermes_list_wsl_distros()        # 列 WSL 发行版
│   │   ├── hermes_find_bin()                # 找 hermes-cli 路径
│   │   └── hermes_resolve_gateway_ip()      # 解析 gateway URL (4 级优先级链)
│   ├── 代理转发 (调 hermes-agent-cn /v1/*)
│   │   ├── hermes_proxy_get()               # GET, 5s timeout
│   │   ├── hermes_proxy_post()              # POST non-stream, 30s timeout
│   │   └── hermes_proxy_post_stream()       # POST stream, 120s timeout
│   ├── 配置
│   │   ├── hermes_get_config()              # 读 config.json
│   │   └── hermes_save_config()             # 合并写入 config.json
│   └── 辅助
│       └── (其他 utils)
│
├── 工具函数
│   ├── read_wsl_distro()                  # 读 config.json["wsl_distro"], 默认 Ubuntu-24.04.4
│   ├── pick_gateway_host()                # ★ 核心: 4 级优先级链
│   │   ├── 1. read_gateway_host_override() # 读 config.json["gateway_host"]
│   │   ├── 2. check_localhost_gateway()    # TCP 探测 127.0.0.1:8642 (500ms)
│   │   ├── 3. detect_wsl_ip(distro)         # wsl hostname -I
│   │   └── 4. hardcoded "172.31.98.230"     # 兜底
│   └── detect_wsl_ip()                    # wsl -d <distro> bash -c "hostname -I"
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
// Gateway URL 解析结果
struct GatewayInfo {
    ip: String,         // 解析后的 host (e.g. "127.0.0.1", "172.31.98.230", "192.168.1.10")
    port: String,       // 端口 (e.g. "8642")
    url: String,        // 完整 URL (e.g. "http://127.0.0.1:8642")
    distro: String,     // 使用的 WSL 发行版
}

// HTTP 响应 (用于 proxy_* 和 health check)
struct HermesResponse {
    ok: bool,           // status < 400
    status: u16,        // HTTP 状态码
    body: String,       // 响应体 (流式场景分块)
}
```

### 前端 TypeScript 接口

```typescript
interface HermesResponse {
    ok: boolean;
    status: number;
    body: string;
}

interface GatewayInfo {
    ip: string;
    port: string;
    url: string;
}
```

### config.json 格式 (exe 旁)

```json
{
    "wsl_distro": "Ubuntu-24.04.4",
    "port": 8642,
    "api_key": "<可选>",
    "gateway_host": "<可选, 高级覆盖>"
}
```

## 5. 安全设计

### 5.1 输入验证
- 所有 IPC 命令参数在前端使用 `escapeHtml()` 转义
- Rust 端对 `distro` 参数做合法性校验 (只允许短横线 + 字母数字)

### 5.2 API Key 保护
- API Key 仅存储在本地 (config.json)
- 透传至 hermes-agent-cn 时通过 HTTP Authorization Header, 不写日志

### 5.3 命令注入防护
- WSL 命令字符串使用 `tauri-plugin-shell` 参数数组 (`Command::new("wsl").args([...])`) 而非 shell 拼接
- capabilities/default.json 里 `shell:allow-execute-program` 限定只允许 `wsl` 程序

### 5.4 网络层
- 全部 `reqwest::Client` 显式 `.no_proxy()` — 绕过 Windows 系统代理 (Clash 等), 防止私网 IP 被中间人拦截返 502

## 6. 部署架构

```
开发环境:
  ┌── Windows ──────────────────┐
  │  Hermes Tray (Tauri Dev)    │
  │  └─ vite HMR :1420          │
  └──────────┬──────────────────┘
             │ HTTP
             │ 127.0.0.1:8642 (Win11 localhostForwarding)
             ▼
  ┌── WSL2 ─────────────────────┐
  │  hermes-agent-cn Gateway    │
  │  systemd user service       │
  │  Python aiohttp :8642       │
  └─────────────────────────────┘

生产环境 (Windows 安装包):
  ┌── Windows ──────────────────┐
  │  Hermes Tray (NSIS/MSI)     │
  │  └─ Tauri WebView 内嵌      │
  └──────────┬──────────────────┘
             │ HTTP
             │ 127.0.0.1:8642
             ▼
  ┌── WSL2 ─────────────────────┐
  │  hermes-agent-cn Gateway    │
  │  systemd --user enabled     │
  │  survives logout (linger)   │
  └─────────────────────────────┘
```

## 7. 测试架构

### 7.1 单元测试 (cargo test + Vitest)

| 层级 | 工具 | 数量 | 覆盖 |
|------|------|------|------|
| Rust | `cargo test` (内置) | 49 | IO 纯函数 / 解析 / 配置合并 / Tauri 命令 mock |
| TS | Vitest + happy-dom | 37 | HTML 转义 / SSE 解析 / 消息格式化 / API 客户端 |

### 7.2 集成测试 (pytest, hermes-tray 端)

```
tests/integration/
├── conftest.py           # GATEWAY_URL fixture + skip_if_gateway_unavailable
├── pytest.ini            # testpaths = .
├── requirements.txt      # pytest + httpx + openai
├── README.md
├── test_smoke.py         # 4 tests: /health, /v1/models, /v1/capabilities
├── test_chat.py          # chat 非流 + 流 + OpenAI SDK
├── test_errors.py        # 4xx 错误路径
├── test_concurrent.py    # 3 个并行 stream
├── test_hermes_tray_compat.py  # lib.rs 签名 + invoke_handler 对照
└── test_multi_turn.py    # 4-6 轮多轮对话
```

跑法: `cd tests/integration && pytest -v` (需要 hermes-agent-cn 跑在 127.0.0.1:8642).

### 7.3 测试覆盖 (v0.1.0)

- **Rust**: 49 tests, 0 clippy warning, fmt clean
- **TS**: 37 tests
- **集成**: 21 tests / 8 场景, 全过
- **总计**: 107 自动化 tests

## 8. 已知架构债 (待 v0.2.0+)

- **config 路径**: 现在存 exe 旁, 跨 install / 重 build 容易丢. 计划迁到 `%APPDATA%/hermes-tray/config.json`
- **多会话**: 单聊, 切换会清空 messages. v0.2.0 引入 SQLite + sidebar
- **图片/语音**: 暂未支持, v0.2.0 + v0.3.0 计划
- **/health 显示** 与 `/v1/chat/completions` 实际状态不同步 (tray 状态栏显示连失败, 但 chat 实际能通). 修法: 状态判定应该跟实际 chat 走同步, 而非单纯依赖 /health
- **WSL 发行版 dropdown** 在某些场景下不显示已保存值. trim 匹配 / 改路径 / 强 toast 三选一, 计划 v0.2.0

## 9. v0.2.0 计划

详见 `.agent-teams/TASK_BOARD.md` 里的 v2 Product Roadmap. 15 个 T-Q-S* 任务, 4 阶段 12 周. 不赶工期.
