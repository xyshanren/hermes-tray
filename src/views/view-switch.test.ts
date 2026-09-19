// v0.4.1 — view-switch tests (mock 三个 mount 模块, 隔离真实 view 渲染;
// 跟 peer-catalog.test.ts 的 vi.mock 隔离 pattern 1:1 配对)。
//
// 断言: mount 调用序列 / 同视图 no-op / render(null) unmount / 按钮激活态。

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./chat-view-mount", () => ({
  mountChatView: vi.fn(),
}));
vi.mock("./bot-chat/mount", () => ({
  mountBotChatView: vi.fn(),
  botChatStore: { setPeers: vi.fn() },
}));
vi.mock("./peer-dm/mount", () => ({
  mountPeerDMView: vi.fn(),
  peerDMStore: {},
}));

import { mountChatView } from "./chat-view-mount";
import { mountBotChatView } from "./bot-chat/mount";
import { mountPeerDMView } from "./peer-dm/mount";
import {
  registerChatActions,
  getCurrentView,
  switchView,
  initViewSwitcher,
  __resetForTests,
} from "./view-switch";

// view-switch 模块级 current 状态隔离: 每个 test 前手动切回 chat
// (switchView("chat") 当 current="chat" 时 no-op — 但 mount mock 是
// vi.fn, 我们只关心调用序列; 用 __resetForTests 导出做硬隔离)
// 注: view-switch 导出 __resetForTests 供测试硬重置 current。

const mockMountChat = vi.mocked(mountChatView);
const mockMountBot = vi.mocked(mountBotChatView);
const mockMountDM = vi.mocked(mountPeerDMView);

function ensureButtons() {
  if (!document.getElementById("messages")) {
    const root = document.createElement("div");
    root.id = "messages";
    document.body.appendChild(root);
  }
  for (const id of ["view-chat-btn", "view-botchat-btn", "view-peerdm-btn"]) {
    if (!document.getElementById(id)) {
      const b = document.createElement("button");
      b.id = id;
      document.body.appendChild(b);
    }
  }
}

beforeEach(() => {
  mockMountChat.mockClear();
  mockMountBot.mockClear();
  mockMountDM.mockClear();
  document.body.innerHTML = "";
  ensureButtons();
  __resetForTests();
});

describe("view-switch", () => {
  it("初始 current = chat; initViewSwitcher 同步按钮激活态", () => {
    initViewSwitcher();
    expect(getCurrentView()).toBe("chat");
    expect(document.getElementById("view-chat-btn")?.classList.contains("view-switch-active")).toBe(
      true,
    );
    expect(
      document.getElementById("view-botchat-btn")?.classList.contains("view-switch-active"),
    ).toBe(false);
  });

  it("switchView bot-chat → mountBotChatView + 激活态迁移; 切回 chat 重挂 chatActions", () => {
    const actions = { onCreateSession: () => {} };
    registerChatActions(actions);
    initViewSwitcher();

    switchView("bot-chat");
    expect(mockMountBot).toHaveBeenCalledTimes(1);
    expect(getCurrentView()).toBe("bot-chat");
    expect(
      document.getElementById("view-botchat-btn")?.classList.contains("view-switch-active"),
    ).toBe(true);

    switchView("peer-dm");
    expect(mockMountDM).toHaveBeenCalledTimes(1);

    switchView("chat");
    expect(mockMountChat).toHaveBeenCalledTimes(1);
    expect(mockMountChat).toHaveBeenCalledWith(actions);
    expect(getCurrentView()).toBe("chat");
  });

  it("同视图重复 switch = no-op (0 重挂 0 闪屏)", () => {
    initViewSwitcher();
    switchView("chat");
    switchView("chat");
    expect(mockMountChat).not.toHaveBeenCalled();
    switchView("bot-chat");
    switchView("bot-chat");
    expect(mockMountBot).toHaveBeenCalledTimes(1);
  });
});
