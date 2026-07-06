// v0.2-alpha-16 — ChatView store + render shell tests.
//
// We cover the pub-sub + mutators + the Preact render shell. We do NOT
// drive the SSE pipeline end-to-end here — the streaming submit path
// stays in main.ts until alpha-17, and we test the helpers it consumes
// (formatMessage / formatMessageBar) separately in chat-formatters.test.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import {
  chatStore,
  type ChatMessage,
  type ChatMessageBar,
} from "./chat-view-store";
import { ChatView, chatWelcomeStore } from "./chat-view";

// ── store ──────────────────────────────────────────────────────────────────

describe("chatStore", () => {
  beforeEach(() => {
    chatStore.__resetForTests();
  });

  it("starts empty after reset", () => {
    const s = chatStore.get();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("replaces message list via setMessages", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi", timestamp: new Date(1) },
      { role: "assistant", content: "hello", timestamp: new Date(2) },
    ];
    chatStore.setMessages(msgs);
    expect(chatStore.get().messages).toEqual(msgs);
  });

  it("setMessages clears any stale error", () => {
    chatStore.setError("stale");
    chatStore.setMessages([{ role: "user", content: "x", timestamp: new Date() }]);
    expect(chatStore.get().error).toBeNull();
  });

  it("appends a single message via appendMessage", () => {
    chatStore.setMessages([]);
    chatStore.appendMessage({ role: "user", content: "first", timestamp: new Date(3) });
    chatStore.appendMessage({ role: "assistant", content: "reply", timestamp: new Date(4) });
    expect(chatStore.get().messages).toHaveLength(2);
    expect(chatStore.get().messages[0].content).toBe("first");
    expect(chatStore.get().messages[1].content).toBe("reply");
  });

  it("openStream + appendStreamChunk accumulates content", () => {
    chatStore.openStream();
    expect(chatStore.get().streaming).not.toBeNull();
    chatStore.appendStreamChunk("Hello");
    chatStore.appendStreamChunk(", world");
    expect(chatStore.get().streaming?.content).toBe("Hello, world");
  });

  it("appendStreamChunk is a no-op when no stream is open", () => {
    // Defensive: chunks can arrive after finishStream races against a new send.
    chatStore.appendStreamChunk("stray");
    expect(chatStore.get().streaming).toBeNull();
  });

  it("finaliseStream promotes the streaming bubble to a message with the bar attached", () => {
    chatStore.openStream();
    chatStore.appendStreamChunk("streaming reply");
    chatStore.setIsLoading(true);
    const bar: ChatMessageBar = {
      costUsd: 0.0123,
      elapsedMs: 4200,
      ruleId: "vision_native",
      costThresholdExceeded: false,
    };
    chatStore.finaliseStream(bar);
    const s = chatStore.get();
    expect(s.streaming).toBeNull();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("assistant");
    expect(s.messages[0].content).toBe("streaming reply");
    expect(s.messages[0].bar).toEqual(bar);
    expect(s.isLoading).toBe(false);
  });

  it("abortStream discards the streaming bubble without leaving a message", () => {
    chatStore.openStream();
    chatStore.appendStreamChunk("partial");
    chatStore.abortStream();
    const s = chatStore.get();
    expect(s.streaming).toBeNull();
    expect(s.messages).toHaveLength(0);
  });

  it("setError stores the message and clears it on next setMessages", () => {
    chatStore.setError("connection refused");
    expect(chatStore.get().error).toBe("connection refused");
    chatStore.setMessages([{ role: "user", content: "x", timestamp: new Date() }]);
    expect(chatStore.get().error).toBeNull();
  });

  it("subscribe fires immediately with the current state", () => {
    chatStore.setMessages([{ role: "user", content: "hello", timestamp: new Date() }]);
    let snapshot = null;
    const unsub = chatStore.subscribe((s) => (snapshot = s));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.messages).toHaveLength(1);
    unsub();
  });

  it("subscribe fires on every mutator call", () => {
    let calls = 0;
    const unsub = chatStore.subscribe(() => calls++);
    chatStore.setMessages([]);
    chatStore.openStream();
    chatStore.appendStreamChunk("x");
    chatStore.finaliseStream({
      costUsd: 0,
      elapsedMs: null,
      ruleId: null,
      costThresholdExceeded: false,
    });
    // 1 initial (subscribe fires immediately) + 4 mutators
    expect(calls).toBe(5);
    unsub();
  });
});

// ── welcome store ──────────────────────────────────────────────────────────

describe("chatWelcomeStore", () => {
  it("starts with no context", () => {
    expect(chatWelcomeStore.get().context).toBeNull();
  });

  it("round-trips persona + project context", () => {
    chatWelcomeStore.setContext({
      headline: "👋 新会话已开始",
      persona: { avatar: "🧑‍💻", name: "Coder" },
      project: { name: "hermes-tray", version: "0.2.0", path: "D:\\work\\hermes-tray" },
    });
    const ctx = chatWelcomeStore.get().context;
    expect(ctx?.headline).toBe("👋 新会话已开始");
    expect(ctx?.persona?.name).toBe("Coder");
    expect(ctx?.project?.name).toBe("hermes-tray");
  });

  it("subscribe fires immediately with the current value", () => {
    chatWelcomeStore.setContext({ persona: { avatar: "🐱", name: "cat" } });
    let seen: typeof chatWelcomeStore extends { get(): infer T } ? T : never = null as never;
    const unsub = chatWelcomeStore.subscribe((s) => (seen = s as never));
    expect(seen.context?.persona?.name).toBe("cat");
    unsub();
  });
});

// ── ChatView render shell ──────────────────────────────────────────────────

describe("<ChatView /> (render shell)", () => {
  beforeEach(() => {
    chatStore.__resetForTests();
    chatWelcomeStore.setContext(null);
    document.body.innerHTML = "";
  });

  function mountView() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<ChatView />, host);
    return host;
  }

  it("renders the default welcome screen when store is empty", () => {
    const host = mountView();
    const welcome = host.querySelector(".welcome-message");
    expect(welcome).not.toBeNull();
    expect(welcome!.textContent).toContain("欢迎使用 Hermes Chat");
    expect(welcome!.textContent).toContain("在下方输入消息开始对话");
  });

  it("renders a user bubble with attachments after appendMessage", () => {
    chatStore.appendMessage({
      role: "user",
      content: "look at this image",
      timestamp: new Date(),
      attachments: [
        { id: "a1", dataUrl: "data:image/png;base64,test", name: "cat.png", type: "image/png", size: 1024 },
      ],
    });
    const host = mountView();
    const userBubble = host.querySelector(".message.user");
    expect(userBubble).not.toBeNull();
    expect(userBubble!.textContent).toContain("look at this image");
    const img = host.querySelector("img.message-attachment-thumb");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("cat.png");
  });

  it("renders an assistant bubble with markdown HTML and a CLI bar", () => {
    chatStore.appendMessage({
      role: "assistant",
      content: "**bold** reply",
      timestamp: new Date(),
      bar: {
        costUsd: 0.0234,
        elapsedMs: 3400,
        ruleId: "vision_fallback_config",
        costThresholdExceeded: false,
      },
    });
    const host = mountView();
    const assistantBubble = host.querySelector(".message.assistant");
    expect(assistantBubble).not.toBeNull();
    // marked.parse renders <strong>bold</strong>
    expect(assistantBubble!.querySelector("strong")).not.toBeNull();
    const bar = host.querySelector(".message-bar");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain("💰 $0.0234");
    expect(bar!.textContent).toContain("⏱ 3.4s");
    expect(bar!.textContent).toContain("🛡 vision_fallback_config");
  });

  it("renders an is-streaming bubble while streaming is active", () => {
    chatStore.openStream();
    chatStore.appendStreamChunk("thinking ");
    chatStore.appendStreamChunk("aloud");
    const host = mountView();
    const bubble = host.querySelector(".message.assistant.is-streaming");
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("thinking aloud");
  });

  it("promotes the streaming bubble to a finalised assistant bubble on finaliseStream", () => {
    chatStore.openStream();
    chatStore.appendStreamChunk("done");
    chatStore.finaliseStream({
      costUsd: 0.01,
      elapsedMs: 1000,
      ruleId: null,
      costThresholdExceeded: false,
    });
    const host = mountView();
    const final = host.querySelector(".message.assistant:not(.is-streaming)");
    expect(final).not.toBeNull();
    expect(final!.textContent).toContain("done");
    const bar = host.querySelector(".message-bar");
    expect(bar).not.toBeNull();
  });

  it("renders an error bubble when setError is called", () => {
    chatStore.setError("连接失败: gateway down");
    const host = mountView();
    const err = host.querySelector(".message.error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("连接失败");
  });

  it("renders the welcome screen with persona + project context", () => {
    chatWelcomeStore.setContext({
      headline: "👋 新会话已开始",
      persona: { avatar: "🐱", name: "CatBot" },
      project: { name: "hermes-tray", version: "0.2.0", path: "D:\\work\\hermes-tray" },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<ChatView welcomeContext={chatWelcomeStore.get().context} />, host);
    const welcome = host.querySelector(".welcome-message");
    expect(welcome!.textContent).toContain("新会话已开始");
    expect(welcome!.textContent).toContain("CatBot");
    expect(welcome!.textContent).toContain("hermes-tray v0.2.0");
  });

  it("renders the welcome screen with a scan-failed project label", () => {
    chatWelcomeStore.setContext({
      headline: "👋 新会话已开始",
      project: { name: "", path: "D:\\missing", scanFailed: true },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<ChatView welcomeContext={chatWelcomeStore.get().context} />, host);
    const welcome = host.querySelector(".welcome-message");
    expect(welcome!.textContent).toContain("项目路径已设置但扫描失败");
  });
});