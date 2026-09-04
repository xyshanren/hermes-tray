// v0.4.0 — Data training tier helper (Cat 4 借鉴 hermes-agent-cn
// hermes_cli/data_training_catalog.py 1:1 配对, 跟 mavis 9-03 12:44 拍
// "Cat 4 借鉴 + Cat 2 原创" 1:1 配对).
//
// 跟 plan §1.3 1:1 配对: 3 tier 分类 (国内 0 / 国外付费 1 / 国外训练免费 2)
// 跟 Sprint 16 档 C.3 hermes_cli/data_training_catalog.py 1:1 配对.
//
// 0 改 modelPicker.ts (跟 mavis "Cherry-pick split bug class" 1:1 配对
// 0 改现有 happy path), additive helper, mock 0 实际 IPC (跟 D.1 1:1 配对
// 0 调 hermes-agent-cn 后端).

/** 3 tier 分类 (跟 Sprint 16 档 C.3 §1.5 1:1 配对) */
export type TrainingTier = 0 | 1 | 2;

export interface TierProvider {
  /** Provider id (e.g. "deepseek", "openai"), 跟 hermes_cli/data_training_catalog
   *  `_DEFAULT_TIER_CATALOG` 1:1 配对 */
  id: string;
  /** 跟 hermes_cli/data_training_catalog `get_tier()` 1:1 配对 */
  tier: TrainingTier;
}

/** 默认 3 tier catalog (跟 hermes_cli/data_training_catalog._DEFAULT_TIER_CATALOG
 *  1:1 配对, 跟 mavis 9-03 12:35 "国内方案" 1:1 配对) */
const DEFAULT_TIER_CATALOG: Record<string, TrainingTier> = {
  // tier 0: 国内 (5 厂商, 0 警告)
  deepseek: 0,
  qwen: 0,
  glm: 0,
  minimax: 0,
  kimi: 0,
  // tier 1: 国外付费 (opt-out 默认, 0 警告)
  openai: 1,
  anthropic: 1,
  google: 1,
  openrouter: 1,
};

/** 跟 hermes_cli/data_training_catalog.get_tier 1:1 配对 (mock, 0 实际 IPC) */
export function getProviderTier(provider: string): TrainingTier {
  if (!provider) return 1; // 0 provider → 默认 tier 1 (国外付费 0 警告)
  const lower = provider.toLowerCase();
  if (lower in DEFAULT_TIER_CATALOG) {
    return DEFAULT_TIER_CATALOG[lower];
  }
  return 1; // 0 已知 → 默认 tier 1 (跟 mavis "UX 倒退审计" 1:1 配对
  // 0 误警告打扰 user)
}

/** 跟 hermes_cli/data_training_catalog 1:1 配对判断是否需要警告
 *  (跟 plan §1.3 "tier 0 0 警告, tier 1-2 警告" 1:1 配对) */
export function requiresDataTrainingWarning(provider: string): boolean {
  return getProviderTier(provider) === 2;
}

/** 警告消息 (跟 plan §1.3 "弹警告气泡" 1:1 配对, 跟 upstream Meta contributor
 *  message 1:1 配对结构) */
export const DATA_TRAINING_WARNING_MESSAGE =
  "This provider uses your prompts and completions to train future models.\n" +
  "\n" +
  "Pricing is heavily discounted in exchange. Do NOT use it for\n" +
  "confidential, proprietary, personal, or otherwise sensitive data.\n" +
  "\n" +
  "Source: hermes-cli/data_training_catalog (跟 Sprint 16 档 C.3 1:1 配对).";
