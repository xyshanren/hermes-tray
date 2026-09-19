// v0.4.1 — PeersModal (Preact JSX).
//
// Renders into the <div id="peers-modal"> overlay root defined in
// index.html (mount + hidden sync in ./peers-modal-mount.tsx, 跟
// confirm-modal-mount 教训 ④ pattern 1:1 配对).
//
// 布局: 左侧 peer 列表 (名称 + URL + token 标识), 右侧/下方 add/edit 表单
// (name / url / token + 验证按钮走 discoverAgent)。轻量优先: 0 头像 /
// 0 Discord 风格 (跟 plan §1.1 "轻量" 1:1 配对)。

import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useFocusTrap } from "../../lib/focus-trap";
import { peerCatalog, type PeerCatalogState } from "./peer-catalog";
import {
  peersModalStore,
  type PeersModalState,
} from "./peers-modal-store";

export function PeersModal() {
  const [modal, setModal] = useState<PeersModalState>(peersModalStore.get());
  const [catalog, setCatalog] = useState<PeerCatalogState>(peerCatalog.get());
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const trapRef = useFocusTrap(modal.open, primaryRef);

  useEffect(() => peerCatalog.subscribe(setCatalog), []);
  useEffect(() => peersModalStore.subscribe(setModal), []);

  // Escape closes (跟 confirm-modal / search-modal document-level Escape
  // pattern 1:1 配对)
  useEffect(() => {
    if (!modal.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        peersModalStore.close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal.open]);

  if (!modal.open) return null;

  return (
    <div ref={trapRef} class="modal modal-peers" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>Peer 管理</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="关闭"
          onClick={() => peersModalStore.close()}
        >
          ×
        </button>
      </div>

      <div class="peers-body">
        <section class="peers-list-section" data-testid="peers-list">
          {catalog.records.length === 0 ? (
            <p class="peers-empty">
              还没有 peer。添加一个 A2A agent 端点 (http/https URL) 后,
              可以在 Peer DM 单聊或 Bot Chat 群聊里跟它对话。
            </p>
          ) : (
            catalog.records.map((r) => (
              <div class="peers-row" key={r.id} data-testid="peers-row">
                <div class="peers-row-main">
                  <span class="peers-row-name">{r.name}</span>
                  <span class="peers-row-url">{r.url}</span>
                </div>
                <div class="peers-row-actions">
                  {r.token ? <span class="peers-token-badge">token</span> : null}
                  <button
                    type="button"
                    class="peers-row-btn"
                    onClick={() => peersModalStore.startEdit(r)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="peers-row-btn peers-row-danger"
                    onClick={() => peersModalStore.remove(r.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <form
          class="peers-form"
          data-testid="peers-form"
          onSubmit={(e) => {
            e.preventDefault();
            peersModalStore.save();
          }}
        >
          <h3 class="peers-form-title">
            {modal.editingId ? "编辑 peer" : "添加 peer"}
          </h3>
          <label class="peers-field">
            <span>名称</span>
            <Input
              value={modal.draft.name}
              placeholder="e.g. Coder"
              onInput={(e) => peersModalStore.setDraft({ name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="peers-field">
            <span>A2A URL</span>
            <Input
              value={modal.draft.url}
              placeholder="http://100.64.0.1:9999"
              onInput={(e) => peersModalStore.setDraft({ url: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="peers-field">
            <span>Token（可选）</span>
            <Input
              type="password"
              value={modal.draft.token}
              placeholder="Bearer token（对端要求鉴权时填）"
              onInput={(e) => peersModalStore.setDraft({ token: (e.target as HTMLInputElement).value })}
            />
          </label>

          {modal.formError ? (
            <p class="peers-error" role="alert" data-testid="peers-form-error">
              {modal.formError}
            </p>
          ) : null}

          {modal.verifyResult ? (
            <p class="peers-verify-ok" data-testid="peers-verify-ok">
              ✓ {modal.verifyResult.name}
              {modal.verifyResult.description ? ` — ${modal.verifyResult.description}` : ""}
            </p>
          ) : null}
          {modal.verifyError ? (
            <p class="peers-error" role="alert" data-testid="peers-verify-error">
              {modal.verifyError}
            </p>
          ) : null}

          <div class="peers-form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={modal.verifying || !modal.draft.url.trim()}
              onClick={() => void peersModalStore.verify()}
            >
              {modal.verifying ? "验证中…" : "验证连接"}
            </Button>
            <Button type="submit" ref={primaryRef}>
              {modal.editingId ? "保存修改" : "添加"}
            </Button>
            {modal.editingId ? (
              <Button type="button" variant="ghost" onClick={() => peersModalStore.cancelEdit()}>
                取消编辑
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
