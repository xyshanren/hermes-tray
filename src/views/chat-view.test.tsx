// v0.2-alpha-16 — ChatView store + render shell tests.
//
// We cover the pub-sub + mutators + the Preact render shell. We do NOT
// drive the SSE pipeline end-to-end here — the streaming submit path
// stays in main.ts until alpha-17, and we test the helpers it consumes
// (formatMessage / formatMessageBar) separately in chat-formatters.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
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

  // v0.2-alpha-20 — empty-state cards (designs 06 / 07).
  // The view wiring tests below cover the three branches that
  // <ChatView /> picks when messages.length === 0 +
  // streaming === null + error === null:
  //   - offline → EmptyNoNetwork (design 07)
  //   - online + !hasSessions → FirstRunWelcome (design 06)
  //   - online + hasSessions → standard WelcomeBubble (alpha-16 default)

  it("renders the no-network card when connectionStatus=offline (design 07)", () => {
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    chatStore.setConnectionStatus("offline");
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      <ChatView
        onRetryConnection={onRetry}
        onOpenSettings={onOpenSettings}
        gatewayHint="当前 Gateway: http://127.0.0.1:8788"
      />,
      host,
    );
    const card = host.querySelector(".no-network-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("无法连接 hermes-agent");
    expect(card!.textContent).toContain("http://127.0.0.1:8788");
    const retryBtn = card!.querySelector(".btn-primary") as HTMLButtonElement;
    expect(retryBtn.textContent).toBe("重试连接");
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const settingsBtn = card!.querySelector(".btn-secondary") as HTMLButtonElement;
    expect(settingsBtn.textContent).toBe("查看连接设置");
    settingsBtn.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the first-run welcome card when online + !hasSessions (design 06)", () => {
    const onCreateSession = vi.fn();
    chatStore.setConnectionStatus("online");
    chatStore.setHasSessions(false);
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      <ChatView
        onCreateSession={onCreateSession}
        recommendedPersonas={[
          { avatar: "🦊", name: "hermes-agent", tag: "通用助手" },
          { avatar: "🛡", name: "code-reviewer", tag: "代码审查" },
        ]}
      />,
      host,
    );
    const card = host.querySelector(".first-run-welcome");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("欢迎使用 Hermes Chat");
    expect(card!.textContent).toContain("hermes-agent");
    expect(card!.textContent).toContain("code-reviewer");
    expect(card!.textContent).toContain("通用助手");
    expect(card!.textContent).toContain("代码审查");
    const cta = card!.querySelector(".welcome-card-cta") as HTMLButtonElement;
    expect(cta.textContent).toContain("创建第一个会话");
    cta.click();
    expect(onCreateSession).toHaveBeenCalledTimes(1);
    // Persona chip click should also call onCreateSession.
    const chip = card!.querySelector(".persona-chip") as HTMLButtonElement;
    chip.click();
    expect(onCreateSession).toHaveBeenCalledTimes(2);
    // Restore for subsequent tests.
    chatStore.setHasSessions(true);
  });

  it("renders the standard welcome when online + hasSessions", () => {
    chatStore.setConnectionStatus("online");
    chatStore.setHasSessions(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<ChatView />, host);
    const welcome = host.querySelector(".welcome-message");
    expect(welcome).not.toBeNull();
    expect(host.querySelector(".no-network-card")).toBeNull();
    expect(host.querySelector(".first-run-welcome")).toBeNull();
  });

  it("does NOT render any empty-state card when messages are present", () => {
    chatStore.setConnectionStatus("offline"); // would normally trigger 07
    chatStore.setHasSessions(false); // would normally trigger 06
    chatStore.appendMessage({
      role: "user",
      content: "hi",
      timestamp: new Date(),
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<ChatView />, host);
    expect(host.querySelector(".no-network-card")).toBeNull();
    expect(host.querySelector(".first-run-welcome")).toBeNull();
    expect(host.querySelector(".welcome-message")).toBeNull();
  });

  it("switches from standard welcome to no-network when status flips offline", async () => {
    chatStore.setConnectionStatus("online");
    chatStore.setHasSessions(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    // First act: mount the component (flushes useEffect that
    // subscribes to chatStore). See splash.test.tsx for the same
    // act() sequencing lesson.
    await act(async () => {
      render(<ChatView />, host);
    });
    expect(host.querySelector(".welcome-message")).not.toBeNull();
    // Second act: flip the status. The subscription re-renders,
    // and <ChatView /> picks the no-network card.
    await act(async () => {
      chatStore.setConnectionStatus("offline");
    });
    expect(host.querySelector(".welcome-message")).toBeNull();
    expect(host.querySelector(".no-network-card")).not.toBeNull();
  });
});

// v0.2-alpha-20 — chatStore.setConnectionStatus + setHasSessions.
describe("chatStore (empty-state mutators)", () => {
  beforeEach(() => {
    chatStore.__resetForTests();
  });

  it("setConnectionStatus updates the connectionStatus field", () => {
    expect(chatStore.get().connectionStatus).toBe("online");
    chatStore.setConnectionStatus("offline");
    expect(chatStore.get().connectionStatus).toBe("offline");
    chatStore.setConnectionStatus("online");
    expect(chatStore.get().connectionStatus).toBe("online");
  });

  it("setConnectionStatus is a no-op on the same value", () => {
    let calls = 0;
    const unsub = chatStore.subscribe(() => calls++);
    // After __resetForTests the initial status is "online". Flip
    // to "offline" first so the value actually changes — the
    // no-op check below needs a previous change to compare against.
    chatStore.setConnectionStatus("offline");
    expect(calls).toBe(2); // initial subscribe fire + online→offline
    chatStore.setConnectionStatus("offline");
    expect(calls).toBe(2); // same value, NO fire
    unsub();
  });

  it("setHasSessions updates the hasSessions field", () => {
    expect(chatStore.get().hasSessions).toBe(true);
    chatStore.setHasSessions(false);
    expect(chatStore.get().hasSessions).toBe(false);
    chatStore.setHasSessions(true);
    expect(chatStore.get().hasSessions).toBe(true);
  });

  it("setHasSessions is a no-op on the same value", () => {
    let calls = 0;
    const unsub = chatStore.subscribe(() => calls++);
    chatStore.setHasSessions(false); // true→false, fires
    expect(calls).toBe(2); // initial + change
    chatStore.setHasSessions(false); // same, no-op
    expect(calls).toBe(2);
    unsub();
  });

  it("reset() restores connectionStatus=online + hasSessions=true", () => {
    chatStore.setConnectionStatus("offline");
    chatStore.setHasSessions(false);
    chatStore.reset();
    expect(chatStore.get().connectionStatus).toBe("online");
    expect(chatStore.get().hasSessions).toBe(true);
  });
});