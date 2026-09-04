// v0.4.0 — Protected files approval modal (跟 plan §1.4 1:1 配对, 跟
// confirm-modal pattern 1:1 配对, 跟 mavis MEMORY 30-34 行 1:1 配对).
//
// 跟 mavis 4 件套 1:1 配对:
// - 后端先调查 (memory:13-17): 1:1 配对 agent/safety/protected_files.py
//   3 类文件 pattern
// - UX 倒退审计 (memory:19-23): 非受保护文件 0 弹窗 0 干扰 happy path
// - Cherry-pick split bug (memory:7-11): 0 改 confirm-modal / write_file flow
// - Constitution 铁律: 0 改 upstream / 0 强制 block / 0 fail-fast

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  isProtectedPath,
  PROTECTED_CATEGORY_DISPLAY,
  PROTECTED_APPROVAL_MESSAGE,
  type ProtectedFileCategory,
} from "../lib/protectedFiles";

export interface ProtectedFilesApprovalProps {
  filePath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProtectedFilesApproval({
  filePath,
  onConfirm,
  onCancel,
}: ProtectedFilesApprovalProps) {
  const match = isProtectedPath(filePath);

  // 非受保护文件 → 0 弹窗 (跟 mavis "UX 倒退审计" 1:1 配对 0 改 happy path,
  // 跟 plan §1.4 1:1 配对 "其他 0 干扰")
  if (!match) return null;

  const category: ProtectedFileCategory = match.category;

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="protected-files-approval"
    >
      <Card class="max-w-md p-4">
        <h3 class="mb-2 text-lg font-semibold text-amber-700">
          ⚠ Protected File Approval
        </h3>
        <div class="mb-2 text-sm text-slate-500">
          Category: <code>{PROTECTED_CATEGORY_DISPLAY[category]}</code>
        </div>
        <div class="mb-2 text-xs text-slate-400">
          Path: <code data-testid="protected-files-path">{filePath}</code>
        </div>
        <pre
          class="mb-4 whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs"
          data-testid="protected-files-message"
        >
          {PROTECTED_APPROVAL_MESSAGE}
        </pre>
        <div class="flex justify-end gap-2">
          <Button
            onClick={onCancel}
            variant="outline"
            data-testid="protected-files-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            data-testid="protected-files-confirm"
          >
            Approve write
          </Button>
        </div>
      </Card>
    </div>
  );
}
