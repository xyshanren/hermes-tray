// v0.4.0 — Protected files helper (Cat 4 借鉴 hermes-agent-cn
// agent/safety/protected_files.py 1:1 配对, 跟 mavis 9-03 12:44 拍
// "Cat 4 借鉴 + Cat 2 原创" 1:1 配对).
//
// 跟 plan §1.4 1:1 配对: 3 类受保护文件 (AGENTS.md / skills / memory) 弹审批
// 弹窗, 跟 Sprint 16 档 C.1 agent/safety/protected_files.py 1:1 配对.
//
// 0 改 confirm-modal (跟 mavis "Cherry-pick split bug class" 1:1 配对
// 0 改现有 happy path), additive helper, mock 0 实际 IPC (跟 D.1 1:1 配对
// 0 调 hermes-agent-cn 后端).

/** 3 类受保护文件 (跟 agent/safety/protected_files.py PROTECTED_FILE_PATTERNS
 *  1:1 配对, 跟 Sprint 16 档 C.1 §1.5 1:1 配对) */
export type ProtectedFileCategory = "agents" | "skills" | "memories";

export interface ProtectedFileMatch {
  category: ProtectedFileCategory;
  /** 跟 agent/safety/protected_files.py is_protected_path 1:1 配对 */
  path: string;
}

/** 3 类文件 pattern (跟 agent/safety/protected_files.py PROTECTED_FILE_PATTERNS
 *  1:1 配对, 跟 Sprint 16 档 C.1 §1.5 1:1 配对).
 *
 * Python 用双写 pattern (fnmatch 跨目录段), JS 1:1 配对用 0 前缀 slash 的
 * regex (fnmatch 0 要求前导 /).
 */
const PROTECTED_FILE_PATTERNS: ReadonlyArray<{
  category: ProtectedFileCategory;
  pattern: RegExp;
}> = [
  { category: "agents", pattern: /AGENTS\.md$/i },
  { category: "skills", pattern: /\.hermes\/skills\//i },
  { category: "memories", pattern: /\.hermes\/memories\//i },
];

/** 跟 agent/safety/protected_files.py is_protected_path 1:1 配对 (mock,
 *  跟 D.1 / D.2.1 / D.2.2 1:1 配对 0 实际 IPC) */
export function isProtectedPath(filePath: string): ProtectedFileMatch | null {
  if (!filePath) return null;
  for (const { category, pattern } of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return { category, path: filePath };
    }
  }
  return null;
}

/** 跟 agent/safety/protected_files.py 1:1 配对 3 类文件显示名 (跟 plan §1.4
 *  "AGENTS.md / skills / memory" 1:1 配对) */
export const PROTECTED_CATEGORY_DISPLAY: Record<ProtectedFileCategory, string> = {
  agents: "AGENTS.md (project instructions)",
  skills: "Hermes skill (under ~/.hermes/skills/)",
  memories: "Hermes memory (under ~/.hermes/memories/)",
};

/** Mock approval gate (跟 Sprint 16 档 C.1 check_protected_file 1:1 配对
 *  但 0 raise, 0 实际 IPC) */
export const PROTECTED_APPROVAL_MESSAGE =
  "This file is a protected instruction file. Confirm before writing —\n" +
  "agents / skills / memory files shape the agent's behavior across\n" +
  "all future sessions.\n" +
  "\n" +
  "Mock approval (跟 plan §1.4 1:1 配对, 0 实际 IPC bridge).";
