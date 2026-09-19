// v0.4.1 — Peer catalog (peer 管理 data layer).
//
// v0.4.0 的 peerDMStore.setPeer / botChatStore.setPeers 只能测试驱动;
// 本模块把 peer 端点记录变成用户可管理的数据 + 持久化:
//   - PeerDM: 从 catalog 单选 1 peer → peerDMStore.setPeer
//   - Bot Chat: catalog 全体 (≤6 cap 由 store 侧执行) → botChatStore.setPeers
//
// 持久化走 db_config 通用 KV ("peer_endpoints" key, JSON array) — 0 改 Rust
// (跟 config-schema.ts 头注 "The db_config table is a generic key-value
// store; Rust doesn't enforce a schema" 1:1 配对)。
//
// URL 校验复用 lib/peer-bridge normalizePeerUrl (http/https only) — token
// 明文存 db_config (本地 SQLite, 跟 gateway apiKey 同级存储, 0 额外加密,
// 跟 settings 现有处理 1:1 配对)。
//
// 错误分类 (跟 AGENTS.md 教训 ② "validator 不 fold failure case" 1:1):
//   add/update 失败 → { ok: false, error: string } 返回给表单展示, 0 静默。

import { getConfig, setConfig } from "../../lib/db-config";
import { normalizePeerUrl } from "../../lib/peer-bridge";
import type { BotPeer } from "../bot-chat/bot-chat-store";

export const PEER_ENDPOINTS_CONFIG_KEY = "peer_endpoints";

export interface PeerRecord {
  id: string;
  name: string;
  /** http(s) URL (normalizePeerUrl 校验过) */
  url: string;
  /** 可选 bearer token (跟 a2a_agents auth 1:1 配对) */
  token?: string;
}

export interface PeerCatalogState {
  records: PeerRecord[];
  /** boot loadFromConfig() 完成后置 true (0 loaded 前视图用默认 mock peers) */
  loaded: boolean;
}

function freshId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `peer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let state: PeerCatalogState = { records: [], loaded: false };

const listeners = new Set<(state: PeerCatalogState) => void>();

function notify(): void {
  for (const l of listeners) l(state);
}

function persist(): void {
  void setConfig(PEER_ENDPOINTS_CONFIG_KEY, JSON.stringify(state.records));
}

function recordById(id: string): PeerRecord | undefined {
  return state.records.find((r) => r.id === id);
}

/** @mention 名字必须喂得进 bot-chat 的 /@(\w+)/ 路由 regex → 归一到
 *  [a-z0-9_] (跟 bot-chat-store.parseMentionsFromText 1:1 配对) */
export function mentionFor(name: string): string {
  const m = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return m || "peer";
}

/** Bot role 推断 (researcher/coder/tester 关键词, 其余 general — 跟
 *  bot-chat 默认 3 bot 命名 1:1 配对) */
export function roleFor(name: string): BotPeer["role"] {
  const lower = name.toLowerCase();
  if (lower.includes("research") || lower.includes("研究")) return "researcher";
  if (lower.includes("coder") || lower.includes("code") || lower.includes("编程"))
    return "coder";
  if (lower.includes("test") || lower.includes("测试")) return "tester";
  return "general";
}

export const peerCatalog = {
  get(): PeerCatalogState {
    return state;
  },

  subscribe(listener: (state: PeerCatalogState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** boot 时从 db_config 拉取 (解析失败 → 空表 + warn, 0 静默吞 —
   *  跟 AGENTS.md 教训 ② 独立 failure case 1:1 配对) */
  async load(): Promise<void> {
    const raw = await getConfig(PEER_ENDPOINTS_CONFIG_KEY);
    let records: PeerRecord[] = [];
    if (raw != null && raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          records = parsed.filter(
            (r): r is PeerRecord =>
              typeof r === "object" &&
              r !== null &&
              typeof (r as PeerRecord).id === "string" &&
              typeof (r as PeerRecord).name === "string" &&
              typeof (r as PeerRecord).url === "string",
          );
        } else {
          console.warn("[peer-catalog] peer_endpoints 不是数组, 忽略并重置");
        }
      } catch (e) {
        console.warn("[peer-catalog] peer_endpoints JSON 解析失败, 忽略:", e);
      }
    }
    state = { records, loaded: true };
    notify();
  },

  /** 新增 peer。URL / name 校验失败返回 { ok: false, error } (表单展示,
   *  0 静默); 成功落内存 + 持久化。 */
  add(name: string, url: string, token?: string): { ok: boolean; error?: string } {
    const trimmedName = name.trim();
    if (!trimmedName) return { ok: false, error: "名称不能为空。" };
    if (state.records.some((r) => r.name === trimmedName)) {
      return { ok: false, error: `已存在同名 peer "${trimmedName}"。` };
    }
    let normalized: string;
    try {
      normalized = normalizePeerUrl(url);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const record: PeerRecord = {
      id: freshId(),
      name: trimmedName,
      url: normalized,
      ...(token && token.trim() ? { token: token.trim() } : {}),
    };
    state = { ...state, records: [...state.records, record] };
    notify();
    persist();
    return { ok: true };
  },

  update(
    id: string,
    patch: { name?: string; url?: string; token?: string },
  ): { ok: boolean; error?: string } {
    const existing = recordById(id);
    if (!existing) return { ok: false, error: `peer ${id} 不存在。` };
    const name = patch.name?.trim() ?? existing.name;
    if (!name) return { ok: false, error: "名称不能为空。" };
    if (state.records.some((r) => r.name === name && r.id !== id)) {
      return { ok: false, error: `已存在同名 peer "${name}"。` };
    }
    let url = existing.url;
    if (patch.url != null && patch.url.trim() && patch.url.trim() !== existing.url) {
      try {
        url = normalizePeerUrl(patch.url);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const token =
      patch.token === undefined
        ? existing.token
        : patch.token.trim()
          ? patch.token.trim()
          : undefined;
    state = {
      ...state,
      records: state.records.map((r) => (r.id === id ? { ...r, name, url, token } : r)),
    };
    notify();
    persist();
    return { ok: true };
  },

  remove(id: string): void {
    state = { ...state, records: state.records.filter((r) => r.id !== id) };
    notify();
    persist();
  },

  /** Bot Chat 房间映射: catalog 全体 → BotPeer[] (≤6 cap 由 botChatStore
   *  setPeers 执行, 这里不重复裁) */
  toBotPeers(): BotPeer[] {
    return state.records.map((r) => ({
      id: r.id,
      mention: mentionFor(r.name),
      name: r.name,
      role: roleFor(r.name),
      url: r.url,
      ...(r.token ? { token: r.token } : {}),
    }));
  },

  /** Peer DM 映射: 单选 1 条 → peerDMStore.setPeer 形状 (gateway = url) */
  toPeerDMPeer(id: string): { id: string; name: string; gateway: string; token?: string } | null {
    const r = recordById(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      gateway: r.url,
      ...(r.token ? { token: r.token } : {}),
    };
  },

  /** Test-only: reset module-level state (跟其他 store 1:1 配对) */
  __resetForTests(): void {
    state = { records: [], loaded: false };
    notify();
  },
};

export const __peerCatalogTesting = { freshId };
