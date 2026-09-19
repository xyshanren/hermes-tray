// v0.4.1 — App view switcher (chat / bot-chat / peer-dm).
//
// v0.4.0 的三个 surface 各自只有 mount 函数, main.ts 只挂 chat-view —
// bot-chat / peer-dm 在运行中的应用不可达 (mount 0 caller)。本模块补上
// 切换层:
//   - main.ts boot 时 mountChatView(actions) 照旧 (0 改现有 happy path),
//     再 registerChatActions(actions) 把 actions 交给本模块
//   - 侧栏 segmented 按钮 → switchView():
//       chat      → mountChatView(chatActions)  (从 chatStore 状态重挂)
//       bot-chat  → mountBotChatView()
//       peer-dm   → mountPeerDMView()
//
// Unmount 语义: Preact 的 container WeakMap 记着上次 render 的 vnode;
// mount 函数里的 root.innerHTML = "" 只清 DOM 不清 vnode 引用, 直接
// 再 render 会 diff 到 stale tree。切视图前先 render(null, root) 正规
// unmount 上一棵树 (目标 mount 自己再 wipe + render, 行为不变)。
//
// 按钮激活态: 约定 index.html 提供 #view-chat-btn / #view-botchat-btn /
// #view-peerdm-btn, 本模块直接 toggle .view-switch-active (跟 main.ts
// getElementById + addEventListener 既有 wiring 风格 1:1 配对)。

import { render } from "preact";
import { mountChatView, type ChatViewActions } from "./chat-view-mount";
import { mountBotChatView } from "./bot-chat/mount";
import { mountPeerDMView } from "./peer-dm/mount";

export type AppView = "chat" | "bot-chat" | "peer-dm";

const BUTTON_IDS: Record<AppView, string> = {
  chat: "view-chat-btn",
  "bot-chat": "view-botchat-btn",
  "peer-dm": "view-peerdm-btn",
};

let chatActions: ChatViewActions | undefined;
let current: AppView = "chat";

export function registerChatActions(actions: ChatViewActions): void {
  chatActions = actions;
}

export function getCurrentView(): AppView {
  return current;
}

function syncButtons(): void {
  for (const [view, id] of Object.entries(BUTTON_IDS) as Array<[AppView, string]>) {
    document.getElementById(id)?.classList.toggle("view-switch-active", view === current);
  }
}

/** 切换主区域视图 (同视图重复调用 = no-op, 0 重挂 0 闪屏) */
export function switchView(view: AppView): void {
  if (view === current) return;
  const root = document.getElementById("messages");
  if (!root) {
    console.warn("[Hermes] #messages mount point missing (view-switch)");
    return;
  }
  render(null, root);
  if (view === "chat") {
    mountChatView(chatActions);
  } else if (view === "bot-chat") {
    mountBotChatView();
  } else {
    mountPeerDMView();
  }
  current = view;
  syncButtons();
}

/** boot 时同步一次按钮激活态 (chat 默认) */
export function initViewSwitcher(): void {
  syncButtons();
}

/** Test-only: 硬重置 current 状态 (模块级, 跟其他 store 1:1 配对) */
export function __resetForTests(): void {
  current = "chat";
}
