// v0.2-alpha-19 — Build OpenAI-compatible multimodal content.
//
// Pure function extracted from main.ts in alpha-19 so the chat-stream
// module can call it without depending on main.ts. Behaviour is
// unchanged — see src/multimodal.test.ts (9 cases) for the contract.
//
// - text-only: returns the same string (cheap path)
// - text + 1+ images: returns an array with a text part + image_url parts
// - images only (empty text): returns an array with only image parts

import type { PendingAttachment } from "../views/chat-view-store";

export type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildMultimodalContent(
  text: string,
  attachments: PendingAttachment[],
): string | MultimodalContentPart[] {
  if (attachments.length === 0) return text;
  const parts: MultimodalContentPart[] = [];
  if (text.length > 0) parts.push({ type: "text", text });
  for (const a of attachments) {
    parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
  }
  return parts;
}