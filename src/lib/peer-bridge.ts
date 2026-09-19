// v0.4.1 — Peer IPC bridge (A2A v1.0 protocol client).
//
// v0.4.0 的 bot-chat / peer-dm 只有 setTimeout 0.5s mock (跟 v0.4.0 release
// commit "4 块 UI 走 mock, 留 v0.4.1 接 IPC bridge" 1:1 配对)。本文件补上
// 协议层, 跟 hermes-agent-cn 执行层 plugins/platforms/a2a/tools.py 客户端
// 路径 1:1 配对 (agent/peer.py peer_call → a2a_call → _send_task):
//   - discovery:  GET /.well-known/agent-card.json → 404 → legacy agent.json
//                 (跟 tools.py:_fetch_card 1:1 配对)
//   - rpc url:    card.supportedInterfaces[JSONRPC].url → card.url → base
//                 (跟 tools.py:_rpc_url 1:1 配对)
//   - send:       JSON-RPC 2.0 "SendMessage" + params.message (v1.0 Message,
//                 contextId 在 Message 内, 跟 tools.py:_send_task 1:1 配对;
//                 服务端 adapter.py 同时收 "message/send", 0 撞名)
//   - reply:      artifacts → status.message → bare message 三级提取
//                 (跟 tools.py:_reply_text_from_result 1:1 配对)
//
// Transport 复用现有 Rust 代理 (hermes_proxy_get / hermes_proxy_post, 全 URL
// + {ok, status, body} — 跟 lib/api.ts 同 pattern, CORS / no_proxy 行为一致),
// 0 改 Rust。测试注入 fake transport (跟 mavis "后端先调查再设计" 1:1 配对)。
//
// 错误分类 (跟 AGENTS.md 教训 ② "validator 不 fold failure case" 1:1 配对:
// 每个 distinct case 独立 kind, UI 按 kind 决定 toast / fallback, 0 静默):
//   invalid-url | invalid-request | network | auth | rate-limited
//   | http | rpc | invalid-response

import { invoke } from "@tauri-apps/api/core";
import type { HermesResponse } from "../types";

/** A2A v1.0 常量 (跟 protocol.py PROTOCOL_VERSION / ROLE_USER 1:1 配对) */
const PROTOCOL_VERSION = "1.0";
const ROLE_USER = "ROLE_USER";

export type PeerBridgeErrorKind =
  | "invalid-url"
  | "invalid-request"
  | "network"
  | "auth"
  | "rate-limited"
  | "http"
  | "rpc"
  | "invalid-response";

export class PeerBridgeError extends Error {
  readonly kind: PeerBridgeErrorKind;
  readonly status?: number;

  constructor(kind: PeerBridgeErrorKind, message: string, status?: number) {
    super(message);
    this.name = "PeerBridgeError";
    this.kind = kind;
    this.status = status;
  }
}

/** Agent Card 里 bridge 消费的字段摘要 (跟 protocol.py:build_agent_card 1:1 配对) */
export interface AgentCardSummary {
  name: string;
  description: string;
  /** JSONRPC interface url → card.url → base (跟 _rpc_url 1:1 配对) */
  rpcUrl: string;
  protocolVersion: string;
  /** v1.0 multi-tenancy routing key, request params 需回显 */
  tenant: string;
  streaming: boolean;
  authRequired: boolean;
}

export interface PeerSendResult {
  /** peer 回复文本 (artifacts → status.message → bare, 0 找到 = "") */
  reply: string;
  /** 续聊 context id (response.contextId ?? 发送的 ctx), 下轮原样带回 */
  contextId: string;
  /** TASK_STATE_COMPLETED → "completed" (跟 _short_state 1:1 配对) */
  state: string;
}

/** peer 端点 (跟 a2a_agents 配置 entry 1:1 配对: url + 可选 bearer token) */
export interface PeerEndpoint {
  url: string;
  token?: string;
}

/** Transport 接口 — 返回值跟 Rust proxy 的 HermesResponse 1:1 配对 */
export interface PeerTransport {
  get(url: string, headers: Record<string, string>): Promise<HermesResponse>;
  post(url: string, headers: Record<string, string>, body: string): Promise<HermesResponse>;
}

function defaultTransport(): PeerTransport {
  return {
    get: (url, headers) => invoke<HermesResponse>("hermes_proxy_get", { url, headers }),
    post: (url, headers, body) =>
      invoke<HermesResponse>("hermes_proxy_post", { url, headers, body }),
  };
}

let transport: PeerTransport = defaultTransport();

/** Test-only: 注入 fake transport (传 null 恢复默认 Rust 代理) */
export function __setTransportForTests(t: PeerTransport | null): void {
  transport = t ?? defaultTransport();
}

/** Stores 依赖的最小 bridge 接口 (dependency injection, store 0 import 本模块) */
export interface PeerBridgeLike {
  send(
    url: string,
    token: string | undefined,
    text: string,
    contextId?: string,
  ): Promise<PeerSendResult>;
}

export const realPeerBridge: PeerBridgeLike = {
  send: (url, token, text, contextId) => sendPeerMessage({ url, token }, text, contextId),
};

/** 校验 + 规范化 peer base URL (http/https only, 去尾 slash) */
export function normalizePeerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new PeerBridgeError(
      "invalid-url",
      `Peer URL 必须以 http:// 或 https:// 开头 — 收到 "${raw}"。`,
    );
  }
  return trimmed;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 跟 protocol.py:new_task_id (task- + 16hex) / messageId (32hex) 1:1 配对.
 *  这些是 JSON-RPC 关联 ID (correlation only, 鉴权走 bearer token — 跟
 *  chat-view-store freshId 的非加密兜底先例 1:1 配对) */
function randomHex(len: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(Math.ceil(len / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, len);
  }
  let out = "";
  while (out.length < len) out += Math.floor(Math.random() * 16).toString(16);
  return out.slice(0, len);
}

function isDict(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** HTTP status → 错误分类 (跟 a2a_call 的 HTTPError 分支 1:1 配对) */
function httpError(status: number, peerLabel: string): PeerBridgeError {
  if (status === 401 || status === 403) {
    return new PeerBridgeError(
      "auth",
      `Peer '${peerLabel}' 拒绝了鉴权 (HTTP ${status})。请检查配置的 token。`,
      status,
    );
  }
  if (status === 429) {
    return new PeerBridgeError(
      "rate-limited",
      `Peer '${peerLabel}' 限流 (HTTP 429)。请稍后重试。`,
      status,
    );
  }
  return new PeerBridgeError("http", `调用 '${peerLabel}' 失败 — HTTP ${status}。`, status);
}

function selectJsonrpcInterface(card: Record<string, unknown>):
  | { url?: unknown; tenant?: unknown; protocolVersion?: unknown }
  | null {
  const ifaces = card.supportedInterfaces;
  if (!Array.isArray(ifaces)) return null;
  for (const iface of ifaces) {
    if (isDict(iface) && iface.protocolBinding === "JSONRPC" && iface.url) {
      return iface;
    }
  }
  return null;
}

/** 跟 tools.py:_rpc_url 1:1 配对: iface.url → card.url → base */
function rpcUrlOf(base: string, card: Record<string, unknown> | null): string {
  if (card) {
    const iface = selectJsonrpcInterface(card);
    if (iface && typeof iface.url === "string" && iface.url) return iface.url;
    if (typeof card.url === "string" && card.url) return card.url;
  }
  return base;
}

function tenantOf(card: Record<string, unknown> | null): string {
  if (!card) return "";
  const iface = selectJsonrpcInterface(card);
  return iface && typeof iface.tenant === "string" ? iface.tenant : "";
}

async function fetchCard(
  base: string,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers = { ...authHeaders(token), Accept: "application/json" };
  let res: HermesResponse;
  try {
    res = await transport.get(`${base}/.well-known/agent-card.json`, headers);
    if (res.status === 404) {
      // legacy pre-1.0 card path (跟 tools.py:_legacy_card_url 1:1 配对)
      res = await transport.get(`${base}/.well-known/agent.json`, headers);
    }
  } catch (e) {
    if (e instanceof PeerBridgeError) throw e;
    throw new PeerBridgeError(
      "network",
      `无法连接 Peer '${base}' — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) throw httpError(res.status, base);
  try {
    const card: unknown = JSON.parse(res.body);
    if (!isDict(card)) throw new Error("card is not an object");
    return card;
  } catch {
    throw new PeerBridgeError(
      "invalid-response",
      `Peer '${base}' 的 Agent Card 不是合法 JSON 对象。`,
      res.status,
    );
  }
}

/** v1.0 Message with single text Part (跟 protocol.py:text_message 1:1 配对) */
function textMessage(text: string, contextId: string): Record<string, unknown> {
  return {
    role: ROLE_USER,
    parts: [{ text, mediaType: "text/plain" }],
    messageId: randomHex(32),
    ...(contextId ? { contextId } : {}),
  };
}

/** 跟 protocol.py:unwrap_send_message_response 1:1 配对 */
function unwrapSendMessageResponse(result: unknown): unknown {
  if (isDict(result)) {
    if (isDict(result.task)) return result.task;
    if (isDict(result.message)) return result.message;
  }
  return result;
}

/** parts[].text 拼接 (跟 protocol.py:extract_text 的 v1.0 主路径 1:1 配对;
 *  v0.3 kind:"text" / type 兼容分支不带入 — tray 只对 v1.0 peer 通信) */
function partsText(messageOrTask: unknown): string {
  if (!isDict(messageOrTask)) return "";
  const target = isDict(messageOrTask.message) ? messageOrTask.message : messageOrTask;
  const parts = Array.isArray(target.parts) ? target.parts : [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (isDict(part) && typeof part.text === "string" && part.text) {
      chunks.push(part.text);
    }
  }
  return chunks.join("\n");
}

/** 跟 tools.py:_reply_text_from_result 1:1 配对: artifacts → status.message → bare */
function replyTextFromResult(payload: unknown): string {
  if (!isDict(payload)) return payload == null ? "" : String(payload);
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  for (const artifact of artifacts) {
    const txt = partsText(artifact);
    if (txt) return txt;
  }
  const status = isDict(payload.status) ? payload.status : {};
  if (isDict(status.message)) {
    const txt = partsText(status.message);
    if (txt) return txt;
  }
  return partsText(payload);
}

/** TASK_STATE_COMPLETED → completed (跟 tools.py:_short_state 1:1 配对) */
function shortState(state: unknown): string {
  return typeof state === "string"
    ? state.replace(/^TASK_STATE_/, "").replace(/_/g, "-").toLowerCase()
    : "";
}

/** 拉取并摘要 Agent Card (跟 a2a_discover 1:1 配对, 供 UI 展示 peer 元数据) */
export async function discoverAgent(
  baseUrl: string,
  token?: string,
): Promise<AgentCardSummary> {
  const base = normalizePeerUrl(baseUrl);
  const card = await fetchCard(base, token);
  const iface = selectJsonrpcInterface(card);
  const caps = isDict(card.capabilities) ? card.capabilities : {};
  return {
    name: typeof card.name === "string" ? card.name : "?",
    description: typeof card.description === "string" ? card.description : "",
    rpcUrl: rpcUrlOf(base, card),
    protocolVersion:
      iface && typeof iface.protocolVersion === "string"
        ? iface.protocolVersion
        : typeof card.protocolVersion === "string"
          ? card.protocolVersion
          : PROTOCOL_VERSION,
    tenant: tenantOf(card),
    streaming: caps.streaming === true,
    authRequired: Array.isArray(card.security) && card.security.length > 0,
  };
}

/** 发送一条消息给 peer 并取回回复 (跟 tools.py:_send_task 1:1 配对) */
export async function sendPeerMessage(
  peer: PeerEndpoint,
  text: string,
  contextId?: string,
): Promise<PeerSendResult> {
  const base = normalizePeerUrl(peer.url);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new PeerBridgeError("invalid-request", "消息内容不能为空。");
  }

  // Best-effort card fetch (学 rpc URL + tenant); 失败非致命 (跟 _send_task 1:1)
  let card: Record<string, unknown> | null = null;
  try {
    card = await fetchCard(base, peer.token);
  } catch {
    card = null;
  }

  const ctx = (contextId ?? "").trim() || `ctx-${randomHex(32)}`;
  const tenant = tenantOf(card);
  const body = {
    jsonrpc: "2.0",
    id: `task-${randomHex(16)}`,
    method: "SendMessage",
    params: {
      message: textMessage(trimmed, ctx),
      ...(tenant ? { tenant } : {}),
    },
  };

  let res: HermesResponse;
  try {
    res = await transport.post(
      rpcUrlOf(base, card),
      { "Content-Type": "application/json", ...authHeaders(peer.token) },
      JSON.stringify(body),
    );
  } catch (e) {
    throw new PeerBridgeError(
      "network",
      `无法连接 Peer '${base}' — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) throw httpError(res.status, base);

  let parsed: { result?: unknown; error?: { code?: number; message?: string } };
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new PeerBridgeError(
      "invalid-response",
      `Peer '${base}' 返回了非 JSON 响应 (HTTP ${res.status})。`,
      res.status,
    );
  }
  if (parsed.error) {
    throw new PeerBridgeError(
      "rpc",
      `Peer '${base}' 返回错误: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
    );
  }

  const payload = unwrapSendMessageResponse(parsed.result);
  const reply = replyTextFromResult(payload);
  const replyCtx =
    isDict(payload) && typeof payload.contextId === "string" && payload.contextId
      ? payload.contextId
      : ctx;
  const state = isDict(payload) && isDict(payload.status) ? shortState(payload.status.state) : "";
  return { reply, contextId: replyCtx, state };
}
