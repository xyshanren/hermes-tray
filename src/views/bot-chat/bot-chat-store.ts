// v0.4.0 — Bot Chat state store (Cat 4 借鉴 hermes-agent-cn agent/peer.py 1:1 配对).
//
// Owns the data layer for the multi-bot chat surface (single-DM + 群组简版 ≤ 6 bot).
// The Preact component in BotChatView.tsx subscribes here; main.ts uses the
// mutators to drive updates. 0 改 chat-view / chat-view-store.ts 现有 (跟 mavis
// 4 件套 "UX 倒退审计" 1:1 配对 0 改 happy path).
//
// Why a tiny pub-sub (跟 chat-input-store.ts 1:1 配对, 跟 mavis MEMORY 30-34 行
// "fire-on-subscribe pub-sub" 1:1 配对):
//   - Bot reply chunks fire at ~5-15 Hz (跟 chat-view-store.ts 1:1 配对 1:1
//     streaming pattern, 0 重新发明)
//   - main.ts can call mutators imperatively from the Tauri invoke callback
//     (跟 chat-view-store.ts 1:1 配对 Tauri event listener pattern)
//
// State shape (跟 hermes-agent-cn agent/peer.py 5 命令 1:1 配对):
//   - peers:        已知 peer list (跟 peer_list 1:1 配对)
//   - messages:     finalised history (跟 ~/.hermes/peers/<peer>/chat.jsonl 1:1
//                   持久化模型, 但前端 0 改持久化 — 走 mock reply 0.5s 模拟)
//   - streaming:    active bot bubble being filled (跟 chat-view 1:1 配对
//                   streaming pattern, peer_call in-flight)
//   - isLoading:    true between sendBotMessage() and finishStream()
//   - error:        last transient error (跟 chat-view 1:1 配对)
//
// Mock 范围 (跟 mavis 9-03 12:40 拍 "轻量 hermes-tray" 1:1 配对):
//   - 0 实际 Tauri invoke, 走 setTimeout 0.5s 模拟 reply
//   - 6 bot 群组, @ mention 路由到对应 bot
//   - 1:1 配对 agent/peer.py 接口协议 (peer_discover / peer_call / peer_list
//     / peer_history / peer_run), 留 v0.4.1 接 Tauri IPC bridge

import type { PendingAttachment } from "../chat-view-store";

export interface BotPeer {
  /** 跟 ~/.hermes/peers/<peer_name>/ 1:1 配对 */
  id: string;
  /** @ mention 名字 (e.g. "researcher", "coder", "tester") */
  mention: string;
  /** Display name in UI */
  name: string;
  /** Bot 类型 (跟 peer_run 1:1 配对, v0.4.1 实际 invoke 时用) */
  role: "researcher" | "coder" | "tester" | "general";
}

export interface BotMessage {
  /** Stable id used as Preact message list key (跟 ChatMessage 1:1 配对) */
  id?: string;
  /** "user" 发送者 / "<bot-id>" 接收者 (跟 peer_call 1:1 配对) */
  from: string;
  content: string;
  timestamp: Date;
  /** @ mention 路由 (跟 plan §1.1 "@ mention: @researcher / @coder / @tester" 1:1) */
  mentions?: string[];
  attachments?: PendingAttachment[];
}

export interface StreamingBotBubble {
  content: string;
  startedAt: number;
  peerId: string;
}

export interface BotChatStoreState {
  peers: BotPeer[];
  messages: BotMessage[];
  streaming: StreamingBotBubble | null;
  isLoading: boolean;
  error: string | null;
}

const MAX_GROUP_SIZE = 6; // 跟 plan §1.1 1:1 配对: 最多 6 bot 同室

function parseMentionsFromText(text: string, peers: BotPeer[]): string[] {
  const validMentions = new Set(peers.map((p) => p.mention));
  const matches: string[] = [];
  const regex = /@(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (validMentions.has(m[1]) && !matches.includes(m[1])) {
      matches.push(m[1]);
    }
  }
  return matches;
}

function freshId(): string {
  // crypto.randomUUID 在 v0.2.0 chat-view-store.ts 也用, 1:1 配对
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let state: BotChatStoreState = {
  // 默认 3 bot (跟 plan §1.1 "@researcher / @coder / @tester" 1:1 配对)
  peers: [
    { id: "researcher", mention: "researcher", name: "Researcher", role: "researcher" },
    { id: "coder", mention: "coder", name: "Coder", role: "coder" },
    { id: "tester", mention: "tester", name: "Tester", role: "tester" },
  ],
  messages: [],
  streaming: null,
  isLoading: false,
  error: null,
};

const listeners = new Set<(state: BotChatStoreState) => void>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const botChatStore = {
  get(): BotChatStoreState {
    return state;
  },

  /** 跟 peer_list 1:1 配对 (跟 agent/peer.py 协议层 1:1 配对) */
  setPeers(peers: BotPeer[]): void {
    if (peers.length > MAX_GROUP_SIZE) {
      // 跟 mavis "UX 倒退审计" 1:1 配对: silent cap 0 raise (跟 chat-input-store.ts
      // removeAttachment out-of-bounds 0 raise 1:1 配对)
      state = { ...state, peers: peers.slice(0, MAX_GROUP_SIZE) };
    } else {
      state = { ...state, peers };
    }
    notify();
  },

  /** Append a user message (跟 chat-view-store.addMessage 1:1 配对).
   *  0 改 caller 协议: auto-parse mentions from content if not provided,
   *  跟 plan §1.1 "@ mention: @researcher / @coder / @tester" 1:1 配对.
   */
  addUserMessage(content: string, mentions?: string[]): BotMessage | null {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const resolvedMentions =
      mentions ?? parseMentionsFromText(trimmed, state.peers);
    const msg: BotMessage = {
      id: freshId(),
      from: "user",
      content: trimmed,
      timestamp: new Date(),
      mentions: resolvedMentions,
    };
    state = { ...state, messages: [...state.messages, msg] };
    notify();
    return msg;
  },

  /** Start streaming bot reply (跟 chat-view-store streaming 1:1 配对) */
  startBotStream(peerId: string): void {
    state = {
      ...state,
      streaming: { content: "", startedAt: Date.now(), peerId },
      isLoading: true,
    };
    notify();
  },

  /** Append a chunk to the streaming bot bubble (跟 chat-view-store 1:1 配对) */
  appendBotChunk(chunk: string): void {
    if (!state.streaming) return;
    state = {
      ...state,
      streaming: {
        ...state.streaming,
        content: state.streaming.content + chunk,
      },
    };
    notify();
  },

  /** Finalize the streaming bubble (跟 chat-view-store finishStream 1:1) */
  finishBotStream(): void {
    if (!state.streaming) return;
    const bubble = state.streaming;
    const finalMsg: BotMessage = {
      id: freshId(),
      from: bubble.peerId,
      content: bubble.content,
      timestamp: new Date(bubble.startedAt),
    };
    state = {
      ...state,
      messages: [...state.messages, finalMsg],
      streaming: null,
      isLoading: false,
    };
    notify();
  },

  setError(message: string | null): void {
    state = { ...state, error: message };
    notify();
  },

  clearMessages(): void {
    state = { ...state, messages: [], streaming: null, isLoading: false, error: null };
    notify();
  },

  /**
   * Mock peer_call (跟 agent/peer.py.peer_call 1:1 配对).
   *
   * 0 实际 Tauri invoke — 走 setTimeout 0.5s 模拟 reply (跟 mavis 9-03 12:40 拍
   * "轻量" 1:1 配对). 留 v0.4.1 实际接 Tauri IPC bridge.
   *
   * Returns the routed peer id (single-DM: explicit peer, 群组: state.peers
   * 顺序 first mention match — 跟 mavis 4 件套 "first match wins" 1:1 配对,
   * 0 按 mentions 数组顺序).
   */
  routeMockReply(mentions: string[], explicitPeerId?: string): string {
    if (explicitPeerId && state.peers.some((p) => p.id === explicitPeerId)) {
      return explicitPeerId;
    }
    if (mentions.length > 0) {
      const routed = state.peers.find((p) => mentions.includes(p.mention));
      if (routed) return routed.id;
    }
    // 0 mention → 走 default peer (群组简版, 跟 plan §1.1 1:1)
    return state.peers[0]?.id ?? "general";
  },

  /** Test-only: reset module-level state (跟 chat-view-store 0 暴露 reset_cache
   *  1:1 配对 — 走 reload module 隔离 state, 跟 mavis 4 件套 1:1 配对) */
  __resetForTests(): void {
    state = {
      peers: [
        { id: "researcher", mention: "researcher", name: "Researcher", role: "researcher" },
        { id: "coder", mention: "coder", name: "Coder", role: "coder" },
        { id: "tester", mention: "tester", name: "Tester", role: "tester" },
      ],
      messages: [],
      streaming: null,
      isLoading: false,
      error: null,
    };
    notify();
  },

  subscribe(listener: (state: BotChatStoreState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const __testing = { MAX_GROUP_SIZE, freshId };
