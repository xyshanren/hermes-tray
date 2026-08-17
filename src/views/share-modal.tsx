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
import { useFocusTrap } from "../lib/focus-trap";
import { shareStore } from "./share-modal-store";
import { executeShareImport, clearShareHash, validateShareHash } from "./share-flow";

export function ShareImportModal() {
  const [state, setState] = useState(shareStore.get());
  useEffect(() => shareStore.subscribe(setState), []);
  // v0.3-alpha-34: keyboard focus trap (Tab cycling + auto-focus).
  // Wraps whichever view (preview or paste-import) is currently rendered.
  const trapRef = useFocusTrap(state.pasteOpen || state.pending !== null);

  // v0.3: paste-import mode — desktop recipients can't open a #share=
  // URL directly, so they paste the link here. Validate → preview.
  if (state.pasteOpen && !state.pending) {
    return <PasteImportView />;
  }

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
    <div ref={trapRef} class="modal modal-share-import" role="dialog" aria-modal="true">
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

// ── Paste-import view (v0.3) ──────────────────────────────────────────────
//
// Desktop apps can't receive a `#share=...` URL via the browser, so the
// recipient pastes the share link (copied from any channel — IM, email,
// doc) into this textarea. We accept a full URL, a bare `#share=...`
// fragment, or the raw base64url payload, validate it, and hand the
// decoded doc to the preview view above.

function PasteImportView() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // v0.3-alpha-34: focus trap for the paste-import sub-view (separate
  // from the parent ShareImportModal's trap so the lifecycle stays
  // local when this view mounts/unmounts on pasteOpen toggles).
  const trapRef = useFocusTrap(true);

  async function handleParse(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("请先粘贴分享链接");
      return;
    }
    // Normalise the input to a `#share=...` hash so validateShareHash
    // (which expects a URL fragment) can handle all three shapes.
    let hash: string;
    if (trimmed.startsWith("#share=")) {
      hash = trimmed;
    } else if (trimmed.includes("#share=")) {
      hash = "#" + trimmed.slice(trimmed.indexOf("#share="));
    } else {
      // Assume a raw base64url payload.
      hash = `#share=${trimmed}`;
    }
    // v0.3.0 P1-13 — validateShareHash is async (verifies the v2 SHA-256
    // checksum via crypto.subtle.digest). v1 docs skip the checksum and
    // are accepted as legacy.
    const result = await validateShareHash(hash);
    if (result.ok) {
      setError(null);
      shareStore.setPending(result.doc); // switches to preview mode
    } else if (result.reason === "checksum-mismatch") {
      setError("链接已损坏 — 校验和不匹配，可能被篡改或转码损坏");
    } else if (result.reason === "unsupported-version") {
      setError(`链接版本不支持 (version=${result.version ?? "?"})`);
    } else {
      setError("无法解析分享链接 — 请确认复制完整");
    }
  }

  return (
    <div ref={trapRef} class="modal modal-share-import" role="dialog" aria-modal="true" aria-label="粘贴导入分享">
      <div class="modal-header">
        <h2>📥 导入分享的会话</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭导入"
          onClick={() => shareStore.setPasteOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <p class="share-paste-hint">
          粘贴好友发来的分享链接（含 <code>#share=</code> 的完整地址，
          或直接粘贴链接主体）。解析后会预览会话内容，确认后再导入。
        </p>
        <textarea
          class="share-paste-input"
          rows={6}
          placeholder="http://…/#share=eyJ2ZXJzaW9uIjo…  或直接粘贴 #share= 后的内容"
          value={text}
          onInput={(e) => {
            setText((e.currentTarget as HTMLTextAreaElement).value);
            setError(null);
          }}
        />
        {error ? <div class="share-paste-error">{error}</div> : null}
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => shareStore.setPasteOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={!text.trim()}
          onClick={handleParse}
        >
          🔍 解析链接
        </button>
      </div>
    </div>
  );
}