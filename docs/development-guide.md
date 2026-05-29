# Hermes Tray — 开发指南

## 环境要求

| 工具 | 版本要求 | 备注 |
|------|----------|------|
| Node.js | >= 18 | 前端构建 |
| Rust | >= 1.77 | Tauri 后端编译 |
| Tauri CLI | 2.x | `cargo install tauri-cli` |
| WSL2 | 可选 | 运行 Hermes Gateway 所需 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 开发运行（前端热更新 + 桌面窗口）
npm run tauri dev

# 3. 仅前端开发（浏览器预览，无需桌面窗口）
npm run dev
# 访问 http://localhost:1420
```

> 提示：`npm run tauri dev` 会自动启动 Vite 开发服务器和 Tauri 桌面窗口。

## 项目结构

```
hermes-tray/
├── src/                        # 前端代码
│   ├── main.ts                 # 入口 + 聊天逻辑 + 通知 + 设置
│   ├── styles.css              # 全局样式（亮色/暗色主题、Markdown、表格）
│   └── index.html              # HTML 入口（WebView + 设置 Modal）
│
├── src-tauri/                  # Rust 后端代码
│   ├── src/
│   │   ├── lib.rs              # 核心逻辑（托盘、IPC、代理）
│   │   └── main.rs             # Tauri 入口（lib.rs::run() 调用）
│   ├── Cargo.toml              # Rust 依赖清单
│   ├── tauri.conf.json         # Tauri 配置（窗口、权限、资源）
│   ├── capabilities/           # 权限声明
│   └── build.rs                # 构建脚本
│
├── docs/                       # 文档
│   ├── architecture.md         # 架构设计文档
│   ├── product-requirements.md # 产品需求文档
│   └── development-guide.md    # 本文件
│
├── package.json                # Node.js 依赖 + 构建脚本
├── vite.config.ts              # Vite 构建配置
└── tsconfig.json               # TypeScript 配置
```

## 常用命令

```bash
npm run dev           # 前端开发服务器（浏览器）
npm run build         # 前端生产构建
npm run tauri dev     # Tauri 桌面应用开发
npm run tauri build   # 生产构建（生成 exe 安装包）
```

## 开发工作流

### 1. 新增 Tauri IPC 命令

```rust
// Step 1: 在 lib.rs 中定义函数
#[tauri::command]
fn my_new_command(param: String) -> Result<String, String> {
    // 实现逻辑
    Ok("done".to_string())
}

// Step 2: 注册到 invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... 已有命令
    my_new_command,
])
```

### 2. 前端调用 Rust 命令

```typescript
import { invoke } from '@tauri-apps/api/core';

// 调用并处理结果
const result = await invoke<string>('my_new_command', {
    param: 'value',
});
```

### 3. 新增托盘菜单项

```rust
// 在 create_tray() 中给 menu 添加子菜单项
let restart_item = CustomMenuItem::new("restart_gateway", "重启 Gateway");

// 在 tray_event_handler 中处理点击事件
"restart_gateway" => {
    // 处理逻辑
}
```

### 4. 后端推送事件到前端

```rust
// Rust 端发送事件
let _ = app.emit("event-name", payload);

// TypeScript 端监听
import { listen } from '@tauri-apps/api/event';
await listen('event-name', (event) => {
    console.log(event.payload);
});
```

## 调试技巧

### Rust 后端日志

```rust
// 使用 eprintln! 输出到 stderr（Tauri 开发模式可见）
eprintln!("[hermes-tray] 调试信息: {:?}", value);
```

### 前端调试

- **Tauri 开发模式**：打开 WebView 开发者工具（右键 → Inspect）
- **浏览器预览**：`npm run dev` 后在浏览器直接调试
- **流式响应**：在 `handleStream()` 或 `hermes_proxy_post_stream` 中增加日志

### WSL 调试

```bash
# 在 WSL 中手动测试命令
wsl -d Ubuntu -e bash -c 'pgrep -f "hermes gateway"'

# 查看 Gateway 日志
wsl -d Ubuntu -e bash -c 'tail -f ~/.hermes/gateway.log'
```

## 构建与发布

### Windows 安装包

```bash
npm run tauri build
```

产物位置：
- 安装包：`src-tauri/target/release/bundle/msi/` 或 `nsis/`
- 绿色版 exe：`src-tauri/target/release/hermes-tray.exe`

### 版本号更新

```bash
# 在 tauri.conf.json 中更新 version 字段
# 在 Cargo.toml 中同步 version
```

## 编码规范

[![CI](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml/badge.svg)](https://github.com/xyshanren/hermes-tray/actions/workflows/ci.yml)

### TypeScript
- 使用 `const` / `let`，避免 `var`
- 函数命名：camelCase
- 类型定义：PascalCase
- 字符串使用单引号或模板字符串
- 所有用户/模型内容输出前调用 `escapeHtml()`

### Rust
- 函数命名：snake_case
- 类型定义：PascalCase
- 使用 `Result<T, String>` 作为 IPC 命令返回值
- 错误处理使用 `match` 而非 `unwrap()`
- `spawn()` 必须检查返回结果

### Git
- Commit 信息格式：`<Scope>: <简短描述>`
- PR 标题格式：`[S#] <描述>`

## 测试

当前项目以手动测试为主：

| 测试场景 | 操作 | 预期结果 |
|----------|------|----------|
| 托盘启动 | 运行 `npm run tauri dev` | 托盘图标出现，菜单可用 |
| Gateway 启动 | 右键 → 启动 Gateway | Toast 通知"Gateway 已启动" |
| Gateway 停止 | 右键 → 停止 Gateway | Toast 通知"Gateway 已停止" |
| Gateway 重启 | 右键 → 重启 Gateway | Toast 通知"正在重启" → "已启动" |
| 聊天 | 输入消息并发送 | 模型流式回复 |
| Markdown 渲染 | 发送含代码/表格的消息 | 代码块语法高亮 + 表格样式正常 |
| 设置页面 | 点击 ⚙️ 按钮 | Modal 弹出，可配置 WSL/端口/API Key |
| 窗口恢复 | 关闭后重新打开 | 窗口位置/大小不变 |
