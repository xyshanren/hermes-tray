# Hermes Tray — CHANGELOG

> Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn). 全栈：[frontend (Svelte + Vite) + Tauri (Rust) + SQLite FTS5 + WebView2].
>
> 完整 release notes 落在 `docs/RELEASE_vX.Y.Z.md`。

---

## v0.1.3 (2026-07-03)

**S5+ quick capture global shortcut** — `Ctrl+Shift+H` 现在直接开新会话（不只是唤起），复用 `createSession()` 路径。
**S13 升级** — `hermes_proxy_transcribe` Rust command 提取 2 个 pure helper (`pick_audio_extension` / `parse_openai_transcribe_response`) + 10 个 unit test，锁住 OpenAI-shape 协议契约。
**Version bump** — `package.json` / `Cargo.toml` / `tauri.conf.json` 三处从 0.1.0 升到 0.1.3（之前 git tag 跟 binary filename 不一致）。

Full notes: [docs/RELEASE_v0.1.3.md](./blob/v0.1.3/docs/RELEASE_v0.1.3.md)

---

## v0.1.2 (2026-06-26)

**Tauri 2.x 完整 v2.0 基础 + S0-S10 + S12-light + S13 + S14 多模态** — SQLite + FTS5 + Persona 库 + Project context 扫描 + Token / 成本追踪 + 导出/分享 + 加密本地备份 + 模型选择器 + 语音输入 + 图片拖拽上传。
**408 tests baseline** — Rust 230 + Frontend 129 + src-tauri 49。URMP 5 乐器 CREPE avg 77.87；RAG/VLM 端到端通。

Full notes: [docs/RELEASE_v0.1.2.md](./blob/v0.1.2/docs/RELEASE_v0.1.2.md)

---

## v0.1.1 (2026-06-23)

**T-Q-NEW config location fix** — `write_config_json` 改用 `app_config_dir()` (Tauri 2 canonical path)，修 MSI 安装到 `C:\Program Files\` 时 silent write 失败。
**Legacy fallback** — exe dir + CWD 读，保证 v0.1.0 用户升级保留设置。

Full notes: [docs/RELEASE_v0.1.1.md](./blob/v0.1.1/docs/RELEASE_v0.1.1.md)

---

## v0.1.0 (2026-06-05)

**首个公开版本** — Tauri 2 桌面客户端 (Windows + WSL2 hermes-agent-cn gateway)。
- 全栈：Rust backend (Tauri commands) + Svelte frontend + SQLite DB + WSL gateway proxy
- 基础：session list / message / FTS5 搜索 / global shortcut (`Ctrl+Shift+H` 唤起窗口，**v0.1.3 升级为 quick capture**)

Full notes: [docs/RELEASE_v0.1.0.md](./blob/v0.1.0/docs/RELEASE_v0.1.0.md)
