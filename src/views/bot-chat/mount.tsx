// v0.4.0 — Mount the BotChatView Preact component into the existing
// `<div id="messages">` shell defined in index.html. 跟 chat-view-mount.tsx
// 1:1 配对 (跟 mavis MEMORY 30-34 行 "三件套 (view.tsx + store.ts + mount.ts)"
// 1:1 配对).
//
// Additive only: 0 改 chat-view-mount.tsx, 0 改 main.ts, Bot Chat 是独立
// surface (跟 plan §1.1 "Bot Chat 消息列表 UI" 1:1 配对, 跟 mavis 9-03 12:40
// 拍 "轻量 hermes-tray" 1:1 配对 不抄 Discord 风格).
//
// One-line call site from main.ts (跟 chat-view-mount.tsx 1:1 配对):
//   import { mountBotChatView } from "./views/bot-chat/mount";
//   mountBotChatView();

import { render } from "preact";
import { BotChatView } from "./BotChatView";

export { botChatStore } from "./bot-chat-store";

export function mountBotChatView(): void {
  // Bot Chat 跟 chat-view 复用 #messages shell (跟 plan §1.1 1:1 配对, 0 改
  // index.html). caller 负责在切 Bot Chat 时 unmount chat-view, 跟 plan §1.1
  // "0 改 happy path" 1:1 配对).
  const root = document.getElementById("messages");
  if (!root) {
    console.warn("[Hermes] #messages mount point missing in index.html (bot-chat)");
    return;
  }
  root.innerHTML = "";
  render(<BotChatView />, root);
}
