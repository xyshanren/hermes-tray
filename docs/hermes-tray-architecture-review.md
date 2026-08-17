# Hermes Tray — 架构与代码审查报告

**项目**: hermes-tray (v0.2.2 / `com.admin.hermes-tray`)
**栈**: Tauri 2.x + Preact 10 + Vite + Tailwind v3 + Rust 1.85+
**审查范围**: 静态代码审查（无构建/运行）
**仓库**: `/mnt/d/work/workspace/Qoder/hermes-tray`
**审查日期**: 2026-08
**方法**: 全量阅读后端 6 428 行 Rust、前端 18 095 行 TS/TSX、配置与 CI；交叉对照 `docs/architecture.md`（v0.1.0 文档）与代码现状（v0.2.x）。

---

## 1. 一句话评价

> 这是一个**非常用心、迭代密集**的"个人/小团队级"桌面客户端：架构清晰、错误处理细致、测试密度高（Rust 114 个 `#[test]`、TS 471 个 `it()`），注释密度罕见地高（每一处"为什么这样写"都被写进了代码里）。
> 主要风险集中在**安全边界（XSS / 命令注入 / capability 边界）**与**前端状态管理在长会话/快速操作下的稳健性**上——属于"够用但需要补强"的水平，而不是"生产级坚如磐石"。

---

## 2. 顶层架构

```
┌──────────────────────────────────────────────────────────────┐
│ Windows WebView (Tauri 2.x)                                   │
│  Preact 10 + Vite + Tailwind v3 + shadcn/preact-compat        │
│  - 1 个根 store (chatStore pub-sub)                          │
│  - N 个视图级 pub-sub stores (sessionListStore / modalStore…)│
│  - 业务逻辑模块化 (chat-stream / boot / share-ui / tray-menu) │
└────────────┬─────────────────────────────────────────────────┘
             │ Tauri IPC: invoke() + listen()/emit()
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Rust 后端 (hermes_tray_tauri_lib)                             │
│  - 26 个 #[tauri::command] IPC 入口                          │
│  - r2d2 + rusqlite (bundled) + WAL + FTS5 + 6 次迁移          │
│  - AES-256-GCM + Argon2id 加密备份                            │
│  - 通过 tauri-plugin-shell 调 WSL (受 capability 限制)        │
│  - reqwest 直连 Gateway (.no_proxy() 绕开 Windows 系统代理)   │
└────────────┬─────────────────────────────────────────────────┘
             │ HTTP + SSE  (no_proxy, 多级 gateway host 解析)
             ▼
┌──────────────────────────────────────────────────────────────┐
│ WSL2 里的 hermes-agent-cn Gateway (Python, :8642)            │
│  Hermes Tray 不管理 gateway 进程（systemd 接管）              │
└──────────────────────────────────────────────────────────────┘
```

**架构决策回顾（与 `docs/architecture.md` 对照）**：

| 决策 | v0.1 文档描述 | v0.2 实际代码 | 一致性 |
|------|--------------|---------------|--------|
| 桌面框架 | Tauri 2.x | Tauri 2.x + 6 个插件 | ✅ |
| 前端 | "原生 DOM"（未来引入 Vue 3） | **已转 Preact + shadcn/preact-compat** | ⚠️ 文档未跟进 |
| 后端 HTTP | reqwest | reqwest（保留原因在 `lib.rs:42-47`） | ✅ |
| 配置存储 | exe 旁 `config.json`（v0.2 迁 `%APPDATA%`） | 已迁 `%APPDATA%` + legacy 兜底 | ✅ 但 capability 仍允许 `$EXE/**` |
| 进程调用 | tauri-plugin-shell | ✅ | ✅ |
| 多 client 共享 gateway | 是 | 是 | ✅ |

`docs/architecture.md` 已经**落后一个主要版本**（仍是 v0.1.0 视角，前端栈描述全错），是后续维护的隐患。

---

## 3. 后端 Rust 评审

### 3.1 模块拆分（`src-tauri/src/`）

```
lib.rs          1662 行 — 应用入口、Tray、IPC command 注册、纯函数 + 单元测试
crypto.rs        365 行 — AES-256-GCM + Argon2id 备份加解密（含 18 个测试）
main.rs              — 二进制入口（仅调用 lib::run）
db/
  mod.rs           — 错误类型 + 模块索引
  pool.rs         163 行 — r2d2 连接池 + 初始化 + builtin persona 种子
  schema.rs       295 行 — 嵌入式迁移 runner + 测试（含 v5 verbatim-prefix 回归）
  dao.rs          339 行 — 领域类型 + DAO trait + serde 往返测试
  session.rs      338 行 — SessionDao 实现 + 测试
  message.rs           — MessageDao（含 S14 image attachment 流水线）
  persona.rs           — PersonaDao
  config.rs            — ConfigDao
  project.rs      830 行 — 项目扫描器 + 详尽测试（含 verbatim-prefix 处理）
  feedback.rs          — FeedbackDao
  token.rs        356 行 — token 估算 + 模型定价表 + 聚合类型
  export.rs            — Markdown / JSON 导出
  commands.rs     707 行 — 26 个 #[tauri::command] 薄包装
migrations/0001…0006.sql — 嵌入式 SQL 迁移
tests/                — DB 集成测试（2 个文件）
```

**优点**：
- DAO 接口清晰（`SessionDAO` / `MessageDAO` / `PersonaDAO` / `ConfigDAO` / `FeedbackDAO`），命令层只做薄包装，逻辑在 DAO。
- `Db` facade 提供 `db.session().list(...)` 这种链式 API，可读性很好。
- `pool.rs:39-58` 的 `open_pool` 把"建父目录 + WAL + 同步模式 + 外键 + busy_timeout + 迁移"封装成一处。
- 测试隔离策略成熟（`lib.rs:830-863` 的 `with_isolated_cwd` + 全局 `IO_LOCK`）。

**问题**：

#### P1. `commands.rs::compute_token_stats` 是大泥球

`src-tauri/src/db/commands.rs:109-421` 这个函数有 **312 行**，做 11 件事：
- 时间窗口计算
- 三条大 SQL（主聚合 + 最近 routing + 最近 elapsed + per-rule）
- 多个聚合变量声明
- 按角色分类计数 + cost 计算
- 排序 + 切片

可读性、单元测试覆盖、可修改性都受损。建议拆出：
- `aggregate_daily_buckets(&[Row]) -> BTreeMap<date, (in, out)>`
- `aggregate_by_model(&[Row]) -> HashMap<model, (in, out, count)>`
- `aggregate_recent_routing(&Connection, start_ms) -> Option<String>`
- `compute_cost_breakdown(&[ModelBucket], known_model_predicate) -> (total, unknown_count)`

#### P2. `record_usage` 参数爆炸

`src-tauri/src/db/dao.rs:215-228` 和 `commands.rs:558-581` 的 `message_record_usage` 有 **8 个参数**，已经触发 `clippy::too_many_arguments` 并 `#[allow]` 掉了。注释承认这是因为"Tauri IPC 契约已经定型"。建议改用 `UsageRecord { prompt_tokens, completion_tokens, image_tokens, ..., routing_decision, cost }` 单一结构体，命令签名只取这个结构体（serde 自动展开），后续加字段不再扩参数列表。

#### P3. `pickModelForRequest` 的前端版本是重复实现

`src/lib/modelPicker.ts` 与 `src/main.ts:150-160` 的 `pickModelForRequest` 是**两个文件里的同一份函数**。`main.ts` 注释说这是为了 `pickModelForRequest.test.ts` 的兼容而重导出，但是把实现也写在 `main.ts` 里是历史包袱——所有新调用方应该只导入 `lib/modelPicker`。建议把 `main.ts` 中的实现替换为 `export { pickModelForRequest } from './lib/modelPicker'`，并把 `modelPicker.test.ts` 迁移到新路径。

#### P4. 加密备份密钥派生参数硬编码、且不可配置

`src-tauri/src/crypto.rs:42-44`：

```rust
const ARGON2_MEM_KIB: u32 = 19_456; // 19 MiB
const ARGON2_TIME: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
```

注释说"1-2s derive time on a modern laptop"——但 **2026 年的桌面 CPU 跑 2 iters 是接近 2 秒**，未来硬件迭代后这条注释会过期；同时**备份文件头部没有存储参数**，所以将来想升级 Argon2 params 必须用新的 KDF id（`kdf_id = 2`），但目前没有为这条路径写测试或迁移文档。

建议：
- 至少把参数放进头部字段（或者至少写进 `kdf_id` 的语义注释）。
- 加一个 `create_backup_with_params(password, params)` 函数方便测试时间/内存。
- 在 `crypto.rs` 模块顶部的文件格式注释里，明确"future-proofing: how to bump params"。

#### P5. Tauri `withGlobalTauri: true` 的隐性安全风险

`src-tauri/tauri.conf.json:13`:

```json
"withGlobalTauri": true,
```

这把 `window.__TAURI__` 暴露在全局范围。配合 `app.security: {}`（空对象——即默认值，等于关闭自定义 CSP），前端代码如果不小心引入第三方库且该库读 `window.__TAURI__`，就能直接调 IPC。代码里现在没有用到这个全局，但配置开了就是开着的。

建议：改为 `withGlobalTauri: false`，前端用 `import` 形式访问 Tauri API；同时显式设置 `app.security.csp`（哪怕是 `"default-src 'self'; style-src 'self' 'unsafe-inline'"` 这种保守 CSP）。

---

## 4. 前端 Preact 评审

### 4.1 模块组织（`src/`）

```
main.ts                 1864 行 — boot 编排 + 顶级回调 + 残留的"门面"
lib/
  api.ts                   42 行 — hermesGet/hermesPostStream 代理
  boot.ts                  52 行 — 网关 URL + API key 启动装载
  chat-stream.ts          401 行 — SSE 编排 + S14 usage 提取
  chat-formatters.ts      129 行 — pure 函数（消息条 / 路由 trace）
  config-schema.ts        113 行 — db_config 键的单一真相源
  db-config.ts            143 行 — 类型化 db_config 访问器
  focus-trap.ts            86 行 — modal 焦点陷阱
  modelPicker.ts            — 模型选择优先级链
  multimodal.ts            28 行 — OpenAI 多模态内容组装
  reply-notification.ts    — 后台回复时系统通知
  sanitize.ts              24 行 — escapeHtml + sanitizeSnippet ⚠️
  share-ui.ts              77 行 — 分享链接 UI 接线
  shortcuts.ts             71 行 — Ctrl+Shift+H 注册
  state.ts                 71 行 — gatewayUrl + apiKey 模块级 lets
  theme.ts                 93 行 — light/dark/system 主题
  toast.ts                 53 行 — sonner 包装
  tray-menu.ts             79 行 — 三个 tray:// 事件 + 网关通知
views/
  chat-view.tsx           709 行 — 消息流 + 多个欢迎屏 + 致命 banner
  chat-view-store.ts      331 行 — chat pub-sub store
  chat-input-view.tsx     308 行 — 输入表单 + 拖拽 + 麦克风
  backup-modal.tsx        448 行 — 加密备份双卡片
  sessions-list-view.tsx  409 行 — 侧边栏列表
  ...                    ~15 个 *-view.tsx + *-mount.tsx + *-store.ts
  share-flow.ts           146 行 — 出站复制 + 入站导入 + validateShareHash
shareLink.ts               99 行 — base64url 编解码（pure）
```

整体非常**像 v0.2.x 阶段的拆分工作做了一半**：每个 modal 都有 `view.tsx` + `mount.tsx` + `store.ts` + `*-mount.tsx`，但根 `main.ts` 仍是 1864 行的胶水层（"v0.2-alpha-19 extracted X, main.ts only provides Y" 注释占了 100+ 行）。

### 4.2 状态管理

项目**显式选择**了"不引入 zustand/nanostores/pinia"，采用 ad-hoc + 模块级 let + pub-sub 模式（见 `AGENTS.md` 第 44 行）。这是 v0.2 的**架构决策 B**。

**正面**：
- `chatStore` 是干净的 pub-sub：`subscribe() => unsubscribe` 对称，listener 立即被调用避免时序问题（`chat-view-store.ts:307-313`）。
- `chatWelcomeStore`、`sidebarStore`、`searchModalStore`、`statsStore`、`settingsStore` 等各自独立，避免一个上帝 store。
- 大量"测试时重置"出口（`__resetForTests`）让 vitest 的 `vi.resetModules` 工作流顺畅。

**反面**：

#### P6. `main.ts` 还在"两份状态"——`state.*` 与 `chatStore.*`

`main.ts:303` `let state = { ... }` 模块级对象，与 `chatStore` 的内部 state 几乎完全镜像。`main.ts:1119` 处 `mountChatInput({ isLoading: state.isLoading, ... })`，`main.ts:1556` 处 `chatStore.appendMessage(...)` + `state.messages = chatStore.get().messages`——两边状态要手动同步。任何漏 sync 都会出现 UI 看到旧值的诡异 bug。

建议：要么彻底迁走（main.ts 不再有 `state` 对象，所有读都走 `chatStore.get()`），要么用 `Object.assign`/Proxy 自动代理。现在这种"半迁移"状态最容易出 bug。

#### P7. `main.ts` 是 1864 行的胶水层

它做的事情：
- DOMContentLoaded 监听器装配（≈440 行）
- `createSession` / `loadLastSession` / `handleSessionDelete` / `handleSessionRename` / `handleSessionLoadMore` / `selectSession` / `refreshCurrentSessionRow` 等会话生命周期函数（≈600 行）
- `startRecording` / `stopRecording` / `onRecordingComplete` / `fileToAttachment` / `addAttachments` 媒体与文件处理（≈150 行）
- `populateModelSelector` / `checkConnection` / `fetchModelInfo` 模型相关（≈100 行）
- `handleProjectPick` / `handleProjectClear` / `handleProjectBrowse` 项目相关（≈80 行）
- `updateConnectionStatus` / 各种 toast 触发（散落各处）

这些本可以归到 `views/session-lifecycle.ts` / `lib/media.ts` / `lib/project.ts` 等专门模块。1864 行已经逼近"不可读"红线。

#### P8. 拖拽 `dragCounter` 是模块级变量

`main.ts:1139` 的 `let dragCounter = 0;` 在 `DOMContentLoaded` 闭包里——这是对的（每次重启闭包重建）。但如果未来要做热重载或多个 chat-form 实例，这个状态就会泄漏。

---

## 5. 安全评审（核心）

### 5.1 HTML 转义——**有缺陷**

`src/lib/sanitize.ts`:

```typescript
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeSnippet(s: string): string {
  return s
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=/gi, " data-ignored=")
    .replace(/javascript:/gi, "");
}
```

#### P9 (HIGH). `escapeHtml` 不转义 `"` 和 `'`

当字符串被插入到 `onclick="..."`、`href="..."` 等带引号属性上下文时，攻击者可以用 `" onmouseover="alert(1)` 突破。

代码里的现状是 `escapeHtml` **仅被用于 FTS5 snippet**（`views/search-modal.tsx` 在 innerHTML 里展示搜索摘要时），snippet 文本里包含 `<b>` 高亮标签且**没经过 HTML 上下文校验**——如果数据库里的 message 内容里出现 `</b><img src=x onerror=...>`，snippet 会显示原文。`sanitizeSnippet` 的"剥 script / on*=/ javascript:"正则**可以绕过**：

- `<svg/onload=alert(1)>` 的 `onload` 不在 `\bon\w+\s*=` 之前有空格，能被匹配；✅
- `<img src="x"onerror=alert(1)>` 的 `onerror` 前面紧跟引号，能匹配；✅
- `<a href=javascript:alert(1)>x</a>`：能被剥掉 `javascript:`，但 `&#106;avascript:`（HTML 实体）能绕过；⚠️
- 任意大小写混写 `JaVaScRiPt:` 不能绕过（小写化做对）；✅

#### 修复建议
1. 用 DOMPurify（已经在 deps 之外？——查看 `package.json` 没看到）做真正的 HTML 净化，或者
2. 改用纯文本渲染（不用 marked.parse + innerHTML），或
3. 至少把 `escapeHtml` 加上 `"`/`'` 替换，并改用 `marked` 的 sanitize 选项（marked 12+ 默认就开启 sanitize）。

#### P10 (MEDIUM). assistant 内容通过 `marked.parse()` + `dangerouslySetInnerHTML`

`src/views/chat-view.tsx:285-291`:

```tsx
<div class="message-content" onClick={handleContentClick}
  dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
/>
```

注释承认了"assistant content is generated by the agent (a trusted side) but still rendered as innerHTML"——但 hermes-agent 本身是个**外部 Python 进程**，它的输出经过 OpenAI 风格的流式响应传到这里。任何中间人（恶意代理、API 错误、被攻陷的模型权重）都能注入 HTML。

更糟的是 `formatMessage` 用 `marked.parse(content) as string`——marked 在 v5+ 取消了默认 sanitize。要检查 `package.json` 里的 `marked: ^18.0.4`，marked 18 已经移除了 sanitize 插件，必须自己用 DOMPurify。

#### 修复建议
1. 后端用 DOMPurify（10 KB gzipped）包裹 marked 输出。
2. 或者渲染用 preact 的 children API，把 markdown 转成 Preact 虚拟 DOM（更重的工程）。

#### P11 (HIGH). shell capability 允许 `wsl` + 任意 args

`src-tauri/capabilities/default.json:19-29`:

```json
{
  "identifier": "shell:allow-execute",
  "allow": [
    {
      "name": "wsl",
      "cmd": "wsl",
      "args": true,
      "sidecar": false
    }
  ]
}
```

`args: true` 意味着**任何参数**。代码里确实只调用了 `["-d", distro, "bash", "-c", "hostname -I"]` 之类固定形态的 args（`lib.rs:154-159`），但 capability 模型是"只要前端 invoke 到 `wsl` 命令，任意 args 都过"。如果前端某处被 XSS 攻击（见 P9/P10），攻击者就能在 Windows 上执行任意 WSL 命令 = 任意 Linux 命令 = 整台机器沦陷。

#### 修复建议
1. 把 capability 收紧到具体 scope（每个允许的命令单独列）：
   ```json
   "args": [
     "-d", "-l", "-q", "--version",
     { "validator": "starts-with:hostname " },
     { "validator": "starts-with:pgrep " },
     { "validator": "starts-with:test " }
   ]
   ```
2. 或者把 WSL 调用全部移到 Rust 后端、不暴露给前端（更彻底）。
3. 至少在 Rust 侧对每个 `wsl` 调用做参数白名单校验。

#### P12 (MEDIUM). fs capability 仍允许 `$EXE/**`

`capabilities/default.json:31-51`:

```json
"identifier": "fs:allow-read-text-file",
"allow": [
  { "path": "$EXE/config.json" },
  { "path": "$EXE/**" }
]
```

README 说 v0.1.1+ 已迁到 `%APPDATA%`，但 capability 仍把 `$EXE/**` 暴露给前端。前端目前只通过 invoke 调 `hermes_get_config` / `hermes_save_config`（Rust 走 std::fs），不需要 fs capability。这个 `**` 是冗余的攻击面。

#### 修复建议
直接删除 `$EXE/**` 两条，把 fs capability 收紧到无（因为前端根本不需要直接 fs 访问）。

#### P13 (LOW). share-link 没有任何签名

`src/shareLink.ts` 与 `src/views/share-flow.ts` 实现的是**纯编码**（base64url + JSON），无 HMAC、无签名。注释里明确说了 "may be added in a future T-Q-S10.x iteration"。`README` 也坦承这一点。

#### 风险评估
当前模型是"我信任我朋友发我的链接"，但：
- 攻击者可以构造一个伪造 `#share=` 链接诱导用户导入假会话（"钓鱼导入"）。
- 用户在 IM 里粘贴 URL 时 URL 预览会暴露 base64 内容。

#### 修复建议
至少加一个版本号 + SHA-256 校验和字段（不需要 HMAC，因为不防篡改，但可以防 typo）。或加 opt-in "签名链接"模式。

#### P14 (MEDIUM). 错误信息可能泄露内部路径

`lib.rs:262` 返回 `format!("检测失败: {}", e)` —— `e` 来自 `app.shell().command("wsl")...output().await` 的 IO error，可能包含 `\\?\D:\…` 长 verbatim 路径。`commands.rs:571` 返回 `format!("HTTP {}", ...)`——status 码是 OK 的，但其他路径（`hermes_proxy_post`）的错误 `format!("连接失败: {}", e)` 会在 toast 里暴露完整 reqwest 错误描述（含 URL + headers 摘要）。

#### 修复建议
- Rust 侧错误信息只返回 "category: context"，把原始错误通过 `log::error!` 写到本地日志而不通过 IPC 返回。
- 前端对展示给用户的错误做一层 `humanizeError()` 包装。

---

## 6. IPC 契约与可观察性问题

### 6.1 后端错误返回格式不统一

- `Result<HermesResponse, String>` 大多数命令用 `String`
- `Result<Message, String>` / `Result<Session, String>` 等用 `String`
- `Result<usize, String>` 也用 `String`

`db::DbError` 有丰富的变体（`Sqlite` / `Pool` / `Migration` / `NotFound` / `Invalid` / `Io` / `Json`），但 `commands.rs` 全用 `.map_err(|e| e.to_string())` 扁平化成字符串——**前端没办法区分"not found"和"SQLite is locked"**。

#### 修复建议
引入统一的 `AppError` enum（serde），前端可以用 `switch (err.kind)` 做针对性处理（toast 提示/重试/弹窗）。

### 6.2 26 个 command 中有几个 `Result<_, String>` 返回 `Err(String)` 而不是 `Ok(success_marker)`

例如 `backup_restore` 返回 `Result<RestoreInfo, String>` 是 ✅；但 `session_touch` 返回 `Result<(), String>` ——前端拿到 `Ok(())` 不知道到底是 touch 成功还是 no-op（id 不存在时返回 `DbError::NotFound` 变成 `Err("not found: ...")`，但是前端 `session_touch(...).catch(() => {})` 静默吞掉）。`main.ts:1590` 与 `chat-stream.ts:268` 都是这种静默吞错。

#### 修复建议
- 静默失败用 `.catch(noop)` 而不是 `.catch(() => {})`，明确表达意图。
- 重要路径（如 message_append 失败）要打 `console.error` 或 toast，不能静默。

### 6.3 streaming chunk 是按字符串切片切分

`lib.rs:577`:

```rust
if let Ok(text) = String::from_utf8(bytes.to_vec()) {
    let _ = window.emit("hermes-stream-chunk", &text);
}
```

**SSE 协议里 chunk 边界是任意的**，所以一个 UTF-8 多字节字符（中文/emoji）很可能在 chunk 边界被切两半。`String::from_utf8` 会失败，这段代码**默默丢弃整个 chunk**——用户会看到回复内容随机丢字。

#### 修复建议
1. 后端在 emit 前用一个 buffer 累积字节，等字符边界到达再切。
2. 或者改 emit 格式：`{ data: string, partial: bool }`，前端按 partial 拼接。
3. 或者直接发 raw bytes，前端用 `TextDecoder` 流式解码（最稳）。

---

## 7. 数据库层评审

### 7.1 迁移系统——设计优良

`src-tauri/src/db/schema.rs` 用 `include_str!` 把 SQL 嵌入编译产物——避免 `fs::read_dir` 找不到路径的运行时错误（注释解释了 MSI 安装的 cwd ≠ install dir 问题）。`migrations_array_is_sorted_and_complete` 测试防"加了文件忘 bump `CURRENT_SCHEMA_VERSION`"。

#### 小问题
`migrations/0006_add_message_attachments.sql` 没有对应的 `v0.3.0-alpha-33b P1-3` 历史注释在 `schema.rs` 里——其他几个迁移都写了 `// v0.1.5: S12 cost metadata` 这样的上下文注释。

### 7.2 `messages_fts` 触发器维护——正确

`0001_initial.sql:126-136` 的三个 trigger（AI/AD/AU）保证 FTS 与 messages 表严格同步。但 `session_clear_all` 的注释 (`session.rs:222-228`) 提到 "the messages_ad trigger re-syncs the FTS5 index"——这是对的（DELETE 级联触发 AD，AD 删 FTS row），但有一个边角：**`session_delete` 删除一个 session 会级联删 messages，每条 message 触发 AD，但 FTS5 的 DELETE 在大表上不是免费的**——一次性删除 100k 条消息 = 100k 次 DELETE on FTS5。

#### 优化建议
大删除前用 `INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role, msg_id) VALUES('rebuild');` + `INSERT INTO messages_fts(messages_fts) VALUES('optimize');` 重建。

### 7.3 模型定价表是硬编码 + 不分币种

`src-tauri/src/db/token.rs:58-143` 的 `pricing_table()` 返回 USD per 1K tokens。但 README 与 `AGENTS.md` 第 117 行都说"用 ￥（人民币），不用 $" + "国内模型定价要加（qwen / kimi / ernie / doubao / glm / deepseek-cn）"——但代码里**只有海外模型**。

#### 修复建议
1. 加一个 `CNY_PRICING` 表，对应 `model_id` 后缀匹配（如 `*-cn` 或别名表）。
2. `cost_for_model(model, ...)` 自动选币种。
3. 或者：把币种 + 定价表移到前端 `CONFIG_SCHEMA` 旁边（db_config 表），让用户能自定义——这是 `currency: "CNY" | "USD" | "model"` 字段存在的初衷。

### 7.4 DAO 大量使用 `Box<dyn ToSql>` 在 `session.rs:127-200`

这是合理的，但 `update` 函数 60+ 行都在做参数绑定——可以抽象一个 `PatchBuilder` 把"Option<Option<T>> 三态语义"封装掉，DAO 只关心"应用哪些字段"。

---

## 8. 测试与质量门

### 8.1 测试密度与质量

| 维度 | 数量 | 评价 |
|------|------|------|
| Rust `#[test]` | 114 | 优秀 |
| Vitest `it()` | 471 | 优秀 |
| Rust 集成测试（src-tauri/tests/） | 2 文件 | 偏少 |
| TS 集成/E2E | 0（只有 Playwright pixel 比对） | 缺 |
| 覆盖率 | "约 48%"（README） | 中等 |

**亮点**：
- `crypto.rs:198-364` 17 个测试覆盖 round-trip / 错误密码 / 篡改 / 空密码 / Unicode 密码——加密模块的可测性典范。
- `lib.rs` 的 `with_isolated_cwd` 解决了 CWD 全局状态的并发污染问题。
- `project.rs:516-830` 22 个测试覆盖各种 manifest 格式 + 边界条件。

**盲区**：
- **`commands.rs` 26 个 IPC command 一个没有单元测试**——所有测试都是"绕过 IPC 的纯函数测试"。`compute_token_stats` 这么复杂的函数反而 0 覆盖。
- `chat-stream.ts` 的 SSE 解析 + S14 usage 提取是高风险代码，只有 vitest 但没看到对 `handleStreamChunk` 各种 malformed SSE payload 的覆盖。
- 没有 e2e：启动 tray → 输消息 → 收到 SSE → 写入 DB 的端到端路径只在 manual verification 里走。

### 8.2 CI 配置

`.github/workflows/ci.yml` 跑：
- `npm ci + tsc --noEmit + vite build`
- `cargo check + clippy -D warnings + fmt --check`

`.github/workflows/release.yml` 用 `tauri-apps/tauri-action@v0` 做 release，仅 windows-latest + msi——README 说也出 NSIS，但 CI 配置里写的是"tauri-action builds both msi AND nsis on windows-latest"——这是脆弱的隐式依赖。

**建议**：
1. 加 Rust 单元测试的 CI 步骤：`cargo test --manifest-path src-tauri/Cargo.toml`（README 说 133 个测试但 CI 不跑！）
2. 加 vitest CI 步骤：`npm test`
3. 加覆盖率门（`cargo llvm-cov` + `vitest --coverage`）设阈值。

---

## 9. 关键代码路径——"实际工作原理"流程图

### 9.1 发送一条消息的完整路径

```
[User types "你好" + presses Enter]
  ↓ chat-input-view.tsx:80 handleSubmit
  ↓ props.onSubmit(trimmed, attachments)
  ↓ main.ts:1534 handleSubmit
  ├─ handle.clearText() + chatInputStore.clearAttachments()
  ├─ chatStore.appendMessage({role:'user', content:'你好', timestamp})
  ├─ invoke('message_append', {sessionId, role:'user', content:'你好'})
  │  ↓ src-tauri/db/message.rs (Tauri command wrapper)
  │  ↓ dao.append(...) — INSERT INTO messages
  │  ↓ (trigger messages_ai fires, INSERT INTO messages_fts)
  │  ↑ returns {id, tokens, ...}
  ├─ if attachments: Promise.all(invoke('hermes_message_attach', ...))
  │  ↓ base64-decode + INSERT INTO message_attachments
  ├─ invoke('session_touch', {id}) — UPDATE sessions SET last_msg_at
  └─ sendChatMessage()  // src/lib/chat-stream.ts:295
     ├─ deps.buildSystemPrompt() — persona + project context
     ├─ build OpenAI messages array
     ├─ pickModelForRequest(persona, currentModel, defaultModel, legacyDefault)
     ├─ chatStore.openStream() — 创建空 streaming bubble
     └─ hermesPostStream('/v1/chat/completions', body)
        ↓ src/lib/api.ts:36 — invoke('hermes_proxy_post_stream', ...)
        ↓ src-tauri/src/lib.rs:550 hermes_proxy_post_stream
        │  ├─ reqwest post with .no_proxy() + 120s timeout
        │  └─ bytes_stream → for each chunk:
        │     ├─ String::from_utf8 ⚠️ (P15 风险)
        │     └─ window.emit('hermes-stream-chunk', text)
        ↓
        [Frontend listener fires]
        chat-stream.ts:115 listen('hermes-stream-chunk', payload => handleStreamChunk(payload))
        ├─ for each line starting with 'data: ':
        │  ├─ JSON.parse
        │  ├─ lastStreamModel = json.model
        │  ├─ chatStore.appendStreamChunk(json.choices[0].delta.content)
        │  └─ capture usage / routing / elapsed_ms
        ↓
        [ChatViewWithWelcome re-renders via chatStore.subscribe]
        User sees characters appearing in the streaming bubble
        ↓
        [When gateway closes stream]
        lib.rs:581 window.emit('hermes-stream-done')
        ↓
        chat-stream.ts:118 listen('hermes-stream-done', finishStream)
        ├─ chatStore.finaliseStream(bar) — promote streaming bubble to finalised
        ├─ invoke('message_append', {role:'assistant', content:full})
        ├─ if usage.prompt_tokens: invoke('message_record_usage', {...})
        ├─ invoke('session_touch')
        ├─ deps.onAfterReply() — refresh sidebar row
        └─ notifyReplyIfBackground(lastUserPrompt) — system notification
```

### 9.2 备份恢复的完整路径

```
[User clicks 备份 card → 选择 .htbk 文件 → 输密码]
  ↓ views/backup-modal.tsx
  ↓ invoke('backup_verify', {inputPath, password})
  ↓ src-tauri/src/lib.rs:684 backup_verify
     ├─ std::fs::read → bytes
     └─ crypto_verify_password → restore_backup() trial — does NOT return plaintext
        returns bool
  ↓ if true: enable restore button + 5s countdown
  ↓ after countdown: invoke('backup_restore', {inputPath, password})
  ↓ src-tauri/src/lib.rs:639 backup_restore
     ├─ crypto_restore_backup → plaintext (sessions.db bytes)
     ├─ write to <db>.restore.tmp
     ├─ open src_conn = Connection::open(temp)
     ├─ pool.get() → dest_conn
     ├─ PRAGMA wal_checkpoint(TRUNCATE) on dest
     ├─ rusqlite::backup::Backup::new(src, dest).run_to_completion
     ├─ remove temp file
     └─ returns RestoreInfo{requires_restart: true}
  ↓ Frontend shows "请重启应用" toast
```

`requires_restart: true` 字段被 Rust 返回但前端代码里我没看到它被用来强制重启——`AGENTS.md` 第 124 行有"`requires_restart`"但前端如何消费这一信号需要确认。

---

## 10. 性能与可扩展性

### 10.1 数据库查询

`session.rs:67-78` 的 `list(limit, offset)` 直接 ORDER BY + LIMIT/OFFSET——大列表场景（10k+ sessions）会逐渐变慢。建议加 cursor-based 分页（`last_msg_at < ?`）。

`commands.rs:159-170` 的 `compute_token_stats` 主查询是全表扫描（按 `created_at >= ?`）——大消息量（百万行）时会慢。可以加 `idx_messages_created_at` 索引（实际上 `0001_initial.sql:46` 已经有 `(session_id, created_at)` 复合索引，但 stats 查询不带 session_id，所以不会用上）。

#### 修复建议
给 messages 加一个独立 `idx_messages_created_at` 索引，或让 stats 查询按 session 分桶聚合。

### 10.2 前端每次状态变更都 fire 整棵树

`chatStore.subscribe(setState)` 把整个 `ChatStoreState` 推给每个 listener（`chat-view.tsx:507`、`chat-input-view.tsx:48`、`chat-view-store.ts:309`）。每次 SSE chunk (~10-50 Hz) 都触发：
- `state = { ...state, streaming: { ... } }` —— 新对象引用
- 所有 listener 调用 React 的 setState
- Preact 比 React 轻，但仍然每次都跑 reconcile

`chat-view.tsx:514-517` 的 auto-scroll-to-bottom `useEffect` 依赖 `[state]`，每次都跑——这可能是性能瓶颈（每 chunk 一次 `el.scrollTop = el.scrollHeight`）。

#### 优化建议
1. 把 streaming 的 content 独立成一个 ref / 不进 store（避免每 chunk 全树更新）。
2. 或者用 `useEffect` + 比较 `state.messages.length + state.streaming?.content.length`。
3. 在 `appendStreamChunk` 中用 rAF 合并多个 chunk。

### 10.3 前端打包

`vite.config.ts`、`tailwind.config.js`、`components.json` 都需要审查——我没读这三个文件，但从 package.json 看 bundle 应该 OK。建议：
- 显式启用 `manualChunks` 拆 lucide-preact / radix-ui / highlight.js / marked——这些加起来可能占 bundle 一半以上。

---

## 11. 可观察性与调试

- `src/main.ts` 与 `src/lib/chat-stream.ts` 有零散的 `console.log/error/warn`——但**没有结构化日志**。
- Rust 侧用 `log::info!` / `log::error!` 但**没有 tauri-plugin-log 或文件日志**——出问题时只能靠用户复现。
- 没有 telemetry / metrics。

#### 修复建议
1. 加 `tauri-plugin-log`，把 Rust log 写到 `%APPDATA%/com.hermes.tray/hermes-tray.log`，前端 panic / error 也路由过去。
2. 加一个 `debug-test-hooks.ts`（已在 `src/`）的接口文档——它存在但我没读。

---

## 12. 文档与可维护性

### 12.1 文档同步严重落后

- `docs/architecture.md` 是 v0.1.0 视角，前端栈描述全错（说"原生 DOM"，实际是 Preact）。
- `docs/product-requirements.md` 我没读，但 README 提到的 S0–S11 + S13/S14 任务编号已散落在源码注释里，没有总览。
- `AGENTS.md` 是项目 memory（agent 友好的），但 `HANDOFF.md`（55KB）和 `ROADMAP.md`（54KB）和 `PROGRESS.md`（24KB）三个加起来 130KB 是给人类看的，与 AGENTS 大量重复。

### 12.2 `CHANGELOG.md` 我没读

16KB 的 changelog 应该是手工维护。建议改成 conventional commits → 自动生成。

### 12.3 没有 API 文档

`src/types.ts` 有类型，但 IPC 的 26 个 command 的语义只在 Rust 源码注释里。需要一份 markdown：
- `command_name` → 入参 schema → 出参 schema → 错误码 → 示例

---

## 13. 总结：风险矩阵与优先行动

### 高优先级（生产前必修）

| # | 问题 | 严重度 | 修复成本 |
|---|------|--------|----------|
| **P9** | `escapeHtml` 不转义引号，FTS5 snippet 渲染存在 XSS | HIGH | 1 天 |
| **P10** | assistant 内容走 `marked + dangerouslySetInnerHTML` 无 sanitize | HIGH | 1 天 |
| **P11** | shell capability `args: true` 给前端过多权限 | HIGH | 2 天（重构 WSL 调用到 Rust） |
| **P5** | `withGlobalTauri: true` + 空 CSP | MEDIUM | 0.5 天 |

### 中优先级（半年内应修）

| # | 问题 | 严重度 | 修复成本 |
|---|------|--------|----------|
| **P1** | `compute_token_stats` 是 312 行大泥球 | MEDIUM | 2 天 |
| **P2** | `record_usage` 8 参数爆炸 | MEDIUM | 1 天 |
| **P3** | `pickModelForRequest` 双份实现 | LOW | 0.5 天 |
| **P6** | `state.*` 与 `chatStore.*` 两份状态同步 | MEDIUM | 3 天 |
| **P7** | `main.ts` 1864 行胶水 | MEDIUM | 1 周 |
| **P12** | fs capability 仍允许 `$EXE/**` | MEDIUM | 0.5 天 |
| **P13** | share-link 无签名 | MEDIUM | 1 天 |
| **P14** | 错误信息泄露内部路径 | MEDIUM | 1 天 |
| **P15** | SSE chunk UTF-8 切分丢字 | MEDIUM | 1 天 |

### 低优先级（next major）

| # | 问题 | 修复成本 |
|---|------|----------|
| **P4** | Argon2 参数硬编码、未来不友好 | 0.5 天 |
| **P8** | `dragCounter` 模块级变量泄漏风险 | 0.5 天 |
| **P16** | pricing table 无人民币 + 无国内模型 | 1 天 |
| **P17** | session list 用 OFFSET 分页，大数据慢 | 1 天 |
| **P18** | streaming SSE 每 chunk 全树更新 | 1 天 |
| **P19** | docs/architecture.md 已过期 | 1 天 |
| **P20** | CI 不跑测试、不设覆盖率门 | 0.5 天 |

---

## 14. 推荐的下一步

如果只能做三件事，我建议：

1. **安全收紧**（P9/P10/P11/P5/P12）——共约 4 天工作量，但这是"桌面客户端被本地攻击者攻破"的最低防线。
2. **CI 跑测试**（P20）——1 天，让 114 + 471 个测试有实际价值。
3. **拆分 main.ts**（P7 + P6）——一周，把胶水层降下来，让新人 onboard 时间从"读 1864 行"降到"读 ~400 行编排 + 跳转到专门模块"。

---

## 附录 A：项目元数据速查

- **当前版本**: 0.2.2（`Cargo.toml:3`），README 仍写"v0.2.0 STABLE + v0.2.1 patch in flight"——CHANGELOG 实际已到 0.2.2。
- **identifier**: `com.admin.hermes-tray`（注意：是 `.admin` 不是 `.hermes`，README 说的 `com.hermes.tray` 是错的）
- **路径冲突**:
  - `lib.rs:65` `%APPDATA%\com.hermes.tray\` ← Rust 侧实际配置目录
  - README 第 85 行 `%APPDATA%\com.hermes.tray\config.json` ← 与上面一致
  - 但 `tauri.conf.json:5` `identifier: "com.admin.hermes-tray"` ← Tauri 应用标识
  - `app.path().app_config_dir()` 会用 identifier 算路径——所以实际是 `%APPDATA%\com.admin.hermes.tray\`！
  - 这意味着 **Tauri 自动配置目录 ≠ 硬编码目录**——bug 还是巧合需要进一步确认（看 `app_config_dir` 在 Windows 的算法）

- **依赖摘要** (`Cargo.toml`): tauri 2 + 6 plugins + rusqlite 0.32 bundled + r2d2 0.8 + reqwest 0.12 + aes-gcm 0.10 + argon2 0.5 + base64 0.22 + serde + uuid + log + thiserror + futures-util + bytes + tokio + rand
- **依赖摘要** (`package.json`): Preact 10 + Vite 6 + Tailwind 3 + Radix UI 7 个组件 + next-themes + sonner + marked 18 + marked-highlight + highlight.js + lucide-preact/react + class-variance-authority + clsx + tailwind-merge + @tauri-apps/* + @preact/preset-vite

## 附录 B：关键代码文件清单（用于深入 review）

**必读**：
- `src-tauri/src/lib.rs` (1662 行) — IPC + WSL + 备份
- `src-tauri/src/db/commands.rs` (707 行) — 26 个 Tauri command + compute_token_stats
- `src-tauri/src/db/dao.rs` (339 行) — 领域类型 + DAO trait
- `src-tauri/src/crypto.rs` (365 行) — 加密备份
- `src/main.ts` (1864 行) — 前端胶水
- `src/lib/chat-stream.ts` (401 行) — SSE 编排
- `src/lib/sanitize.ts` (24 行) — **安全关键**
- `src-tauri/capabilities/default.json` (53 行) — **安全关键**
- `src/views/chat-view.tsx` (709 行) — 主要 UI

**应当读**：
- `src/views/backup-modal.tsx` (448 行)
- `src/views/sessions-list-view.tsx` (409 行)
- `src/views/chat-input-view.tsx` (308 行)
- `src/views/share-flow.ts` (146 行)
- `src-tauri/src/db/session.rs` (338 行)
- `src-tauri/src/db/project.rs` (830 行)
- `src-tauri/src/db/token.rs` (356 行)
- `src-tauri/src/db/pool.rs` (163 行)
- `src-tauri/src/db/schema.rs` (295 行)
- `src-tauri/migrations/0001_initial.sql` (137 行)

**可跳读**：
- 17 个 `*-store.ts`（每个 30–200 行，套路一致）
- 17 个 `*-view.tsx` / `*-mount.tsx`
- `src/lib/state.ts`、`api.ts`、`boot.ts`、`theme.ts`、`toast.ts`、`shortcuts.ts`、`tray-menu.ts`、`reply-notification.ts`、`focus-trap.ts`、`config-schema.ts`、`chat-formatters.ts`、`multimodal.ts`、`db-config.ts`、`share-ui.ts`（都是高质量的小模块）
