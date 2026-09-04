// v0.4.0 — Training Tier Warning component (跟 plan §1.3 1:1 配对, 跟
// confirm-modal 1:1 配对 modal 模式, 跟 mavis MEMORY 30-34 行 1:1 配对).
//
// 跟 mavis 4 件套 1:1 配对:
// - 后端先调查 (memory:13-17): 1:1 配对 hermes_cli/data_training_catalog.py
//   tier 0/1/2 分类, 0 重新发明
// - UX 倒退审计 (memory:19-23): tier 0/1 0 弹窗 0 干扰 happy path
// - Cherry-pick split bug (memory:7-11): 0 改 confirm-modal / modelPicker
// - Constitution 铁律: 0 改 upstream / 0 强制 block / 0 fail-fast

import { useState } from "preact/hooks";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  requiresDataTrainingWarning,
  DATA_TRAINING_WARNING_MESSAGE,
  getProviderTier,
  type TrainingTier,
} from "../lib/dataTrainingTier";

export interface TrainingTierWarningProps {
  provider: string;
  /** 一次性确认 (跟 plan §1.3 "一次性确认" 1:1 配对, 跟 confirm-modal 1:1 配对).
   *  返回 true = 继续, false = 取消. */
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal 弹窗: tier 2 警告 (跟 plan §1.3 "弹警告气泡" 1:1 配对) */
export function TrainingTierWarning({
  provider,
  onConfirm,
  onCancel,
}: TrainingTierWarningProps) {
  const [confirmed, setConfirmed] = useState(false);
  const tier: TrainingTier = getProviderTier(provider);

  if (!requiresDataTrainingWarning(provider)) {
    // tier 0/1: 0 弹窗, 直接 confirm (跟 mavis "UX 倒退审计" 1:1 配对
    // 0 改 happy path, 跟 plan §1.3 "tier 0 0 警告" 1:1 配对)
    if (!confirmed) {
      setConfirmed(true);
      // 不在这里调 onConfirm — 留给 caller 显式 confirm, 跟 confirm-modal
      // 1:1 配对显式确认
    }
    return null;
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="training-tier-warning"
    >
      <Card class="max-w-md p-4">
        <h3 class="mb-2 text-lg font-semibold text-red-700">
          ⚠ Data Training Tier Warning
        </h3>
        <div class="mb-2 text-sm text-slate-500">
          Provider: <code>{provider}</code> (tier {tier})
        </div>
        <pre
          class="mb-4 whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs"
          data-testid="training-tier-message"
        >
          {DATA_TRAINING_WARNING_MESSAGE}
        </pre>
        <div class="flex justify-end gap-2">
          <Button
            onClick={onCancel}
            variant="outline"
            data-testid="training-tier-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            data-testid="training-tier-confirm"
          >
            I understand, continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
