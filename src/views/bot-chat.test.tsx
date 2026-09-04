// v0.4.0 — Bot Chat store + view tests (跟 chat-input.test.tsx 1:1 配对
// 渲染 + store 模式, 跟 mavis MEMORY 30-34 行 "三件套 + Verified badge input
// 变更时重置" 1:1 配对).
//
// 5 test 跟 plan §1.1 1:1 配对:
//   1. 单聊 (default 3 peer + addUserMessage)
//   2. 群组 (setPeers cap 6)
//   3. peer 集成 (routeMockReply mention 路由)
//   4. 消息持久 (mount + send + finishBotStream 流程, 0 实际 Tauri invoke)
//   5. 错误处理 (empty input + 重入保护)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import {
  botChatStore,
  __testing,
  type BotMessage,
} from "./bot-chat/bot-chat-store";
import { BotChatView } from "./bot-chat/BotChatView";

function mountBotChat() {
  const host = document.createElement("div");
  host.id = "messages";
  document.body.appendChild(host);
  render(<BotChatView />, host);
  return host;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  botChatStore.__resetForTests();
  // 清理 DOM 挂载点
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("botChatStore (data layer)", () => {
  it("default 3 peer (researcher / coder / tester) — 1:1 配对 plan §1.1", () => {
    const s = botChatStore.get();
    expect(s.peers).toHaveLength(3);
    expect(s.peers.map((p) => p.mention)).toEqual(["researcher", "coder", "tester"]);
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBeNull();
  });

  it("setPeers caps at 6 (跟 plan §1.1 群组简版 1:1 配对, 跟 mavis UX 倒退审计 1:1 silent cap)", () => {
    botChatStore.setPeers(
      Array.from({ length: 8 }, (_, i) => ({
        id: `bot-${i}`,
        mention: `bot${i}`,
        name: `Bot ${i}`,
        role: "general" as const,
      })),
    );
    const s = botChatStore.get();
    expect(s.peers).toHaveLength(__testing.MAX_GROUP_SIZE);
    expect(s.peers[0].id).toBe("bot-0");
    expect(s.peers[5].id).toBe("bot-5");
  });

  it("addUserMessage trims empty + auto-parses mentions (跟 plan §1.1 @ mention 1:1, 0 改 caller 协议)", () => {
    const empty = botChatStore.addUserMessage("   ");
    expect(empty).toBeNull();

    const msg = botChatStore.addUserMessage("hello @researcher and @coder");
    expect(msg).not.toBeNull();
    expect(msg!.mentions).toEqual(["researcher", "coder"]);
    expect(botChatStore.get().messages).toHaveLength(1);

    // dedup: same mention twice → only one entry
    const dup = botChatStore.addUserMessage("ping @tester @tester");
    expect(dup!.mentions).toEqual(["tester"]);
  });

  it("routeMockReply routes to first mention or default peer (跟 plan §1.1 1:1, first match wins 走 state.peers 顺序)", () => {
    expect(botChatStore.routeMockReply([])).toBe("researcher");
    expect(botChatStore.routeMockReply(["coder"])).toBe("coder");
    // [tester, researcher] → state.peers.find 在 researcher 顺序在前 → researcher
    // (跟 mavis 4 件套 "first match wins" 1:1 配对, 0 按 mentions 数组顺序)
    expect(botChatStore.routeMockReply(["tester", "researcher"])).toBe("researcher");
    expect(botChatStore.routeMockReply([], "coder")).toBe("coder"); // explicit peer
    expect(botChatStore.routeMockReply(["unknown"])).toBe("researcher"); // fallback to first peer
  });

  it("streaming flow: startBotStream → appendBotChunk → finishBotStream (跟 chat-view-store 1:1)", () => {
    botChatStore.startBotStream("coder");
    expect(botChatStore.get().isLoading).toBe(true);
    expect(botChatStore.get().streaming?.peerId).toBe("coder");

    botChatStore.appendBotChunk("hel");
    botChatStore.appendBotChunk("lo!");
    expect(botChatStore.get().streaming?.content).toBe("hello!");

    botChatStore.finishBotStream();
    const s = botChatStore.get();
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.messages).toHaveLength(1);
    const finalMsg = s.messages[0] as BotMessage;
    expect(finalMsg.from).toBe("coder");
    expect(finalMsg.content).toBe("hello!");
  });
});

describe("<BotChatView /> (render shell)", () => {
  it("renders empty-state Card when no messages (跟 mavis UX 倒退审计 1:1 配对, 0 改 chat-view 现有 happy path)", () => {
    const host = mountBotChat();
    const empty = host.querySelector('[data-testid="bot-chat-messages"]');
    expect(empty?.textContent).toContain("Start a conversation");
  });

  it("input + send button + 3 peer badges render (跟 plan §1.1 1:1)", () => {
    const host = mountBotChat();
    const input = host.querySelector('[data-testid="bot-chat-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toContain("@researcher");
    // 1 Send button (跟 plan §1.1 轻量 1:1 配对, 0 抄 Discord 风格 0 多 button)
    const buttons = host.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    // 3 peer badges (跟 plan §1.1 1:1)
    const badges = Array.from(host.querySelectorAll("span")).filter((s) =>
      s.textContent?.startsWith("@"),
    );
    expect(badges.length).toBeGreaterThanOrEqual(3);
  });

  it("send routes @researcher message and finalizes streaming bubble (mock reply, 0 Tauri invoke)", async () => {
    vi.useFakeTimers();
    const host = mountBotChat();
    const input = host.querySelector('[data-testid="bot-chat-input"]') as HTMLInputElement;
    const sendBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Send",
    ) as HTMLButtonElement;

    // type + send
    await act(async () => {
      setNativeInputValue(input, "hello @researcher");
    });
    await act(async () => {
      sendBtn.click();
    });

    // user message persisted
    const s1 = botChatStore.get();
    expect(s1.messages).toHaveLength(1);
    expect(s1.messages[0].from).toBe("user");
    expect(s1.messages[0].mentions).toEqual(["researcher"]);
    expect(s1.streaming?.peerId).toBe("researcher");

    // advance timers to drive mock reply (setInterval 500ms / reply.length chunks)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const s2 = botChatStore.get();
    expect(s2.streaming).toBeNull();
    expect(s2.isLoading).toBe(false);
    // 2 messages: user + researcher echo reply
    expect(s2.messages).toHaveLength(2);
    expect(s2.messages[1].from).toBe("researcher");
    expect(s2.messages[1].content).toContain("echo: hello @researcher");
  });

  it("empty input is rejected (跟 mavis UX 倒退审计 1:1 配对 0 改 happy path 0 误触发)", () => {
    const host = mountBotChat();
    const sendBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Send",
    ) as HTMLButtonElement;
    // empty input → send button disabled
    expect(sendBtn.disabled).toBe(true);
    // store 0 messages
    expect(botChatStore.get().messages).toHaveLength(0);
  });

  it("re-entrancy: while streaming, send is disabled (跟 mavis 4 件套 1:1 配对 0 重入 risk)", () => {
    // store level 1:1 verify (跟 mavis "后端先调查" 1:1 配对 — store 0 通过 DOM verify)
    botChatStore.startBotStream("researcher");
    expect(botChatStore.get().isLoading).toBe(true);

    const host = mountBotChat();
    // 0 empty draft, isLoading=true → send button disabled
    const sendBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Send" || b.textContent === "...",
    ) as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);
    // input also disabled
    const input = host.querySelector('[data-testid="bot-chat-input"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
