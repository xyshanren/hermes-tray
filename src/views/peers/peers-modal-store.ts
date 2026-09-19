// v0.4.1 — PeersModal form store (跟 confirm-modal-store / share-modal-store
// 的 pub-sub 1:1 配对).
//
// 表单是唯一写入口: add/update 走 peerCatalog (校验 + 持久化在数据层),
// 验证走 lib/peer-bridge discoverAgent (fake transport 可测)。

import {
  peerCatalog,
  type PeerRecord,
} from "./peer-catalog";
import { discoverAgent, type AgentCardSummary } from "../../lib/peer-bridge";

export interface PeersModalState {
  open: boolean;
  /** 编辑目标 id (null = 新增模式) */
  editingId: string | null;
  draft: { name: string; url: string; token: string };
  verifying: boolean;
  verifyResult: AgentCardSummary | null;
  verifyError: string | null;
  formError: string | null;
}

const EMPTY_DRAFT = { name: "", url: "", token: "" };

let state: PeersModalState = {
  open: false,
  editingId: null,
  draft: { ...EMPTY_DRAFT },
  verifying: false,
  verifyResult: null,
  verifyError: null,
  formError: null,
};

const listeners = new Set<(state: PeersModalState) => void>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const peersModalStore = {
  get(): PeersModalState {
    return state;
  },

  subscribe(listener: (state: PeersModalState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  open(): void {
    state = { ...state, open: true, formError: null, verifyResult: null, verifyError: null };
    notify();
  },

  close(): void {
    state = {
      ...state,
      open: false,
      editingId: null,
      draft: { ...EMPTY_DRAFT },
      verifying: false,
      verifyResult: null,
      verifyError: null,
      formError: null,
    };
    notify();
  },

  setDraft(patch: Partial<PeersModalState["draft"]>): void {
    state = { ...state, draft: { ...state.draft, ...patch }, formError: null };
    notify();
  },

  startEdit(record: PeerRecord): void {
    state = {
      ...state,
      editingId: record.id,
      draft: { name: record.name, url: record.url, token: record.token ?? "" },
      verifyResult: null,
      verifyError: null,
      formError: null,
    };
    notify();
  },

  cancelEdit(): void {
    state = {
      ...state,
      editingId: null,
      draft: { ...EMPTY_DRAFT },
      verifyResult: null,
      verifyError: null,
      formError: null,
    };
    notify();
  },

  /** discoverAgent 预检 (跟 a2a_discover 1:1 配对): 拉卡确认对端可达 +
   *  展示 agent 名字/描述, 0 落库 */
  async verify(): Promise<void> {
    if (state.verifying) return;
    state = { ...state, verifying: true, verifyResult: null, verifyError: null };
    notify();
    try {
      const card = await discoverAgent(state.draft.url, state.draft.token || undefined);
      state = { ...state, verifying: false, verifyResult: card };
    } catch (e) {
      state = {
        ...state,
        verifying: false,
        verifyError: e instanceof Error ? e.message : String(e),
      };
    }
    notify();
  },

  /** 保存 (新增或更新, 走 peerCatalog 校验 + 持久化)。成功后回列表模式。 */
  save(): boolean {
    const { editingId, draft } = state;
    // update 传原始 token 字符串: 空串 → 清除 (数据层语义 1:1); add 空串
    // 归一成 undefined 不落字段
    const result = editingId
      ? peerCatalog.update(editingId, {
          name: draft.name,
          url: draft.url,
          token: draft.token,
        })
      : peerCatalog.add(draft.name, draft.url, draft.token || undefined);
    if (!result.ok) {
      state = { ...state, formError: result.error ?? "保存失败。" };
      notify();
      return false;
    }
    this.cancelEdit();
    return true;
  },

  remove(id: string): void {
    peerCatalog.remove(id);
    if (state.editingId === id) this.cancelEdit();
  },

  /** Test-only */
  __resetForTests(): void {
    state = {
      open: false,
      editingId: null,
      draft: { ...EMPTY_DRAFT },
      verifying: false,
      verifyResult: null,
      verifyError: null,
      formError: null,
    };
    notify();
  },
};
