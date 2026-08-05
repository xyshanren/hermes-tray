import { beforeEach, describe, expect, it, vi } from "vitest";

const postStream = vi.fn();

vi.mock("./api", () => ({
  hermesPostStream: (...args: unknown[]) => postStream(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

import {
  __resetForTests,
  handleStreamChunk,
  initChatStream,
  sendChatMessage,
  type ChatStreamDeps,
} from "./chat-stream";
import { chatStore } from "../views/chat-view-store";

function makeDeps(overrides: Partial<ChatStreamDeps> = {}): ChatStreamDeps {
  return {
    getCurrentSessionId: () => "session-1",
    getCurrentSession: () => null,
    getRecentMessages: () => [
      { role: "user", content: "hello", timestamp: new Date(1) },
    ],
    getPersonasCache: () => [],
    getCurrentModel: () => "hermes-agent",
    getDefaultModel: () => null,
    getDefaultPersonaId: () => null,
    setIsLoading: vi.fn(),
    setIsStreaming: vi.fn(),
    setConnectionStatus: vi.fn(),
    setMessages: vi.fn(),
    onAfterReply: vi.fn(),
    buildSystemPrompt: async () => null,
    ...overrides,
  };
}

describe("chat-stream P1-7 error classification", () => {
  beforeEach(() => {
    postStream.mockReset();
    chatStore.__resetForTests();
    __resetForTests();
  });

  it("marks the gateway disconnected when the SSE handshake emits no payload", async () => {
    const deps = makeDeps();
    postStream.mockRejectedValueOnce(new Error("connection refused"));
    await initChatStream(deps);

    await sendChatMessage();

    expect(deps.setConnectionStatus).toHaveBeenCalledWith("disconnected");
    expect(chatStore.get().error).toContain("无法连接 Hermes Gateway");
    expect(chatStore.get().streaming).toBeNull();
  });

  it("keeps connection status unchanged when a stream fails after a payload", async () => {
    const deps = makeDeps();
    postStream.mockImplementationOnce(async () => {
      handleStreamChunk('data: {"choices":[{"delta":{"content":"partial"}}]}');
      throw new Error("error decoding response body");
    });
    await initChatStream(deps);

    await sendChatMessage();

    expect(deps.setConnectionStatus).not.toHaveBeenCalled();
    expect(chatStore.get().error).toContain("回复中断");
    expect(chatStore.get().error).not.toContain("Gateway");
    expect(chatStore.get().streaming).toBeNull();
  });

  it("does not mark the gateway offline for local preparation failures", async () => {
    const deps = makeDeps({
      buildSystemPrompt: async () => {
        throw new Error("persona compose failed");
      },
    });
    await initChatStream(deps);

    await sendChatMessage();

    expect(postStream).not.toHaveBeenCalled();
    expect(deps.setConnectionStatus).not.toHaveBeenCalled();
    expect(chatStore.get().error).toBe("发送失败: persona compose failed");
  });
});
