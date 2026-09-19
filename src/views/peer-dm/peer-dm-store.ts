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
//   - 跨 Gateway 通信 (Tailscale / VPN 私网内) — 走 explicit gateway URL
//
// v0.4.1 — IPC bridge 接入 (跟 lib/peer-bridge.ts A2A v1.0 client 1:1 配对):
//   - peer.gateway 是 http(s) URL 时走 sendViaBridge (跟 peer_call → a2a_call
//     线上协议 1:1 配对), contextId 续聊 (跟 a2a_call context_id 1:1 配对)
//   - mock 路径保留: gateway 不是 URL / 测试 / 无后端时行为跟 v0.4.0 一致
//     (0 改现有 happy path, 跟 mavis "UX 倒退审计" 1:1 配对)
//
// Mock 范围 (跟 D.1 1:1 配对, 跟 mavis 9-03 12:40 拍 1:1):
//   - mock 走 setInterval 逐字模拟 reply (跟 PeerDMView 1:1 配对)
//   - 0 实际 chat history 持久化, 走 in-memory messages array

import type { PendingAttachment } from "../chat-view-store";
import type { PeerBridgeLike } from "../../lib/peer-bridge";

export interface PeerDMState {
  peer: {
    id: string;
    name: string;
    /** 跨 Gateway URL (Tailscale / VPN 私网内), 跟 peer_dm 1:1 配对.
     *  http(s) URL → sendViaBridge 走实际 A2A; 其他 → mock */
    gateway: string;
    /** 可选 bearer token (跟 a2a_agents auth 1:1 配对) */
    token?: string;
  } | null;
  messages: PeerDMMessage[];
  streaming: PeerDMStreamingBubble | null;
  isLoading: boolean;
  error: string | null;
  /** 跟 ~/.hermes/peers/<peer_name>/chat.jsonl 1:1 配对持久化标识, mock
   *  in-memory 0 实际写盘 */
  hasPersistedHistory: boolean;
  /** A2A contextId 续聊标识 (跟 a2a_call context_id 1:1 配对, bridge 回包
   *  后写入; mock 路径 0 触碰) */
  contextId: string | null;
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
  contextId: null,
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
      // 切 peer 重置 A2A 续聊 context (0 串味, 跟 mavis "input 变更时重置" 1:1)
      contextId: null,
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

  /** 错误路径中止流式 bubble (streaming 清空 + isLoading 复位, 0 落消息 —
   *  跟 chat-stream P1-7 "错误不污染 happy path" 语义 1:1 配对) */
  abortPeerStream(): void {
    if (!state.streaming) return;
    state = { ...state, streaming: null, isLoading: false };
    notify();
  },

  /** v0.4.1 实际 IPC 发送 (跟 agent/peer.py peer_call 线上协议 1:1 配对).
   *
   *  bridge 参数依赖注入 (视图传 lib/peer-bridge realPeerBridge, 测试传
   *  fake — 跟 api.test.ts invoke mock 隔离 pattern 1:1 配对)。
   *  peer.gateway 非 peer URL 时 caller 不应调这里 (视图层分支)。
   *
   *  流程: addUserMessage → startPeerStream → bridge.send → append reply →
   *  finishPeerStream + 记 contextId; 失败 → abortPeerStream + setError
   *  (fail-fast 0 静默, user 消息保留可重试)。
   */
  async sendViaBridge(content: string, bridge: PeerBridgeLike): Promise<boolean> {
    const peer = state.peer;
    if (!peer || !peer.gateway) return false;
    if (!this.addUserMessage(content)) return false;
    this.startPeerStream();
    try {
      const res = await bridge.send(peer.gateway, peer.token, content, state.contextId ?? undefined);
      if (res.reply) this.appendPeerChunk(res.reply);
      this.finishPeerStream();
      if (res.contextId) state = { ...state, contextId: res.contextId };
      notify();
      return true;
    } catch (e) {
      this.abortPeerStream();
      this.setError(e instanceof Error ? e.message : String(e));
      return true;
    }
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
      contextId: null,
    };
    notify();
  },

  subscribe(listener: (state: PeerDMState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const __peerDMTesting = { freshId };
