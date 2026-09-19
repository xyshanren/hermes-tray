// v0.4.1 — store × bridge 集成 tests (跟 lib/peer-bridge.test.ts 协议测试
// 分层 1:1 配对): fake bridge 注入 (dependency injection, 跟 api.test.ts
// vi.mock 隔离 pattern 1:1 配对), 断言 store 状态机 — user 消息落位 /
// streaming 起止 / contextId 续聊 / 错误 abort (fail-fast 0 静默) / 无 URL
// fallback 0 状态突变。

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { peerDMStore } from "./peer-dm-store";
import { botChatStore } from "../bot-chat/bot-chat-store";
import type { PeerBridgeLike, PeerSendResult } from "../../lib/peer-bridge";

function fakeBridge(
  impl: (url: string, token: string | undefined, text: string, ctx?: string) => Promise<PeerSendResult>,
): PeerBridgeLike & { calls: Array<{ url: string; token: string | undefined; text: string; ctx?: string }> } {
  const calls: Array<{ url: string; token: string | undefined; text: string; ctx?: string }> = [];
  return {
    calls,
    send: vi.fn(async (url, token, text, ctx) => {
      calls.push({ url, token, text, ctx });
      return await impl(url, token, text, ctx);
    }),
  };
}

beforeEach(() => {
  peerDMStore.__resetForTests();
  botChatStore.__resetForTests();
});

describe("peerDMStore.sendViaBridge", () => {
  it("sends via bridge, records reply + contextId for multi-turn", async () => {
    peerDMStore.setPeer({ id: "p1", name: "Coder", gateway: "http://10.0.0.2:9999" });
    const bridge = fakeBridge(async (_url, _token, text) => ({
      reply: `echo: ${text}`,
      contextId: "ctx-remote-1",
      state: "completed",
    }));

    const handled = await peerDMStore.sendViaBridge("帮我跑测试", bridge);
    expect(handled).toBe(true);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]).toMatchObject({
      url: "http://10.0.0.2:9999",
      text: "帮我跑测试",
    });

    const s = peerDMStore.get();
    expect(s.messages.map((m) => [m.from, m.content])).toEqual([
      ["user", "帮我跑测试"],
      ["peer", "echo: 帮我跑测试"],
    ]);
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.contextId).toBe("ctx-remote-1");

    // 第二轮: contextId 回传 (跟 a2a_call context_id 续聊 1:1)
    await peerDMStore.sendViaBridge("第二轮", bridge);
    expect(bridge.calls[1].ctx).toBe("ctx-remote-1");
  });

  it("passes peer token to bridge", async () => {
    peerDMStore.setPeer({
      id: "p1",
      name: "Coder",
      gateway: "http://p",
      token: "sk-peer",
    });
    const bridge = fakeBridge(async () => ({ reply: "ok", contextId: "ctx-1", state: "" }));
    await peerDMStore.sendViaBridge("hi", bridge);
    expect(bridge.calls[0].token).toBe("sk-peer");
  });

  it("on bridge failure: aborts stream, sets error, keeps user msg retryable", async () => {
    peerDMStore.setPeer({ id: "p1", name: "Coder", gateway: "http://p" });
    const bridge = fakeBridge(async () => {
      throw new Error("Peer 'http://p' 拒绝了鉴权 (HTTP 403)。");
    });

    const handled = await peerDMStore.sendViaBridge("hi", bridge);
    expect(handled).toBe(true);
    const s = peerDMStore.get();
    expect(s.messages).toHaveLength(1); // user msg 保留可重试
    expect(s.messages[0].from).toBe("user");
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toContain("403");
    expect(s.contextId).toBeNull();
  });

  it("returns false without peer (caller fallback, 0 状态突变)", async () => {
    const bridge = fakeBridge(async () => ({ reply: "x", contextId: "", state: "" }));
    expect(await peerDMStore.sendViaBridge("hi", bridge)).toBe(false);
    expect(peerDMStore.get().messages).toEqual([]);
    expect(bridge.calls).toHaveLength(0);
  });

  it("setPeer resets contextId (切 peer 0 串味, 跟 mavis 重置 lesson 1:1)", async () => {
    peerDMStore.setPeer({ id: "p1", name: "A", gateway: "http://a" });
    const bridge = fakeBridge(async () => ({ reply: "r", contextId: "ctx-a", state: "" }));
    await peerDMStore.sendViaBridge("hi", bridge);
    expect(peerDMStore.get().contextId).toBe("ctx-a");

    peerDMStore.setPeer({ id: "p2", name: "B", gateway: "http://b" });
    expect(peerDMStore.get().contextId).toBeNull();
  });
});

describe("botChatStore.trySendViaBridge", () => {
  it("routes via mention to url-configured bot and records per-bot contextId", async () => {
    botChatStore.setPeers([
      { id: "researcher", mention: "researcher", name: "Researcher", role: "researcher" },
      {
        id: "coder",
        mention: "coder",
        name: "Coder",
        role: "coder",
        url: "http://10.0.0.2:9999",
      },
    ]);
    const bridge = fakeBridge(async () => ({
      reply: "coder reply",
      contextId: "ctx-coder-1",
      state: "completed",
    }));

    const handled = await botChatStore.trySendViaBridge("@coder 帮我修 bug", bridge);
    expect(handled).toBe(true);
    expect(bridge.calls[0].url).toBe("http://10.0.0.2:9999");
    expect(bridge.calls[0].text).toBe("@coder 帮我修 bug");

    const s = botChatStore.get();
    expect(s.messages.map((m) => [m.from, m.content])).toEqual([
      ["user", "@coder 帮我修 bug"],
      ["coder", "coder reply"],
    ]);
    expect(s.contextIds.coder).toBe("ctx-coder-1");

    // 第二轮 @coder: contextId 续聊
    await botChatStore.trySendViaBridge("@coder 再来", bridge);
    expect(bridge.calls[1].ctx).toBe("ctx-coder-1");
  });

  it("returns false when routed bot has no url (mock fallback, 0 状态突变)", async () => {
    const bridge = fakeBridge(async () => ({ reply: "x", contextId: "", state: "" }));
    // 默认 3 bot 0 url; @coder 路由到 coder 但无 url → false
    expect(await botChatStore.trySendViaBridge("@coder hi", bridge)).toBe(false);
    expect(botChatStore.get().messages).toEqual([]);
    expect(botChatStore.get().streaming).toBeNull();
    expect(bridge.calls).toHaveLength(0);
  });

  it("on failure: aborts stream + sets error, user msg retained", async () => {
    botChatStore.setPeers([
      { id: "coder", mention: "coder", name: "Coder", role: "coder", url: "http://p" },
    ]);
    const bridge = fakeBridge(async () => {
      throw new Error("调用 'http://p' 失败 — HTTP 500。");
    });
    const handled = await botChatStore.trySendViaBridge("@coder hi", bridge);
    expect(handled).toBe(true);
    const s = botChatStore.get();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].from).toBe("user");
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toContain("500");
  });
});
