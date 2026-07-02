# hermes-tray v0.1.3 — Release Plan (DRAFT)

> **状态**: DRAFT — 等用户拍板范围 + 时间窗
> **草案日期**: 2026-07-02
> **基于**: 今日 (2026-07-02) 已 push 到 origin 的两个 commit
>   - `1764d10` T-Q-S5+ quick capture global shortcut (Ctrl+Shift+H 自动开新会话)
>   - `016383af8` hermes-agent-cn S13 STT 端点 + web_server.py 累计 cherry-pick 残缺修复（cross-project，但 v0.1.3 集成必要前提）

---

## 范围（建议）

### 必备 (Must-have)

#### 1. S5+ quick capture (Hermes-tray)
- **代码 commit**: `1764d10` on `master` (已在 origin)
- **行为**: Ctrl+Shift+H 从 "唤起 + 聚焦输入框" 升级到 "复用 createSession() 直接开新会话 + focus 输入框"
- **验收**: 已过 (`src/main.ts` L1975 改动 + 90 vitest + 133 cargo = 223/223 tests passed, commit hash `1764d10`)

#### 2. STT 端点 (Hermes-agent-cn, cross-project 配套)
- **代码 commit**: `016383af8` on `cn` branch (已在 origin)
- **行为**: `POST /v1/audio/transcriptions` (multipart) OpenAI-compat, 5 providers (local faster-whisper / groq / openai / mistral / elevenlabs)
- **验收**: 已过 (`tests/test_s13_audio_transcriptions.py` 8/8 passed)

#### 3. Tray 端 T-Q-S13 升级：从 placeholder STT 切到真实 endpoint
- **代码**: 改 `hermes-tray/src-tauri/src/` `hermes_proxy_transcribe` Rust command（已 done 2026-06-26 但当前 default URL 可能是 placeholder）
- **目标**: 把 default STT endpoint URL 从 placeholder 切到 `${GATEWAY_URL}/v1/audio/transcriptions` (hermes-agent-cn v0.17.0+cn.18+)
- **新增工作量**: 0.5 天 (config 切换 + integration test)
- **验收**: Windows 端起 hermes-agent-cn server + tray 真实录音发送 → STT 端点响应 → transcribe text 回到输入框

#### 4. Release tag `v0.1.3` + push
- **代码**: `git tag -a v0.1.3 <commit> && git push origin master --tags`
- **配套**: `CHANGELOG.md` (root) 加 v0.1.3 entry

---

### 可选 (Nice-to-have, 单独投票)

- **v0.1.3 集成测试** — 真实端到端录音→STT→quick capture 流程测试（tray + agent 同时跑）— 0.5-1 天
- **PROGRESS.md §153 §166 更新** — 已更新 (Phase 0.6 done + S13-agent ✅ done) — 这次 commit 内
- **`docs/RELEASE_v0.1.3.md`** — 本文档落地（从 DRAFT → final after v0.1.3 actually released）

---

## 不在范围 (Explicit Non-Goals)

- **S14-agent Vision fallback** — 仍 pending，需要等用户拍板（NEEDS_BACKLOG §需求 3）
- **S12-agent Cost-aware routing** — 仍 pending（NEEDS_BACKLOG §需求 1）
- **S15-agent Plugin marketplace MVP** — 独立产品决策，Phase 4
- **0.7 demo 视频** / **0.10 RLAIF UI 原型** — ai-music-trainer 项目暂停状态（HANDOFF §2.3 / ai-music-trainer/AGENTS.md）
- **CodeArts 真活项目筛选** — social-publisher venv 待 install；ai-data-analyzer venv ready — 等用户决定

---

## 时间窗

- **Start**: 用户拍板范围 + S13 集成 test 排序之时
- **End**: v0.1.3 tag pushed to origin + release notes final
- **预估**: 必备范围 1-1.5 天（如果 S13 集成 0.5 天没问题）

---

## 决策点（需要用户回答）

1. **Tray STT 升级** 包含吗？（不包含则 v0.1.3 只是 tray 单独 S5 patch，跟 hermes-agent-cn S13 解耦发布）
2. **集成测试** 走 CI 还是手动？（手动快，CI 稳）
3. **Tag 命名** — `v0.1.3` 还是跟 hermes-agent-cn 同步出 `v0.1.3+cn.1`？

---

## 历史 (2026-07-02)

- 本文档初版，结合今天 S5 patch + S13 STT endpoint 两个 commit
- 等待用户拍板 v0.1.3 范围
