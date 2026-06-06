# Hermes Tray v0.1.0 (2026-06-06)

首个公开版本. Tauri 2 桌面客户端, 通过 [hermes-agent-cn](https://github.com/xyshanren/hermes-agent-cn) gateway 跟本地 / 云端 LLM 对话.

## 亮点

- **Tauri 2 + TypeScript + Rust** — 单一安装包 (~12 MB), 启动快, 资源占用低
- **WSL2 gateway 自动连接** — 默认走 `127.0.0.1:8642` (Win11 localhostForwarding), 失败 fallback 到 WSL eth0 IP, 最后走 config override
- **系统代理 (Clash 等) bypass** — `reqwest` 显式 `.no_proxy()`, 不被中间人拦截返回 502
- **OpenAI Chat Completions 协议** — `hermes-agent-cn` 标准 `/v1/chat/completions` 端点, SSE 流式响应
- **流式 Markdown 渲染** — 代码高亮 (highlight.js), 表格, GFM
- **Tauri 官方插件架构** — `tauri-plugin-shell` 管 WSL 进程调用, `tauri-plugin-fs` 管 config 持久化, capabilities 同步
- **托盘极简** — 只剩"显示窗口 / 退出"两项, 不抢 systemd 服务的生命周期
- **77 自动化测试** — 49 Rust 单元 + 37 TS 单元, 含 SSE 解析、WSL IP 探测、配置合并、escapeHtml 等
- **21 集成测试** — `hermes-tray` ↔ `hermes-agent-cn` 端到端, 8 场景: smoke / chat 流+非流 / OpenAI SDK 兼容 / 4xx 错误 / 并发 stream / hermes-tray 兼容 / 多轮

## 变更详情

### 新增
- `tauri-plugin-shell` + `tauri-plugin-fs` 集成, `capabilities/default.json` 同步
- 4 处 `std::process::Command` → `tauri-plugin-shell::ShellExt::shell().command("wsl")...` (WSL 进程调用)
- 集成测试 harness (`tests/integration/`), 21 tests / 8 scenarios
- `pick_gateway_host` 优先级链: `config override → 127.0.0.1 (Win11 localhostForwarding) → WSL eth0 IP → 172.31.98.230 hardcoded`
- TCP 探测 `check_localhost_gateway` (500ms timeout) 判断 WSL2 localhostForwarding 是否启用
- `read_gateway_host_override` 支持用户在 `config.json` 里手动指定 gateway host (留作高级选项)
- 3 个新纯 helper 抽出来便于单测: `parse_first_ip_token` / `parse_wsl_distro_list` / `classify_gateway_status`

### 修复
- Gateway 连接 502 (Windows 系统代理 Clash 拦截 WSL eth0 IP) — 通过 `127.0.0.1` 优先 + reqwest `.no_proxy()` 解决
- tauri-plugin-opener 死引用清理 (Cargo.toml + capabilities + lib.rs)
- 6 个 Python 死代码文件清理 (`.pyc` 残留 + tray_app.py / gateway_manager.py 等)
- Settings dialog trim 不一致导致的潜在 dropdown 匹配失败 (待 v0.2.0 完整修复)

### 移除
- 托盘菜单 3 项: "启动 Gateway" / "停止 Gateway" / "重启 Gateway" (改为状态只读, 生命周期管理走 WSL 终端 + `hermes gateway` CLI)
- 3 个 IPC 函数: `hermes_start_gateway` / `hermes_stop_gateway` / `hermes_restart_gateway`
- tray 设置中跟 gateway 控制相关的 toast 通知逻辑

## 安装

从 [Releases 页面](https://github.com/xyshanren/hermes-tray/releases/tag/v0.1.0) 下载:
- `hermes-tray-tauri_0.1.0_x64-setup.exe` (NSIS, 2.8 MB, 推荐个人试用)
- `hermes-tray-tauri_0.1.0_x64_en-US.msi` (MSI, 4.1 MB, 企业 / GPO 部署)

或自行编译:
```bash
git clone https://github.com/xyshanren/hermes-tray.git
cd hermes-tray
git checkout v0.1.0
npm install
npm run tauri build
```

## 配置

在 exe 同目录创建 `config.json` (可选):
```json
{
  "wsl_distro": "Ubuntu-24.04.4",
  "port": 8642,
  "api_key": "<可选 Bearer token>"
}
```

默认: `wsl_distro=Ubuntu-24.04.4`, `port=8642`, `api_key=` (本地模式无 auth).

## 使用说明

1. 启动 hermes-agent-cn gateway: `hermes gateway start` (WSL 里, 见 hermes-agent-cn 文档)
2. 启动 hermes-tray, 状态显示"已连接"表示 Gateway 正常
3. 在聊天窗口输入消息, 与 Hermes AI 对话 (流式响应 + Markdown 渲染)
4. 点击右上角 ⚙️ 按钮可修改 WSL 发行版 / 端口 / API Key
5. 点击窗口关闭按钮, 最小化到系统托盘
6. 右键托盘图标: 显示窗口 / 退出

## 测试

```bash
# Rust 单元测试 (49 用例, 0.27s)
cd src-tauri && cargo test --lib

# TS 单元测试 (37 用例)
npm run test

# 集成测试 (21 用例, ~15s, 需要 hermes-agent-cn 跑在 127.0.0.1:8642)
pip install -r tests/integration/requirements.txt
cd tests/integration && pytest -v
```

## 已知限制

- **仅 Windows 平台** (WSL2 backend 假设)
- **配置存 exe 旁** `config.json` (跨 install / 重 build 可能丢; v0.2.0 计划迁到 `%APPDATA%`)
- **Settings dialog 的 WSL 发行版 dropdown** 在某些场景下不显示已保存值 (tracing 中, 修法候选: trim 匹配 / 改路径 / 强 toast)
- **Gateway 进程生命周期管理** 完全交给 systemd + `hermes gateway` CLI (tray 不参与)
- **`/health` 端点** 在 hermes-tray 状态栏显示"连接失败", 但实际 chat 走 `/v1/chat/completions` 是通的 (hermes-tray 状态逻辑与 /health 不同步, 待修)

## 路线图

v0.2.0 计划基于"个人会话工作台"定位 (详见 `.agent-teams/TASK_BOARD.md` 里的 v2 Product Roadmap):

| 阶段 | 周 | 里程碑 |
|------|-----|--------|
| v2.0 基础 | 1-4 | SQLite + 多会话 UI + 搜索 |
| v2.1 进阶 | 5-7 | 全局热键 + Persona + 项目上下文 |
| v2.2 高级 | 8-10 | Token 追踪 + 导出 + 多模型 |
| v2.3 打磨 | 11-12 | 语音 + 图片 + 插件系统 |

总计 15 个 T-Q-S* 任务, 4 阶段 12 周. 不赶工期.

## 致谢

- [Tauri](https://tauri.app) — 跨平台桌面应用框架
- [hermes-agent-cn](https://github.com/xyshanren/hermes-agent-cn) — 底层 agent + gateway
- 所有贡献者

---

License: MIT
