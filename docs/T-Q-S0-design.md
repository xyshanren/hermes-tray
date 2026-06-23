# Hermes Tray v2.0 — 架构设计文档 (T-Q-S0)

> **版本**: v2.0 架构 (T-Q-S0)
> **日期**: 2026-06-23
> **作者**: Mavis (Architect)
> **配套**: TASK_BOARD.md (12 周 roadmap) + architecture.md (v0.1.0 现状)

---

## 〇、定位

> **Hermes Tray v2 = "Hermes 个人会话工作台"**
>
> 不是另一个 AI 聊天客户端, 而是**本地优先的会话管理 + OS 深度集成**的 power-user 工具.
> 官方/3rd-party WebUI 都不做, 我们的 niche 优势.

**v2.0 核心能力**: 100+ 本地会话管理, 离线可用, 全文搜索, Persona 模板, 项目上下文感知.

---

## 一、v2.0 vs v0.1.0 架构对比

| 维度 | v0.1.0 | v2.0 |
|---|---|---|
| **数据存储** | `config.json` 在 exe dir (CWD fallback) | **SQLite in `%APPDATA%\com.hermes.tray\`** (跨 build 稳定, 不需管理员) |
| **会话管理** | 无 (单会话) | **100+ 会话, sidebar + tabs + 搜索** |
| **配置管理** | flat JSON | SQLite `config` table + versioning |
| **搜索** | 无 | **SQLite FTS5 全文搜索** |
| **Persona** | 无 | **角色 + 自定义指令 + 跨会话记忆** |
| **项目上下文** | 无 | **CWD 扫描 README/git log, 注入 system prompt** |
| **加密备份** | 无 | **AES + 可选云同步** |
| **多模型** | 走 hermes-agent-cn router | 客户端感知 + 切换 (Claude / GPT / ollama) |
| **OS 集成** | 托盘 + 菜单 | **+ 全局热键 + 拖入文件** |

---

## 二、存储架构

### 2.1 路径迁移 (v0.1.0 → v2.0)

**v0.1.0 痛点** (T-Q-NEW bug 根因):
- `current_exe()` 跨 build 漂移 (dev / release / MSI 各不同)
- exe dir 写需要管理员权限 (Program Files)
- CWD 读 fallback 但写不 fallback — 不一致

**v2.0 方案**: 统一用 `tauri::api::path::app_config_dir()`

| 平台 | app_config_dir 路径 |
|---|---|
| **Windows** | `C:\Users\<USER>\AppData\Roaming\com.hermes.tray\` |
| **Linux** | `~/.config/com.hermes.tray/` |
| **macOS** | `~/Library/Application Support/com.hermes.tray/` |

**目录结构**:
```
%APPDATA%\com.hermes.tray\
├── config.json         # 用户配置 (v0.1.0 config.json 迁移)
├── sessions.db         # SQLite (会话数据)
├── cache/               # 缩略图 / 附件
│   ├── thumbnails/
│   └── attachments/
└── backups/             # AES 加密备份 (T-Q-S11)
    └── 2026-06-23-001.enc
```

### 2.2 一次性迁移 (v0.1.0 → v2.0)

启动时检测:
1. 旧 `config.json` 在 exe dir 或 CWD
2. 迁移到 `%APPDATA%\com.hermes.tray\config.json`
3. 备份旧文件到 `%APPDATA%\com.hermes.tray\backups\v0.1.0-config.json.bak`
4. 删除旧文件 (避免下次再迁移)

---

## 三、SQLite Schema (T-Q-S1 基础)

### 3.1 ER 图

```
┌─────────────────────────────────────────────────────────┐
│ SQLite: %APPDATA%\com.hermes.tray\sessions.db           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  sessions                                                │
│  ├─ id          TEXT PRIMARY KEY  (uuid v4)           │
│  ├─ title       TEXT NOT NULL                          │
│  ├─ persona_id  TEXT → personas(id)                    │
│  ├─ project_dir TEXT                                    │
│  ├─ created_at  INTEGER (unix ts, ms)                   │
│  ├─ updated_at  INTEGER                                 │
│  ├─ last_msg_at INTEGER                                 │
│  ├─ msg_count   INTEGER DEFAULT 0                      │
│  ├─ total_tokens INTEGER DEFAULT 0                     │
│  ├─ model       TEXT                                    │
│  └─ metadata    TEXT (JSON)                              │
│                                                          │
│  messages                                                │
│  ├─ id          TEXT PRIMARY KEY                        │
│  ├─ session_id  TEXT → sessions(id) ON DELETE CASCADE  │
│  ├─ role        TEXT ('user' | 'assistant' | 'system') │
│  ├─ content     TEXT NOT NULL                          │
│  ├─ tokens      INTEGER DEFAULT 0                      │
│  ├─ created_at  INTEGER                                 │
│  ├─ tool_calls  TEXT (JSON array)                       │
│  └─ metadata    TEXT (JSON)                              │
│                                                          │
│  personas                                                │
│  ├─ id          TEXT PRIMARY KEY                        │
│  ├─ name        TEXT NOT NULL                            │
│  ├─ description TEXT                                    │
│  ├─ system_prompt TEXT                                  │
│  ├─ avatar      TEXT (emoji or URL)                     │
│  └─ created_at  INTEGER                                 │
│                                                          │
│  tags                                                    │
│  ├─ id          TEXT PRIMARY KEY                        │
│  ├─ name        TEXT UNIQUE                              │
│  ├─ color       TEXT                                    │
│  └─ session_count INTEGER DEFAULT 0                     │
│                                                          │
│  session_tags (junction)                                 │
│  ├─ session_id  TEXT → sessions(id) ON DELETE CASCADE  │
│  └─ tag_id      TEXT → tags(id) ON DELETE CASCADE      │
│                                                          │
│  config  (key-value store, replaces config.json)         │
│  ├─ key         TEXT PRIMARY KEY                        │
│  ├─ value       TEXT (JSON)                              │
│  ├─ updated_at  INTEGER                                 │
│  └─ version     INTEGER (schema migration tracking)     │
│                                                          │
│  feedback (RLAIF data)                                   │
│  ├─ id          TEXT PRIMARY KEY                        │
│  ├─ session_id  TEXT → sessions(id)                     │
│  ├─ msg_id      TEXT → messages(id)                     │
│  ├─ thumb       INTEGER (1=up, 0=down)                   │
│  ├─ comment     TEXT                                    │
│  └─ created_at  INTEGER                                 │
│                                                          │
│  -- FTS5 全文搜索 (virtual table)                       │
│  messages_fts                                            │
│  ├─ content     TEXT (FTS5 indexed)                      │
│  ├─ session_id  TEXT (FTS5 indexed)                     │
│  ├─ role        TEXT (FTS5 indexed)                     │
│  └─ msg_id      TEXT (UNINDEXED)                        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 FTS5 全文搜索

```sql
-- 创建 FTS5 虚拟表
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    session_id UNINDEXED,
    role UNINDEXED,
    msg_id UNINDEXED,
    tokenize='porter unicode61'
);

-- 触发器: messages insert/update/delete 自动同步
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, session_id, role, msg_id)
    VALUES (new.rowid, new.content, new.session_id, new.role, new.id);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    UPDATE messages_fts SET content = new.content WHERE rowid = new.rowid;
END;
```

**查询示例**:
```sql
-- 搜 "crepe" 关键词, 返回 top-10 命中 (含 session_id 关联)
SELECT m.id, m.session_id, m.content, m.created_at, s.title
FROM messages_fts f
JOIN messages m ON f.rowid = m.rowid
JOIN sessions s ON m.session_id = s.id
WHERE messages_fts MATCH 'crepe'
ORDER BY rank
LIMIT 10;
```

### 3.3 Schema 版本

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
INSERT INTO schema_version VALUES (1, strftime('%s', 'now') * 1000);
```

未来 schema 变更走 migration 文件 (T-Q-S1 范围).

---

## 四、SQLite 库选型

| 选项 | 评估 |
|---|---|
| **rusqlite** | 推荐 — 轻, 同步 API, 适合本地工具 |
| sqlx | 异步, 编译时检查, 适合服务 |
| diesel | ORM 重, 学习曲线陡 |

**决定**: rusqlite + r2d2 连接池 (简单 pool, 10 connections)

```toml
[dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
r2d2 = "0.8"
r2d2_sqlite = "0.25"
```

**bundled feature**: 自带 SQLite C lib, 避免系统依赖 (v0.1.0 ffmpeg-sys-next 同思路)

---

## 五、DAO 层设计 (T-Q-S1)

### 5.1 模块结构

```
src-tauri/src/db/
├── mod.rs              # 公开 API: init_db, get_pool
├── schema.rs           # SQL CREATE TABLE + migration runner
├── pool.rs             # r2d2 pool 配置
├── session.rs          # SessionDAO: list/get/create/update/delete
├── message.rs          # MessageDAO: append/list_by_session/search
├── persona.rs          # PersonaDAO: list/get/create/update
├── config.rs           # ConfigDAO: get/set (key-value)
├── feedback.rs         # FeedbackDAO: 投票/评论
└── tests/              # 单元测试 (tempfile + in-memory SQLite)
    ├── session_test.rs
    ├── message_test.rs
    └── ...
```

### 5.2 SessionDAO 接口

```rust
pub trait SessionDAO: Send + Sync {
    fn list(&self, limit: i64, offset: i64) -> Result<Vec<Session>, Error>;
    fn get(&self, id: &str) -> Result<Session, Error>;
    fn create(&self, title: &str, persona_id: Option<&str>) -> Result<Session, Error>;
    fn update(&self, id: &str, patch: SessionPatch) -> Result<Session, Error>;
    fn delete(&self, id: &str) -> Result<(), Error>;
    fn search(&self, query: &str, limit: i64) -> Result<Vec<SearchHit>, Error>;
    fn touch(&self, id: &str) -> Result<(), Error>;  // 更新 last_msg_at
}
```

### 5.3 Connection Pool

```rust
pub type DbPool = r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>;

pub fn init_db(app: &AppHandle) -> Result<DbPool, Error> {
    let config_dir = app.path().app_config_dir().expect("config dir");
    std::fs::create_dir_all(&config_dir)?;
    let db_path = config_dir.join("sessions.db");
    let manager = SqliteConnectionManager::file(db_path);
    let pool = r2d2::Pool::builder()
        .max_size(10)
        .build(manager)?;
    // Run migrations
    schema::run_migrations(&pool)?;
    Ok(pool)
}
```

**WAL 模式** (write-ahead log, 提升并发):
```rust
SqliteConnectionManager::file(db_path)
    .with_init(|c| c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"))
```

---

## 六、API (Tauri IPC Commands)

### 6.1 Session API

```rust
#[tauri::command]
fn session_list(limit: i64, offset: i64, db: tauri::State<DbPool>) -> Result<Vec<Session>, String> {
    db.session().list(limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_create(title: String, persona_id: Option<String>, db: tauri::State<DbPool>) -> Result<Session, String> {
    db.session().create(&title, persona_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_search(query: String, db: tauri::State<DbPool>) -> Result<Vec<SearchHit>, String> {
    db.session().search(&query, 50).map_err(|e| e.to_string())
}

// ... 更多 (update / delete / get / messages_list)
```

### 6.2 State 注入

```rust
fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let pool = db::init_db(&app.handle())?;
            app.manage(pool);  // 注入 State<DbPool>
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session_list, session_create, session_search, ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 七、Config 迁移 (T-Q-NEW 修)

### 7.1 旧 config.json 位置

| 路径 | 优先级 |
|---|---|
| `<exe_dir>/config.json` | 1 |
| `<cwd>/config.json` | 2 (fallback) |

### 7.2 新 app_config_dir 位置

| 平台 | 路径 |
|---|---|
| Windows | `C:\Users\<USER>\AppData\Roaming\com.hermes.tray\config.json` |
| Linux | `~/.config/com.hermes.tray/config.json` |
| macOS | `~/Library/Application Support/com.hermes.tray/config.json` |

### 7.3 迁移代码

```rust
fn migrate_legacy_config(app: &AppHandle) -> Result<(), String> {
    let new_path = app.path().app_config_dir()?.join("config.json");
    if new_path.exists() {
        return Ok(());  // 已是新格式
    }
    std::fs::create_dir_all(new_path.parent().unwrap())?;

    // 找旧 config
    for legacy in legacy_config_paths() {
        if let Ok(content) = std::fs::read_to_string(&legacy) {
            std::fs::write(&new_path, &content)?;
            let backup = new_path.with_file_name("v0.1.0-config.json.bak");
            std::fs::write(backup, format!("# Migrated from {}\n{}", legacy.display(), content))?;
            log::info!("Migrated config from {} to {}", legacy.display(), new_path.display());
            return Ok(());
        }
    }
    // 没有旧 config, 创建空
    std::fs::write(&new_path, "{}")?;
    Ok(())
}
```

### 7.4 修 T-Q-NEW bug

同时**修 `write_config_json`**:
```rust
fn write_config_json(config: &serde_json::Value) -> Result<(), String> {
    // 新: 写 app_config_dir/config.json
    let config_dir = app.path().app_config_dir().map_err(|e| ...)?;
    std::fs::create_dir_all(&config_dir)?;
    let path = config_dir.join("config.json");
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    log::info!("Config saved to {}", path.display());
    Ok(())
}
```

**根除 T-Q-NEW**: 跨 build 稳定 + 不需管理员 + 一致性

---

## 八、安全考虑

| 风险 | 缓解 |
|---|---|
| SQLite SQL 注入 | 所有 DAO 用 prepared statement (rusqlite 默认) |
| 配置文件未加密 | `api_key` 字段单独加密 (T-Q-S11) |
| 数据库损坏 | WAL 模式 + 每日 backup (T-Q-S11) |
| 多窗口并发 | r2d2 pool + WAL 模式 |
| 跨用户 (多人共用电脑) | 用 OS 用户隔离 (Windows AppData 是用户级) |

---

## 九、依赖

```toml
[dependencies]
# v2.0 新增
rusqlite = { version = "0.32", features = ["bundled"] }
r2d2 = "0.8"
r2d2_sqlite = "0.25"

# v0.1.0 已有 (复用)
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls", "stream"] }
tokio = { version = "1", features = ["full"] }
tempfile = "3"
```

---

## 十、T-Q-S1 派工框架 (给 builder)

**Mavis 写 schema.sql** (设计者) + **builder 跑 DAO 实现 + 单元测试** (模板化)

具体子任务 (T-Q-S1, 3 天):
- T-Q-S1.1 (1d): Mavis 写 schema.sql + 写 DAO trait 接口, builder 复制到 lib
- T-Q-S1.2 (1d): builder 跑 session.rs + message.rs + 5 unit tests (tempfile)
- T-Q-S1.3 (1d): builder 跑 persona.rs + config.rs + feedback.rs + 5 unit tests

**测试覆盖率目标**: > 90% (DAO 层)

---

## 十一、Maintainer Note

**T-Q-S0 关键决策**:
1. ✅ 路径迁移 `exe_dir` → `app_config_dir()` (根除 T-Q-NEW bug)
2. ✅ SQLite + rusqlite + r2d2 (轻, 同步, 适合本地工具)
3. ✅ FTS5 全文搜索 (T-Q-S4 基础)
4. ✅ Bundled SQLite (避免系统依赖, 同 ffmpeg-sys-next 思路)

**T-V2 触发**:
- T-Q-S11 (加密备份) - 加密策略需用户拍板
- T-Q-S15 (插件系统) - Tauri plugin vs JS plugin 需拍板

**Maintainer**: Mavis (Architect + Planner)
**协调**: builder (T-Q-S1.1-S1.3 模板化)

---

**Mavis 状态**: T-Q-S0 设计文档 ready. 下一步修 T-Q-NEW bug (write_config_json 用 app_config_dir) → 派 builder 跑 T-Q-S1 SQLite schema.