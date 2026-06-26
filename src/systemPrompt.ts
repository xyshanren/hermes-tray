/**
 * System prompt composition (T-Q-S8).
 *
 * Combines the persona's `system_prompt` (T-Q-S7) with the cached
 * project context (T-Q-S8) into a single system-role message that's
 * prepended to the OpenAI-compatible /v1/chat/completions request.
 *
 * Pure function so it's unit-testable without DOM/Tauri.
 */

export interface PersonaLike {
  /** Assistant role's system prompt. Empty string is treated as "no persona". */
  system_prompt: string;
  /** Optional avatar/name for the visible header in some UIs. */
  name?: string;
}

export interface ProjectContextLike {
  /** Display name (e.g. "hermes-tray"). */
  name: string;
  /** Optional version string. */
  version?: string | null;
  /** Optional description from the manifest. */
  description?: string | null;
  /** Pre-rendered markdown summary (already ≤4KB on the Rust side). */
  summary_markdown: string;
  /** Absolute path on disk. */
  project_dir: string;
}

/**
 * Render the final system-prompt content for a chat completion.
 *
 * Priority:
 *   1. If `persona` is given AND has non-empty `system_prompt`, it goes
 *      first. Otherwise we skip the persona block.
 *   2. If `project` is given, append a `## Project Context` block with
 *      the pre-rendered summary.
 *
 * Returns `null` when neither source is present (caller should NOT
 * inject a system message at all in that case — saves tokens).
 *
 * The divider is a single horizontal rule; we pick `\n\n---\n\n` for
 * maximum model-friendliness (works across Claude / GPT / DeepSeek).
 */
export function composeSystemPrompt(
  persona: PersonaLike | null,
  project: ProjectContextLike | null,
): string | null {
  const personaText = persona?.system_prompt?.trim() ?? "";
  const hasPersona = personaText.length > 0;
  const hasProject = project !== null && project.summary_markdown.trim().length > 0;

  if (!hasPersona && !hasProject) return null;

  const blocks: string[] = [];
  if (hasPersona) blocks.push(personaText);
  if (hasProject && project) {
    const projectBlock = renderProjectBlock(project);
    if (projectBlock) blocks.push(projectBlock);
  }

  // After gathering, the project block could have been an empty string
  // (e.g. project given but summary was empty AND no description/version).
  // In that edge case, return just the persona if present, else null.
  if (blocks.length === 0) return null;
  return blocks.join("\n\n---\n\n");
}

/**
 * Render the `## Project Context` block. Returns empty string if the
 * project has nothing useful to say (no name, no summary, no version,
 * no description) — caller should treat empty as "skip this block".
 */
function renderProjectBlock(p: ProjectContextLike): string {
  const lines: string[] = ["## Project Context"];
  if (p.name) lines.push("");
  if (p.name) lines.push(`**Project**: ${p.name}${p.version ? ` v${p.version}` : ""}`);
  if (p.description) {
    lines.push("");
    lines.push(p.description);
  }
  if (p.project_dir) {
    lines.push("");
    lines.push(`**Path**: \`${p.project_dir}\``);
  }
  if (p.summary_markdown) {
    lines.push("");
    lines.push(p.summary_markdown);
  }
  // If the only thing we managed to render was the heading itself, bail.
  if (lines.length <= 1) return "";
  return lines.join("\n");
}

/**
 * Build the full API message array for a chat completion request,
 * prepending the composed system message if non-null.
 *
 * Mirrors the inline logic in main.ts's sendMessage(), extracted here
 * for testability.
 */
export function buildAPIMessagesWithSystem(
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  systemContent: string | null,
  maxHistory: number = 10,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const trimmed = userMessages.slice(-maxHistory);
  if (systemContent === null) {
    return trimmed;
  }
  return [{ role: "system", content: systemContent }, ...trimmed];
}
