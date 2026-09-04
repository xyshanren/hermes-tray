// v0.4.0 — Training tier warning tests (跟 plan §1.3 "2 test: tier 0 0 警告 /
// tier 1-2 警告" 1:1 配对, 跟 mavis MEMORY 30-34 行 1:1 配对).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import {
  getProviderTier,
  requiresDataTrainingWarning,
  DATA_TRAINING_WARNING_MESSAGE,
} from "../lib/dataTrainingTier";
import { TrainingTierWarning } from "./TrainingTierWarning";
// 跟 peer-dm.test.tsx / bot-chat.test.tsx 1:1 配对 (避免循环依赖, helper 在 lib/)

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("dataTrainingTier (helper)", () => {
  it("国内 5 厂商默认 tier 0 (跟 mavis 9-03 12:35 国内方案 1:1 配对)", () => {
    expect(getProviderTier("deepseek")).toBe(0);
    expect(getProviderTier("qwen")).toBe(0);
    expect(getProviderTier("glm")).toBe(0);
    expect(getProviderTier("minimax")).toBe(0);
    expect(getProviderTier("kimi")).toBe(0);
  });

  it("国外付费默认 tier 1 (opt-out 默认, 0 警告)", () => {
    expect(getProviderTier("openai")).toBe(1);
    expect(getProviderTier("anthropic")).toBe(1);
    expect(getProviderTier("google")).toBe(1);
  });

  it("0 已知 provider 默认 tier 1 (跟 mavis UX 倒退审计 1:1 配对 0 误警告)", () => {
    expect(getProviderTier("unknown-vendor")).toBe(1);
    expect(getProviderTier("")).toBe(1);
  });

  it("requiresDataTrainingWarning 仅 tier 2 返回 true (跟 plan §1.3 1:1)", () => {
    expect(requiresDataTrainingWarning("deepseek")).toBe(false);
    expect(requiresDataTrainingWarning("openai")).toBe(false);
    expect(requiresDataTrainingWarning("anthropic")).toBe(false);
  });

  it("DATA_TRAINING_WARNING_MESSAGE 包含关键警告 (跟 upstream 1:1 配对结构)", () => {
    expect(DATA_TRAINING_WARNING_MESSAGE).toContain("train future models");
    expect(DATA_TRAINING_WARNING_MESSAGE).toContain("sensitive data");
  });
});

describe("<TrainingTierWarning /> (UI modal)", () => {
  it("tier 0 (deepseek) 不渲染 modal (跟 plan §1.3 tier 0 0 警告 1:1, 跟 mavis UX 倒退审计 1:1)", () => {
    render(
      <TrainingTierWarning
        provider="deepseek"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      document.body,
    );
    expect(document.querySelector('[data-testid="training-tier-warning"]')).toBeNull();
  });

  it("tier 1 (openai) 不渲染 modal (跟 plan §1.3 1:1, 国外付费 0 警告)", () => {
    render(
      <TrainingTierWarning
        provider="openai"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      document.body,
    );
    expect(document.querySelector('[data-testid="training-tier-warning"]')).toBeNull();
  });
});
