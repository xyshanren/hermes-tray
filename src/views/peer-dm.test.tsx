// v0.4.0 — Peer DM store + view tests (跟 bot-chat.test.tsx 1:1 配对
// vitest + preact render + setNativeInputValue pattern, 跟 mavis MEMORY 30-34
// 行 "三件套" 1:1 配对).
//
// 3 test 跟 plan §1.2 1:1 配对:
//   1. 单聊 (setPeer + send 1 peer only, 0 群组)
//   2. 跨 Gateway (gateway URL 显示 + 验证 Tailscale / VPN 1:1 配对)
//   3. 持久化 (loadMockHistory + hasPersistedHistory flag, 0 实际 IPC)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { peerDMStore, type PeerDMMessage } from "./peer-dm/peer-dm-store";
import { PeerDMView } from "./peer-dm/PeerDMView";

// v0.4.1: 视图 http(s) gateway 走 realPeerBridge — 组件测试 mock 掉模块
// (跟 api.test.ts vi.mock invoke 隔离 pattern 1:1 配对)
vi.mock("../lib/peer-bridge", () => ({
  realPeerBridge: { send: vi.fn() },
}));

import { realPeerBridge } from "../lib/peer-bridge";
const mockBridgeSend = vi.mocked(realPeerBridge.send);

const TEST_PEER = {
  id: "alpha",
  name: "Alpha",
  gateway: "http://100.64.0.1:9999", // Tailscale 100.64.0.0/10 私网段
};

/** 非 URL gateway — v0.4.1 语义下走 mock reply (跟 v0.4.0 行为 1:1 配对) */
const MOCK_PEER = {
  id: "alpha-mock",
  name: "Alpha",
  gateway: "peer-local://alpha",
};

function mountPeerDM() {
  const host = document.createElement("div");
  host.id = "messages";
  document.body.appendChild(host);
  render(<PeerDMView />, host);
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
  peerDMStore.__resetForTests();
  document.body.innerHTML = "";
  vi.useRealTimers();
  mockBridgeSend.mockReset();
});

describe("peerDMStore (data layer)", () => {
  it("initial state: 0 peer, 0 messages (跟 mavis 4 件套 0 改 happy path 1:1 配对)", () => {
    const s = peerDMStore.get();
    expect(s.peer).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.hasPersistedHistory).toBe(false);
  });

  it("setPeer + 单聊 streaming flow (跟 plan §1.2 1 peer only 1:1 配对, 跟 D.1 BotChat 1:1 配对)", () => {
    peerDMStore.setPeer(TEST_PEER);
    expect(peerDMStore.get().peer?.id).toBe("alpha");

    peerDMStore.addUserMessage("hi alpha");
    expect(peerDMStore.get().messages).toHaveLength(1);

    peerDMStore.startPeerStream();
    expect(peerDMStore.get().isLoading).toBe(true);
    peerDMStore.appendPeerChunk("hello");
    peerDMStore.appendPeerChunk(" back");
    expect(peerDMStore.get().streaming?.content).toBe("hello back");

    peerDMStore.finishPeerStream();
    const final = peerDMStore.get();
    expect(final.streaming).toBeNull();
    expect(final.isLoading).toBe(false);
    expect(final.messages).toHaveLength(2);
    expect(final.messages[1].from).toBe("peer");
  });

  it("切 peer 重置 streaming + messages (跟 mavis Verified badge input 变更时重置 1:1 配对)", () => {
    peerDMStore.setPeer(TEST_PEER);
    peerDMStore.addUserMessage("to alpha");
    peerDMStore.startPeerStream();
    expect(peerDMStore.get().isLoading).toBe(true);

    // 切 peer 应该清空 streaming + messages (跟 mavis 4 件套 0 串味 1:1 配对)
    peerDMStore.setPeer({ id: "beta", name: "Beta", gateway: "http://100.64.0.2:9999" });
    const s = peerDMStore.get();
    expect(s.peer?.id).toBe("beta");
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.messages).toEqual([]);
    expect(s.hasPersistedHistory).toBe(false); // 切 = 新会话
  });

  it("loadMockHistory 模拟持久化 (跟 plan §1.2 持久化 1:1 配对, mock 0 实际 IPC)", () => {
    peerDMStore.setPeer(TEST_PEER);
    const seed: PeerDMMessage[] = [
      { id: "h1", from: "user", content: "old msg 1", timestamp: new Date("2026-09-01") },
      { id: "h2", from: "peer", content: "old reply 1", timestamp: new Date("2026-09-01") },
    ];
    peerDMStore.loadMockHistory(seed);
    const s = peerDMStore.get();
    expect(s.messages).toHaveLength(2);
    expect(s.hasPersistedHistory).toBe(true);
  });

  it("empty input rejected (跟 D.1 BotChat 1:1 配对 0 改 happy path)", () => {
    peerDMStore.setPeer(TEST_PEER);
    const msg = peerDMStore.addUserMessage("   ");
    expect(msg).toBeNull();
    expect(peerDMStore.get().messages).toEqual([]);
  });
});

describe("<PeerDMView /> (render shell)", () => {
  it("无 peer 时显示 empty state Card + catalog picker (v0.4.1)", () => {
    const host = mountPeerDM();
    expect(host.querySelector('[data-testid="peer-dm-empty"]')).not.toBeNull();
    // catalog 空 → 引导去 Peer 管理
    expect(host.textContent).toContain("Peer 管理");
  });

  it("有 peer 时显示 gateway URL (跟 plan §1.2 跨 Gateway 1:1 配对, 跟 mavis 后端先调查 1:1 Tailscale 100.64/10 1:1)", () => {
    peerDMStore.setPeer(TEST_PEER);
    const host = mountPeerDM();
    const gw = host.querySelector('[data-testid="peer-dm-gateway"]');
    expect(gw?.textContent).toBe("http://100.64.0.1:9999");
  });

  it("loadMockHistory 后显示 history loaded badge (跟 plan §1.2 持久化 1:1 配对)", () => {
    peerDMStore.setPeer(TEST_PEER);
    peerDMStore.loadMockHistory([
      { id: "h1", from: "user", content: "old", timestamp: new Date() },
    ]);
    const host = mountPeerDM();
    expect(host.textContent).toContain("history loaded");
  });

  it("send 在 0 peer 时报 error (跟 mavis 4 件套 fail-fast 1:1 配对)", () => {
    // 0 setPeer, 直接 send
    const host = mountPeerDM();
    // 0 peer 时 input 0 渲染 (走 empty state), 0 input 可点
    expect(host.querySelector('[data-testid="peer-dm-input"]')).toBeNull();
  });

  it("有 peer + send 完整 mock reply 流程 (跟 D.1 BotChat 1:1 配对, 1 turn setPeer + send + finish)", async () => {
    vi.useFakeTimers();
    // v0.4.1: mock reply 只对非 URL gateway 生效 (http(s) gateway 走 bridge
    // 分支, 见下方 bridge path test — 跟 PeerDMView handleSend 分支 1:1 配对)
    peerDMStore.setPeer(MOCK_PEER);
    const host = mountPeerDM();
    const input = host.querySelector(
      '[data-testid="peer-dm-input"]',
    ) as HTMLInputElement;
    const sendBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Send",
    ) as HTMLButtonElement;

    await act(async () => {
      setNativeInputValue(input, "ping alpha");
    });
    await act(async () => {
      sendBtn.click();
    });

    const s1 = peerDMStore.get();
    expect(s1.messages).toHaveLength(1);
    expect(s1.messages[0].from).toBe("user");
    expect(s1.streaming).not.toBeNull();
    expect(s1.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const s2 = peerDMStore.get();
    expect(s2.streaming).toBeNull();
    expect(s2.isLoading).toBe(false);
    expect(s2.messages).toHaveLength(2);
    expect(s2.messages[1].from).toBe("peer");
    expect(s2.messages[1].content).toContain("[Alpha] echo: ping alpha");
  });

  it("v0.4.1: http(s) gateway → realPeerBridge bridge path (跟 peer_call 线上协议 1:1 配对)", async () => {
    peerDMStore.setPeer(TEST_PEER);
    mockBridgeSend.mockResolvedValueOnce({
      reply: "real a2a reply",
      contextId: "ctx-x",
      state: "completed",
    });
    const host = mountPeerDM();
    const input = host.querySelector(
      '[data-testid="peer-dm-input"]',
    ) as HTMLInputElement;
    const sendBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Send",
    ) as HTMLButtonElement;

    await act(async () => {
      setNativeInputValue(input, "ping alpha");
    });
    await act(async () => {
      sendBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockBridgeSend).toHaveBeenCalledTimes(1);
    expect(mockBridgeSend).toHaveBeenCalledWith(
      "http://100.64.0.1:9999",
      undefined,
      "ping alpha",
      undefined,
    );
    const s = peerDMStore.get();
    expect(s.messages.map((m) => [m.from, m.content])).toEqual([
      ["user", "ping alpha"],
      ["peer", "real a2a reply"],
    ]);
    expect(s.contextId).toBe("ctx-x");
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
  });
});
