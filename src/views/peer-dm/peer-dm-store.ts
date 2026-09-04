// v0.4.0 — PeerDM state store (Cat 4 借鉴 hermes-agent-cn agent/peer.py
// peer_call / peer_history 1:1 配对, 跟 mavis MEMORY 30-34 行 "三件套 +
// Verified badge input 变更时重置" 1:1 配对).
//
// 跟 BotChat (D.1) 60% 复用 pattern: 走 pub-sub 0 redux (跟 chat-input-store
// 1:1 配对), 跟 chat-view-store streaming 1:1 配对, 0 重新发明.
//
// 跟 D.1 差异 (跟 plan §1.2 1:1 配对, 跟 mavis 9-03 12:40 拍 "轻量" 1:1 配对):
//   - 1 peer only (单聊, 0 群组)
//   - 0 mention 路由 (DM 是显式 peer)
//   - 持久化 chat history (跟 ~/.hermes/peers/<peer>/chat.jsonl 1:1 配对 模型,
//     0 实际持久 — 走 mock)
//   - 跨 Gateway 通信 (Tailscale / VPN 私网内) — 走 explicit gateway URL,
//     0 实际 IPC
//
// Mock 范围 (跟 D.1 1:1 配对, 跟 mavis 9-03 12:40 拍 1:1):
//   - 0 实际 Tauri invoke, 走 setTimeout 0.5s 模拟 reply
//   - 0 实际 chat history 持久化, 走 in-memory messages array
//   - 留 v0.4.1 实际接 Tauri IPC bridge 跟 agent/peer.py 集成

import type { PendingAttachment } from "../chat-view-store";

export interface PeerDMState {
  peer: {
    id: string;
    name: string;
    /** 跨 Gateway URL (Tailscale / VPN 私网内), 跟 peer_dm 1:1 配对 */
    gateway: string;
  } | null;
  messages: PeerDMMessage[];
  streaming: PeerDMStreamingBubble | null;
  isLoading: boolean;
  error: string | null;
  /** 跟 ~/.hermes/peers/<peer_name>/chat.jsonl 1:1 配对持久化标识, mock
   *  in-memory 0 实际写盘 */
  hasPersistedHistory: boolean;
}

export interface PeerDMMessage {
  id?: string;
  from: "user" | "peer";
  content: string;
  timestamp: Date;
  attachments?: PendingAttachment[];
}

export interface PeerDMStreamingBubble {
  content: string;
  startedAt: number;
}

function freshId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let state: PeerDMState = {
  peer: null,
  messages: [],
  streaming: null,
  isLoading: false,
  error: null,
  hasPersistedHistory: false,
};

const listeners = new Set<(state: PeerDMState) => void>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const peerDMStore = {
  get(): PeerDMState {
    return state;
  },

  /** Set the active peer (跟 peer_discover / peer_list 1:1 配对) */
  setPeer(peer: NonNullable<PeerDMState["peer"]>): void {
    // 跟 mavis "Verified badge input 变更时重置" 1:1 配对: 切 peer 重置
    // streaming + messages + history flag (跟 chat-input-store 切 project
    // 1:1 配对 0 串味)
    state = {
      ...state,
      peer,
      messages: [],
      streaming: null,
      isLoading: false,
      // 切 peer 0 自动 load history (跟 plan §1.2 "持久化" 1:1 配对, mock
      // 0 实际 load, 0 hasPersistedHistory = true 表示新会话)
      hasPersistedHistory: false,
    };
    notify();
  },

  /** 模拟加载 peer 历史 (跟 peer_history 1:1 配对, mock 0 实际 IPC) */
  loadMockHistory(seedMessages: PeerDMMessage[]): void {
    state = {
      ...state,
      messages: seedMessages,
      hasPersistedHistory: seedMessages.length > 0,
    };
    notify();
  },

  addUserMessage(content: string): PeerDMMessage | null {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const msg: PeerDMMessage = {
      id: freshId(),
      from: "user",
      content: trimmed,
      timestamp: new Date(),
    };
    state = { ...state, messages: [...state.messages, msg] };
    notify();
    return msg;
  },

  startPeerStream(): void {
    state = {
      ...state,
      streaming: { content: "", startedAt: Date.now() },
      isLoading: true,
    };
    notify();
  },

  appendPeerChunk(chunk: string): void {
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

  finishPeerStream(): void {
    if (!state.streaming) return;
    const bubble = state.streaming;
    const finalMsg: PeerDMMessage = {
      id: freshId(),
      from: "peer",
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

  /** Test-only: reset module-level state (跟 bot-chat-store 1:1 配对) */
  __resetForTests(): void {
    state = {
      peer: null,
      messages: [],
      streaming: null,
      isLoading: false,
      error: null,
      hasPersistedHistory: false,
    };
    notify();
  },

  subscribe(listener: (state: PeerDMState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const __peerDMTesting = { freshId };
