# T-Q5 Deliverable: 给 src-tauri/src/lib.rs 核心 IPC 命令加单元测试

## Summary

为 hermes-tray-tauri 的核心文件 IO 类纯函数 (config.json 读写 / WSL distro 解析) 新增
22 个单元测试, 全部通过. 隔离机制使用 tempfile + IO_LOCK Mutex, 防止 cargo 并行测试
互相污染 CWD / exe dir. 跳过所有依赖外部 WSL exec / 进程 spawn / HTTP 的函数
(行为依赖外部环境, 不可重现).

## Commit

- **Branch**: master (本地领先 origin/master 14 commits, **未推送**)
- **Commit hash**: `4da4623f593a53e8aebdaed674db10dfce7f8d87`
- **Message**: `T-Q5: 给 lib.rs 核心 IPC 命令加单元测试`
- **Stats**: 3 files changed, 352 insertions(+)

## Changed files

| 文件 | 类型 | 备注 |
|------|------|------|
| `src-tauri/src/lib.rs` | 修改 | 末尾追加 `#[cfg(test)] mod tests { ... }` (~340 行) |
| `src-tauri/Cargo.toml` | 修改 | 新增 `[dev-dependencies] tempfile = "3"` |
| `src-tauri/Cargo.lock` | 自动更新 | cargo 自动加 `tempfile` 到 hermes-tray-tauri 依赖列表 |

**未修改**:
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`
- 任何前端文件
- 任何现有 `#[tauri::command]` 函数签名
- 任何现有函数体

## Test 覆盖清单 (22 个)

### `read_wsl_distro` (8 个)

| Test | 描述 |
|------|------|
| `read_wsl_distro_reads_from_cwd_config` | CWD 有 `{"wsl_distro": "Debian"}` → 返回 "Debian" |
| `read_wsl_distro_reads_arbitrary_string` | 验证任意字符串 distro 名称可正确返回 |
| `read_wsl_distro_returns_default_when_no_file` | CWD 无 config.json → 返回 "Ubuntu-24.04.4" |
| `read_wsl_distro_returns_default_when_json_invalid` | config.json 是垃圾内容 → 返回默认 |
| `read_wsl_distro_returns_default_when_distro_key_missing` | config.json 有其他 key 但无 wsl_distro → 返回默认 |
| `read_wsl_distro_returns_default_for_empty_object` | `{}` → 返回默认 |
| `read_wsl_distro_ignores_non_string_distro_value` | `{"wsl_distro": 42}` 非字符串 → 返回默认 (验证 `as_str()` 失败路径) |
| `read_wsl_distro_prefers_exe_dir_over_cwd` | exe dir 和 CWD 都有 config.json, exe dir 优先 |

### `read_config_json` (4 个)

| Test | 描述 |
|------|------|
| `read_config_json_returns_parsed_object` | 嵌套 JSON 正确解析 (a / b / nested.k) |
| `read_config_json_returns_empty_on_missing_file` | 无文件 → `serde_json::json!({})` |
| `read_config_json_returns_empty_on_invalid_json` | 垃圾内容 → `{}` |
| `read_config_json_returns_empty_object_when_file_is_empty` | 空文件 → `{}` (空文件 parse 失败路径) |

### `write_config_json` (3 个)

| Test | 描述 |
|------|------|
| `write_config_json_creates_file_with_expected_content` | 在 exe dir 创建 config.json, 内容可读回 |
| `write_config_json_overwrites_previous_content` | 二次写入覆盖旧 key, 旧 key 消失 |
| `write_config_json_writes_pretty_printed_json` | 验证 `serde_json::to_string_pretty` 格式 (含换行 + 缩进) |

### `hermes_get_config` (2 个)

| Test | 描述 |
|------|------|
| `hermes_get_config_returns_parsed_object` | wrapper 函数行为与 `read_config_json` 一致 |
| `hermes_get_config_returns_empty_when_no_file` | 无文件 → 空对象 |

### `hermes_save_config` (5 个)

| Test | 描述 |
|------|------|
| `hermes_save_config_writes_when_no_existing` | 无现有 config → 写入新 config |
| `hermes_save_config_merges_with_existing_keys` | 现有 wsl_distro="Initial", save wsl_distro="Updated" → merge 后 = "Updated" |
| `hermes_save_config_adds_new_keys` | 旧 key 保留 + 新 key 写入 |
| `hermes_save_config_empty_updates_preserves_existing` | 空更新对象 → 现有 config 完整保留 |
| `hermes_save_config_non_object_updates_is_noop_merge` | 更新是 array (非 object) → 不报错, 写空对象 |

## 隔离机制说明

测试模块在进程全局状态 (CWD / exe dir 的 config.json) 上操作, cargo 默认并行跑测试.
所以加了 3 道保险:

1. **`IO_LOCK: Mutex<()>`**: 所有 CWD/文件 IO 测试第一行 `let _guard = IO_LOCK.lock()...`,
   强制串行化.
2. **`with_isolated_cwd(|dir| { ... })`**: 创建 tempfile → `set_current_dir` → 测试
   → 恢复 CWD → 删除 tempdir. 同时临时清空 exe dir 的 config.json, 防止
   `read_wsl_distro` 优先命中 exe dir 绕过测试意图.
3. **`with_exe_config(|cfg| { ... })`**: 备份 exe dir 的 config.json → 清空
   (或保留备份) → 测试 → 还原备份或删除.

每个测试退出时, 不管成功失败都恢复原状. 异常路径用 `let _ = ...` 兜底,
不让 cleanup panic 覆盖真实错误.

## cargo test 输出关键段

```text
running 22 tests
test tests::hermes_get_config_returns_empty_when_no_file ... ok
test tests::hermes_save_config_non_object_updates_is_noop_merge ... ok
test tests::hermes_save_config_empty_updates_preserves_existing ... ok
test tests::hermes_save_config_merges_with_existing_keys ... ok
test tests::hermes_get_config_returns_parsed_object ... ok
test tests::hermes_save_config_adds_new_keys ... ok
test tests::read_wsl_distro_returns_default_when_distro_key_missing ... ok
test tests::read_config_json_returns_empty_object_when_file_is_empty ... ok
test tests::read_config_json_returns_empty_on_invalid_json ... ok
test tests::read_config_json_returns_parsed_object ... ok
test tests::read_config_json_returns_empty_on_missing_file ... ok
test tests::read_wsl_distro_ignores_non_string_distro_value ... ok
test tests::read_wsl_distro_prefers_exe_dir_over_cwd ... ok
test tests::read_wsl_distro_reads_arbitrary_string ... ok
test tests::read_wsl_distro_reads_from_cwd_config ... ok
test tests::read_wsl_distro_returns_default_for_empty_object ... ok
test tests::hermes_save_config_writes_when_no_existing ... ok
test tests::read_wsl_distro_returns_default_when_json_invalid ... ok
test tests::read_wsl_distro_returns_default_when_no_file ... ok
test tests::write_config_json_creates_file_with_expected_content ... ok
test tests::write_config_json_overwrites_previous_content ... ok
test tests::write_config_json_writes_pretty_printed_json ... ok

test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
```

完整日志: `C:\Users\Admin\.mavis\plans\plan_61d7e14e\outputs\tq5-rust-unit-tests\cargo-test.log`

## Coverage 估计

lib.rs 共有 **14 个 `#[tauri::command]` 函数**:

| 命令 | 测试覆盖 | 原因 |
|------|---------|------|
| `hermes_resolve_gateway_ip` | ❌ | 内部调 `detect_wsl_ip` (wsl exec) |
| `hermes_check_gateway_status` | ❌ | wsl exec |
| `hermes_start_gateway` | ❌ | wsl exec |
| `hermes_stop_gateway` | ❌ | wsl exec |
| `hermes_check_gateway_health` | ❌ | reqwest HTTP |
| `hermes_detect_wsl` | ❌ | wsl --version exec |
| `hermes_list_wsl_distros` | ❌ | wsl exec |
| `hermes_find_bin` | ❌ | wsl exec |
| `hermes_restart_gateway` | ❌ | wsl exec |
| `hermes_get_config` | ✅ | 文件 IO 隔离可测 (2 tests) |
| `hermes_save_config` | ✅ | 文件 IO 隔离可测 (5 tests) |
| `hermes_proxy_get` | ❌ | reqwest HTTP |
| `hermes_proxy_post` | ❌ | reqwest HTTP |
| `hermes_proxy_post_stream` | ❌ | reqwest HTTP + tauri Window |

**实际覆盖 2/14 = 14%** IPC 命令 (按"可独立单测"标准), 但**间接覆盖了 5 个底层纯函数**:
- `read_wsl_distro` (8 tests)
- `read_config_json` (4 tests)
- `write_config_json` (3 tests)
- `hermes_get_config` (2 tests)
- `hermes_save_config` (5 tests)

未覆盖的 12 个命令**全部**涉及 wsl exec / 进程 spawn / HTTP, 这些属于"集成测试"或
"端到端测试"范畴, 应在 WSL 环境 + hermes gateway 真实运行时测, 不适合 lib.rs 单元测试.
后续如需提升覆盖率, 可以:
1. 把 `detect_wsl_ip` 拆成 "解析 stdout 字符串" + "调 wsl 命令" 两层, 前者单测
2. 把 `hermes_find_bin` 拆成 "路径候选列表" + "调 wsl test" 两层, 前者单测
3. 用 `mockito` / `wiremock` mock reqwest, 测 `hermes_proxy_*` 和 `hermes_check_gateway_health`

## 已知边界 / 限制

1. **未测带 wsl/HTTP 的命令**: 见上表. 这些函数的逻辑在生产环境验证, 不在单测范围.
2. **`write_config_json` 写入位置是 `target/debug/deps/config.json`**:
   - 这是测试 binary 的 parent dir, 不是项目根. 测试 helper 用
     `take_exe_config_path()` 备份+清空, 测试后用 `restore_exe_config()` 还原.
   - 如果 cargo test 进程被 kill -9, 残留的 `target/debug/deps/config.json`
     不会被清理. 下次 cargo test 之前 `cargo clean` 即可.
3. **CWD 切换是 process-global**: 串行化靠 `IO_LOCK` 强制. 如果未来加
   `#[test]` 测试**不**通过 helper 改 CWD, 必须在它能感知的状态下.
4. **`tempfile` 是新增 dev-dep**: 项目之前没有. 已加 `[dev-dependencies] tempfile = "3"`,
   Cargo.lock 已有 3.27.0. 首次拉取需网络.
5. **测试不验证任何窗口事件 / Tauri 状态**: `run()` 函数和 tray 菜单回调
   完全没测. 这些需要 tauri 的 mock framework (如 `tauri::test`), 工程量
   远超本次任务范围, 建议留作后续独立 task.

## 验证命令

```bash
cd F:\work\workspace\Qoder\hermes-tray\src-tauri
cargo test --lib
# expected: test result: ok. 22 passed; 0 failed
```

## Notes for Verifier

- 提交在本地 master 分支, **未推送** (per 用户 Git 规则 + 任务约束).
- 验证 `git log -1` 看到 commit `4da4623f593a53e8aebdaed674db10dfce7f8d87` 即为本次提交.
- 验证 `git status` 应看到 `package.json` modified + `src/escapeHtml.ts`/`src/formatMessage.ts`/`vitest.config.ts` untracked,
  那些是 T-Q6 任务 (前端 TS 单测) 的工作区, 跟本任务无关, 不要混进本 commit.
- 验证 `cargo test --lib --manifest-path src-tauri/Cargo.toml` 应该看到 22 passed; 0 failed.
- 如需重新跑, 第一次需要网络拉取 `tempfile` crate, 之后离线 OK.
