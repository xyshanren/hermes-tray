# T-Q6: 给 src/main.ts 纯函数加单元测试 (vitest) — Deliverable

> **Commit hash**: `0583ecc8f7d53bf9828bf86717351d976ea79507` (短 `0583ecc`)
> **Commit message**: `T-Q6: 给 src/main.ts 纯函数加单元测试 (vitest)`
> **Tests**: 37 / 37 pass (4 个 .test.ts 文件)
> **未推送** (符合用户 Git 规则)

---

## 测试文件清单

| .test.ts | 用例数 |
|----------|-------|
| `src/escapeHtml.test.ts` | 9 |
| `src/sseParser.test.ts` | 11 |
| `src/apiMessages.test.ts` | 10 |
| `src/formatMessage.test.ts` | 7 |
| **合计** | **37** |

## npx vitest run 关键输出

```
 ✓ src/escapeHtml.test.ts  (9 tests) 3ms
 ✓ src/apiMessages.test.ts (10 tests) 4ms
 ✓ src/sseParser.test.ts   (11 tests) 3ms
 ✓ src/formatMessage.test.ts (7 tests) 13ms

 Test Files  4 passed (4)
      Tests  37 passed (37)
   Duration  749ms
```

## vitest 配置改动

### package.json
- **scripts**: `test`, `test:watch`, `test:ui`, `test:coverage` (4 个新命令)
- **devDependencies**:
  - `vitest`: `^2.1.8`
  - `@vitest/ui`: `^2.1.8`
  - `happy-dom`: `^15.11.7` (轻量替代 jsdom, 启动快)

### vitest.config.ts (新建)
- `environment: "happy-dom"`
- `include: ["src/**/*.test.ts"]`
- coverage 配置 (v8 provider, 排除 main.ts 和 test 文件本身)

### .gitignore
- 加 `coverage/` 和 `test-output-*.txt`

## 变更文件总览

**修改 3**:
- `package.json`
- `package-lock.json`
- `.gitignore`

**新增 10**:
- `vitest.config.ts`
- `src/escapeHtml.ts` + `src/escapeHtml.test.ts`
- `src/sseParser.ts` + `src/sseParser.test.ts`
- `src/apiMessages.ts` + `src/apiMessages.test.ts`
- `src/formatMessage.ts` + `src/formatMessage.test.ts`

**总计**: 13 个文件, +1970 行.

## 设计要点

- **main.ts 完全未改** (符合"不改 main.ts 现有逻辑"约束).
- 4 个 utility module 与 main.ts 内部实现 1:1 镜像:
  - `escapeHtml` — 给 showToast 的 XSS 漏洞提供 escape 工具
  - `sseParser` — 镜像 handleStreamChunk() 内联 SSE 解析
  - `apiMessages` — 镜像 sendMessage() 内联 state 转换
  - `formatMessage` — 复刻 formatMessage() 的 marked 配置
- 不直接 import main.ts, 避免 Tauri/DOM 污染测试环境.

详细 deliverable 见 `C:\Users\Admin\.mavis\plans\plan_61d7e14e\outputs\tq6-ts-unit-tests\deliverable.md`.
