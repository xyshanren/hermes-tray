# Hermes Tray v0.1.1 (2026-06-22)

补丁版本. 修复 v0.1.0 MSI 安装包内写 `config.json` 失败的 bug (T-Q-NEW), 同时为 v0.2.0 SQLite 存储架构 (T-Q-S0) 做底层准备.

## 修复

### T-Q-NEW: MSI Program Files 下 write_config_json 静默失败

**症状**: MSI 安装到 `C:\Program Files\Hermes Tray\` 后, 用户在 UI 里改设置并保存, 配置不生效; tray 重启后还是默认值. 重新安装也没用.

**根因**: `write_config_json()` 用 `std::env::current_exe().with_file_name("config.json")` 写到 exe 同目录. MSI 默认安装路径 `C:\Program Files\Hermes Tray\` 是受保护目录, 普通用户写不进去 — Windows 静默丢弃写入, 没有错误提示.

**修法**: 改用 Tauri 2 canonical 路径 `AppHandle::app_config_dir()`. Windows 下解析到 `%APPDATA%\com.hermes.tray\`, 普通用户完全可写. 配套:

- 新位置不存在时自动创建 (`std::fs::create_dir_all`)
- 读取路径兼容: 新位置 → exe dir → CWD (v0.1.x legacy fallback), 升级用户原配置不丢
- 首次写入新位置时, 自动备份 legacy config 到 `v0.1.0-config.json.bak` (带迁移来源注释)

**影响的命令**: `hermes_get_config` / `hermes_save_config` / `hermes_resolve_gateway_ip` / `pick_gateway_host` 全部走新路径.

## 重构

- `read_wsl_distro` / `read_config_json` / `write_config_json` / `read_gateway_host_override` 拆成两层:
  - AppHandle 薄包装 (生产代码)
  - 纯 helper (`read_wsl_distro_from(path)` / `read_config_json_from(path)` / `write_config_json_to(path, value)` / `extract_gateway_host(value)`), 接收 `&Path` 或 `&Value`, 不依赖 Tauri runtime.
- 好处: 单元测试不再需要 mock AppHandle, 直接传路径/value.

## 测试

- **48 单元测试全绿** (从 22 增到 48)
- 新增覆盖:
  - `read_wsl_distro_from` × 8 (parsing / missing / invalid / non-string / empty object / legacy fallback)
  - `read_config_json_from` × 4 (parsed / missing / invalid / empty)
  - `write_config_json_to` × 4 (create / overwrite / pretty / nested dirs auto-create)
  - `save_config_*` 行为 × 5 (覆盖 Tauri command `hermes_save_config` 语义)
  - `extract_gateway_host` × 6
- `cargo fmt --check` 通过
- `cargo check` 通过

## 安装

同 v0.1.0. 升级会自动迁移:
1. 第一次启动读 legacy config.json (exe dir + CWD)
2. 用户首次保存设置时, 备份 legacy 到 `%APPDATA%\com.hermes.tray\v0.1.0-config.json.bak`
3. 后续所有配置都在 `%APPDATA%\com.hermes.tray\config.json`

## 下一步

- v0.2.0 (T-Q-S1..S5): 用 SQLite 替换纯 JSON, schema/DAO/迁移/会话存档/反馈/多 persona 配置. 设计文档已就绪: `docs/T-Q-S0-design.md`.
- 任务板: `.agent-teams/TASK_BOARD.md` v2 Product Roadmap (15 T-Q-S* 任务 / 4 阶段 / 12 周).

## Commit

- `7bcb1d4` fix(config): T-Q-NEW write_config_json now writes to app_config_dir (Tauri 2 canonical path)
- `cf357e0` docs: T-Q-S0 design - v2.0 storage architecture (app_config_dir migration + SQLite schema + DAO interface + T-Q-NEW fix plan)