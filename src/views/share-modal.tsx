// v0.2-alpha-15 — ShareImportModal (Preact JSX).
//
// Renders the import confirmation overlay into the existing
// <div id="share-import-modal"> root defined in index.html.
//
// Replaces the v0.1.5 native `window.confirm()` dialog with a proper
// Preact modal — shows the decoded doc's title + message count +
// a 2-message preview, and lets the user click "导入" or "取消".
// On Import: calls executeShareImport() + clearShareHash() + closes.
// On Cancel: just clears pending.

import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../lib/toast";
import { shareStore } from "./share-modal-store";
import { executeShareImport, clearShareHash } from "./share-flow";

export function ShareImportModal() {
  const [state, setState] = useState(shareStore.get());
  useEffect(() => shareStore.subscribe(setState), []);
  if (!state.pending) return null;

  const doc = state.pending;
  const msgCount = doc.messages?.length ?? 0;
  // Show first 2 messages as a preview so the user knows what they're importing.
  const previewMessages = doc.messages.slice(0, 2);

  async function handleImport(): Promise<void> {
    shareStore.setImporting(true);
    try {
      const newId = await executeShareImport(invoke, doc);
      clearShareHash();
      shareStore.setPending(null);
      showToast(
        "已导入",
        `${msgCount} 条消息 → ${newId}`,
        "success",
      );
    } catch (e) {
      shareStore.setImporting(false);
      showToast("导入失败", String(e), "error");
    }
  }

  function handleCancel(): void {
    shareStore.setPending(null);
  }

  return (
    <div class="modal modal-share-import" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>📥 导入分享的会话</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭导入"
          onClick={handleCancel}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <section class="share-import-preview">
          <div class="share-import-field">
            <label>标题</label>
            <div class="share-import-value">{doc.session.title}</div>
          </div>
          <div class="share-import-field">
            <label>消息数</label>
            <div class="share-import-value">{msgCount}</div>
          </div>
          {previewMessages.length > 0 ? (
            <div class="share-import-field">
              <label>预览（前 2 条）</label>
              <div class="share-import-messages">
                {previewMessages.map((m, idx) => (
                  <div key={idx} class={`share-import-msg share-import-msg-${m.role}`}>
                    <span class="share-import-role">{m.role}</span>
                    <span class="share-import-content">
                      {m.content.slice(0, 120)}
                      {m.content.length > 120 ? "…" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <p class="share-import-warning">
            ⚠️ 导入会创建一个新会话（标题前加「[分享]」），原分享链接里的
            persona / project 不会带入。消息会按顺序逐条追加。
          </p>
        </section>
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          disabled={state.isImporting}
          onClick={handleCancel}
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={state.isImporting}
          onClick={() => void handleImport()}
        >
          {state.isImporting ? "导入中…" : `📥 导入 ${msgCount} 条消息`}
        </button>
      </div>
    </div>
  );
}