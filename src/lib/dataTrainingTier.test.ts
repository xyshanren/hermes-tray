// v0.4.1 — data training tier catalog 防漂移测试。
//
// gateway /v1/models 只广播虚拟模型名 (2026-09-19 grep data_training 0 命中),
// tray 走静态 catalog (跟 hermes-agent-cn hermes_cli/data_training_catalog
// ._DEFAULT_TIER_CATALOG 1:1, 同步源 v0.21.0+cn.2 Sprint 16 档 C.3)。
// 本测试把 catalog 值钉死: agent-cn 源变更或 tray 侧手改时必须显式更新这里
// (跟 AGENTS.md 教训 ② "列出所有状态" 同款防护 — 漂移 = 静默错误分档)。

import { describe, it, expect } from "vitest";
import { DEFAULT_TIER_CATALOG, getProviderTier, requiresDataTrainingWarning } from "./dataTrainingTier";

describe("DEFAULT_TIER_CATALOG pinning (同步源 v0.21.0+cn.2)", () => {
  it("catalog 全量钉死 — 改动必须显式更新本测试 + 注明 agent-cn 同步源", () => {
    expect(DEFAULT_TIER_CATALOG).toEqual({
      // tier 0: 国内 5 厂商
      deepseek: 0,
      qwen: 0,
      glm: 0,
      minimax: 0,
      kimi: 0,
      // tier 1: 国外付费
      openai: 1,
      anthropic: 1,
      google: 1,
      openrouter: 1,
    });
  });

  it("未收录 provider / 空 provider → 默认 tier 1, 0 警告 (UX 倒退审计)", () => {
    expect(getProviderTier("")).toBe(1);
    expect(getProviderTier("unknown-provider")).toBe(1);
    expect(getProviderTier("deepseek")).toBe(0);
    expect(getProviderTier("DeepSeek")).toBe(0); // 大小写归一
    expect(requiresDataTrainingWarning("openai")).toBe(false);
    expect(requiresDataTrainingWarning("deepseek")).toBe(false);
  });
});
