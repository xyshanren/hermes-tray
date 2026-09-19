// v0.4.1 — tests for src/lib/peer-bridge.ts (A2A v1.0 protocol client).
//
// 全部走注入的 fake transport (0 实际 invoke, 跟 api.test.ts vi.mock 隔离
// pattern 1:1 配对)。协议断言跟 hermes-agent-cn plugins/platforms/a2a/
// tools.py 客户端路径 1:1 配对: discovery fallback / rpc url 解析 /
// "SendMessage" 报文 / reply 三级提取 / 错误分类 (AGENTS.md 教训 ② 不 fold
// failure case)。

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  discoverAgent,
  sendPeerMessage,
  normalizePeerUrl,
  PeerBridgeError,
  __setTransportForTests,
  type PeerTransport,
} from "./peer-bridge";
import type { HermesResponse } from "../types";

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function makeTransport(
  getResponder: (url: string) => HermesResponse | Promise<HermesResponse>,
  postResponder?: (url: string, body: string) => HermesResponse | Promise<HermesResponse>,
): { transport: PeerTransport; gets: RecordedCall[]; posts: RecordedCall[] } {
  const gets: RecordedCall[] = [];
  const posts: RecordedCall[] = [];
  return {
    gets,
    posts,
    transport: {
      get: vi.fn(async (url: string, headers: Record<string, string>) => {
        gets.push({ url, headers });
        return await getResponder(url);
      }),
      post: vi.fn(async (url: string, headers: Record<string, string>, body: string) => {
        posts.push({ url, headers, body });
        if (!postResponder) throw new Error("unexpected POST in this test");
        return await postResponder(url, body);
      }),
    },
  };
}

function ok(body: unknown): HermesResponse {
  return { ok: true, status: 200, body: JSON.stringify(body) };
}

const V1_CARD = {
  name: "Coder Bot",
  description: "writes code",
  url: "http://10.0.0.2:9999/rpc-legacy",
  protocolVersion: "1.0",
  supportedInterfaces: [
    { url: "http://10.0.0.2:9999/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ],
  capabilities: { streaming: true, pushNotifications: false },
  skills: [],
};

beforeEach(() => {
  __setTransportForTests(null);
});

describe("normalizePeerUrl", () => {
  it("strips trailing slashes and keeps http(s)", () => {
    expect(normalizePeerUrl("http://10.0.0.2:9999///")).toBe("http://10.0.0.2:9999");
    expect(normalizePeerUrl("  https://peer.example.com/  ")).toBe("https://peer.example.com");
  });

  it("throws invalid-url for non-http schemes (独立 kind, 跟教训 ② 1:1)", () => {
    try {
      normalizePeerUrl("ftp://10.0.0.2");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PeerBridgeError);
      expect((e as PeerBridgeError).kind).toBe("invalid-url");
    }
  });
});

describe("discoverAgent", () => {
  it("fetches canonical v1.0 card and resolves rpc url from supportedInterfaces", async () => {
    const { transport, gets } = makeTransport((url) =>
      url.endsWith("/.well-known/agent-card.json") ? ok(V1_CARD) : { ok: false, status: 500, body: "" },
    );
    __setTransportForTests(transport);
    const card = await discoverAgent("http://10.0.0.2:9999");
    expect(card.name).toBe("Coder Bot");
    expect(card.rpcUrl).toBe("http://10.0.0.2:9999/rpc");
    expect(card.protocolVersion).toBe("1.0");
    expect(card.streaming).toBe(true);
    expect(card.authRequired).toBe(false);
    expect(gets).toHaveLength(1);
  });

  it("falls back to legacy agent.json on 404 (跟 _fetch_card 1:1 配对)", async () => {
    const { transport, gets } = makeTransport((url) =>
      url.endsWith("/.well-known/agent-card.json")
        ? { ok: false, status: 404, body: "" }
        : ok({ ...V1_CARD, supportedInterfaces: [] }),
    );
    __setTransportForTests(transport);
    const card = await discoverAgent("http://10.0.0.2:9999");
    expect(gets).toHaveLength(2);
    // 0 supportedInterfaces → card.url 兜底 (跟 _rpc_url 1:1)
    expect(card.rpcUrl).toBe("http://10.0.0.2:9999/rpc-legacy");
  });

  it("maps 401 to auth kind and transport failure to network kind", async () => {
    const authT = makeTransport(() => ({ ok: false, status: 401, body: "" }));
    __setTransportForTests(authT.transport);
    await expect(discoverAgent("http://10.0.0.2:9999")).rejects.toMatchObject({ kind: "auth" });

    const netT = makeTransport(() => {
      throw new Error("conn refused");
    });
    __setTransportForTests(netT.transport);
    await expect(discoverAgent("http://10.0.0.2:9999")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("sendPeerMessage", () => {
  it("posts v1.0 SendMessage JSON-RPC with ROLE_USER text part + contextId + bearer", async () => {
    const { transport, posts } = makeTransport(
      () => ({ ok: false, status: 404, body: "" }), // card 双 404 → rpc url 落 base
      () =>
        ok({
          result: {
            task: {
              id: "task-remote",
              contextId: "ctx-remote-1",
              status: { state: "TASK_STATE_COMPLETED" },
              artifacts: [{ parts: [{ text: "回复正文", mediaType: "text/plain" }] }],
            },
          },
        }),
    );
    __setTransportForTests(transport);
    const res = await sendPeerMessage(
      { url: "http://10.0.0.2:9999", token: "sk-peer" },
      "帮我跑测试",
    );

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("http://10.0.0.2:9999");
    expect(posts[0].headers["Content-Type"]).toBe("application/json");
    expect(posts[0].headers["Authorization"]).toBe("Bearer sk-peer");

    const rpc = JSON.parse(posts[0].body!);
    expect(rpc.jsonrpc).toBe("2.0");
    expect(rpc.method).toBe("SendMessage");
    expect(rpc.id).toMatch(/^task-[0-9a-f]{16}$/);
    const msg = rpc.params.message;
    expect(msg.role).toBe("ROLE_USER");
    expect(msg.parts).toEqual([{ text: "帮我跑测试", mediaType: "text/plain" }]);
    expect(msg.messageId).toMatch(/^[0-9a-f]{32}$/);
    expect(msg.contextId).toMatch(/^ctx-[0-9a-f]{32}$/);

    // reply 提取: artifacts 优先; contextId 回显 response 的
    expect(res.reply).toBe("回复正文");
    expect(res.contextId).toBe("ctx-remote-1");
    expect(res.state).toBe("completed");
  });

  it("echoes provided contextId for multi-turn (跟 a2a_call context_id 1:1)", async () => {
    let capturedCtx = "";
    const { transport } = makeTransport(
      () => ({ ok: false, status: 404, body: "" }),
      (_url, body) => {
        capturedCtx = JSON.parse(body).params.message.contextId;
        return ok({ result: { message: { role: "ROLE_AGENT", parts: [{ text: "好" }] } } });
      },
    );
    __setTransportForTests(transport);
    const res = await sendPeerMessage({ url: "http://p" }, "第二轮", "ctx-fixed");
    expect(capturedCtx).toBe("ctx-fixed");
    expect(res.contextId).toBe("ctx-fixed");
  });

  it("extracts status.message when no artifacts (跟 _reply_text_from_result 1:1)", async () => {
    const { transport } = makeTransport(
      () => ({ ok: false, status: 404, body: "" }),
      () =>
        ok({
          result: {
            task: {
              status: {
                state: "TASK_STATE_INPUT_REQUIRED",
                message: { parts: [{ text: "需要更多输入" }] },
              },
            },
          },
        }),
    );
    __setTransportForTests(transport);
    const res = await sendPeerMessage({ url: "http://p" }, "hi");
    expect(res.reply).toBe("需要更多输入");
    expect(res.state).toBe("input-required");
  });

  it("classifies errors: auth / rate-limited / http / rpc / invalid-response (不 fold)", async () => {
    const mk = (status: number, body: string) => {
      const t = makeTransport(
        () => ({ ok: false, status: 404, body: "" }),
        () => ({ ok: status < 400, status, body }),
      );
      __setTransportForTests(t.transport);
      return sendPeerMessage({ url: "http://p" }, "hi");
    };

    await expect(mk(403, "")).rejects.toMatchObject({ kind: "auth" });
    await expect(mk(429, "")).rejects.toMatchObject({ kind: "rate-limited" });
    await expect(mk(500, "")).rejects.toMatchObject({ kind: "http" });
    await expect(
      mk(200, JSON.stringify({ jsonrpc: "2.0", id: "x", error: { code: -32001, message: "TaskNotFound" } })),
    ).rejects.toMatchObject({ kind: "rpc", message: expect.stringContaining("TaskNotFound") });
    await expect(mk(200, "not-json")).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("rethrows network failure from POST as network kind", async () => {
    const t = makeTransport(() => ({ ok: false, status: 404, body: "" }), () => {
      throw new Error("timeout");
    });
    __setTransportForTests(t.transport);
    await expect(sendPeerMessage({ url: "http://p" }, "hi")).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("rejects empty message with invalid-request (独立 kind)", async () => {
    const t = makeTransport(() => ({ ok: false, status: 404, body: "" }));
    __setTransportForTests(t.transport);
    await expect(sendPeerMessage({ url: "http://p" }, "   ")).rejects.toMatchObject({
      kind: "invalid-request",
    });
  });
});
