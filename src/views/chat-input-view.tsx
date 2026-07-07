// v0.2-alpha-18 — ChatInput (Preact JSX).
//
// Renders the chat input form (textarea + send button + char count +
// attachment preview strip + mic button + 📎 attach button + drag/drop
// overlay) into the existing form shell in index.html. Subscribes to
// chatInputStore for pendingAttachments + isRecording; the textarea
// text itself stays in local component state so cursor position + IME
// composition aren't disturbed by store-driven re-renders.
//
// Sub-components:
//   - AttachmentStrip  — previews pending images with × remove buttons
//   - MicButton        — pulse-red class when isRecording
//   - AttachButton     — hidden <input type="file"> + 📎 trigger
//   - SendButton       — disabled when isLoading or over the length cap
//   - CharCount        — "N / 4000" counter, red when over cap
//
// Cross-cutting actions (send submit / attach files / mic toggle /
// drag-drop) come in via props from main.ts so this view stays a pure
// renderer. main.ts owns the Tauri invokes (MediaRecorder, hermes_*
// proxy, fileToAttachment) and the SSE submit pipeline.

import { useEffect, useRef, useState } from "preact/hooks";
import { chatInputStore } from "./chat-input-store";
import type { ChatInputState } from "./chat-input-store";
import type { PendingAttachment } from "./chat-view-store";

export interface ChatInputProps {
  /** True while a chat reply is being streamed. Disables the send
   *  button + textarea so the user can't fire a second send mid-reply. */
  isLoading: boolean;
  /** Called when the user presses Enter (without Shift) or clicks
   *  Send. `text` is the trimmed textarea content; `attachments` is
   *  the current pendingAttachments list (the store is cleared
   *  inside this callback by main.ts). */
  onSubmit: (text: string, attachments: PendingAttachment[]) => void | Promise<void>;
  /** Called when the user picks files via 📎 or drops them onto the
   *  form. main.ts owns fileToAttachment (Tauri side-effects + base64
   *  encoding) and decides what to push into chatInputStore. */
  onAttach: (files: FileList | File[]) => void;
  /** Called when the user clicks the mic button. main.ts owns the
   *  MediaRecorder + hermes_proxy_transcribe invoke; this callback
   *  just toggles start/stop. The recording class is driven by
   *  chatInputStore.isRecording. */
  onMicToggle: () => void;
}

export function ChatInput(props: ChatInputProps) {
  const [state, setState] = useState<ChatInputState>(chatInputStore.get());
  // Textarea content + height are local so the cursor doesn't jump
  // when chatInputStore notifies (e.g. mic button pulse). main.ts
  // can still read the live value via the imperative handle exposed
  // by mountChatInput() (focus, clearText, appendText).
  const [text, setText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => chatInputStore.subscribe(setState), []);

  // Auto-resize the textarea on every text change. The reset-then-set
  // pattern (clear height → measure scrollHeight → clamp to 200px)
  // matches v0.1.5's handleInput behaviour; we moved the call site
  // into the view because the height depends on the live DOM node.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // v0.2-alpha-24 — cap the auto-resize at 160px (was 200px).
    // The shorter placeholder + tighter line-height keeps the
    // empty-state footer compact; the cap matches a typical 6-line
    // turn before the user has to scroll inside the textarea.
    const newHeight = Math.min(el.scrollHeight, 160);
    el.style.height = newHeight + "px";
  }, [text]);

  const length = text.length;
  const tooLong = length > state.maxInputLength;
  const canSend = !props.isLoading && (length > 0 || state.pendingAttachments.length > 0);
  const canSubmit = canSend && !tooLong;

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    // Snapshot before clearing — main.ts reads from this snapshot and
    // resets the store inside its callback.
    const trimmed = text.trim();
    void props.onSubmit(trimmed, [...state.pendingAttachments]);
  }

  function handleKeydown(e: KeyboardEvent) {
    // v0.1.5 behaviour: Enter alone sends, Shift+Enter inserts newline.
    // IME composition (CJK input method) is handled by the browser —
    // composition events fire on the textarea and we just check
    // `isComposing` to avoid swallowing a committed Enter mid-IME.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // Trigger the form submit (which calls onSubmit via the listener
      // below). Going through submit keeps the validation pipeline in
      // one place.
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  return (
    <form
      class={`chat-form${state.isRecording ? " is-recording" : ""}${tooLong ? " is-too-long" : ""}`}
      onSubmit={handleSubmit}
    >
      <AttachmentStrip
        attachments={state.pendingAttachments}
        onRemove={(idx) => chatInputStore.removeAttachment(idx)}
      />
      <div class="chat-input-row">
        <AttachButton
          onAttach={props.onAttach}
          disabled={props.isLoading}
        />
        <MicButton
          isRecording={state.isRecording}
          onToggle={props.onMicToggle}
        />
        <textarea
          ref={textareaRef}
          id="message-input"
          class={`message-input${isFocused ? " focused" : ""}`}
          placeholder="输入消息...  (Enter 发送 · Shift+Enter 换行)"
          rows={1}
          value={text}
          disabled={props.isLoading}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={handleKeydown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        <SendButton
          label="发送"
          loadingLabel="生成中..."
          isLoading={props.isLoading}
          canSend={canSubmit}
        />
      </div>
      <div class="input-info">
        <CharCount length={length} max={state.maxInputLength} tooLong={tooLong} />
      </div>
    </form>
  );
}

// ── Attachment strip ───────────────────────────────────────────────────────

interface AttachmentStripProps {
  attachments: PendingAttachment[];
  onRemove: (idx: number) => void;
}

function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  if (attachments.length === 0) {
    // Render the empty container with the .hidden class so the CSS
    // slot stays in the DOM (some users rely on the drop-zone height
    // being 0 for layout reasons — same behaviour as v0.1.5).
    return <div id="attachment-previews" class="attachment-previews hidden" />;
  }
  return (
    <div id="attachment-previews" class="attachment-previews">
      {attachments.map((a, idx) => (
        <div key={a.id ?? `att-${idx}`} class="attachment-thumb">
          <img src={a.dataUrl} alt={a.name} />
          <button
            type="button"
            class="attachment-remove"
            title="移除"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(idx);
            }}
          >
            ×
          </button>
          <div class="attachment-meta">
            <div class="attachment-name">{a.name}</div>
            <div class="attachment-size">{formatBytes(a.size)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Mic + Attach + Send buttons ─────────────────────────────────────────────

function MicButton({ isRecording, onToggle }: { isRecording: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      id="mic-btn"
      class={`icon-btn${isRecording ? " recording" : ""}`}
      title={isRecording ? "点击停止录音并转写" : "语音输入 (T-Q-S13, 点击开始, 再点停止并转写)"}
      onClick={onToggle}
    >
      <MicIcon />
    </button>
  );
}

function AttachButton({ onAttach, disabled }: { onAttach: (files: FileList) => void; disabled: boolean }) {
  // The native <input type="file"> stays hidden — the visible 📎
  // button (next sibling in index.html? no — we render the button +
  // input together here) clicks the input programmatically.
  return (
    <>
      <button
        type="button"
        id="attach-btn"
        class="icon-btn"
        title="附加图片 (T-Q-S14, 也可直接拖拽)"
        disabled={disabled}
        onClick={() => document.getElementById("attach-file-input")?.click()}
      >
        <AttachIcon />
      </button>
      <input
        type="file"
        id="attach-file-input"
        accept="image/*"
        multiple
        style="display: none"
        onChange={(e) => {
          const files = (e.currentTarget as HTMLInputElement).files;
          if (files && files.length > 0) {
            onAttach(files);
            // Reset so picking the same file twice still fires onChange.
            (e.currentTarget as HTMLInputElement).value = "";
          }
        }}
      />
    </>
  );
}

interface SendButtonProps {
  label: string;
  loadingLabel: string;
  isLoading: boolean;
  canSend: boolean;
}

function SendButton({ label, loadingLabel, isLoading, canSend }: SendButtonProps) {
  return (
    <button
      type="submit"
      id="send-btn"
      class="send-btn"
      disabled={!canSend}
    >
      {isLoading ? (
        <span id="send-btn-label">{loadingLabel}</span>
      ) : (
        <>
          <span id="send-btn-label">{label}</span>
          <svg viewBox="0 0 24 24" width="20" height="20" id="send-btn-icon">
            <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </>
      )}
    </button>
  );
}

function CharCount({ length, max, tooLong }: { length: number; max: number; tooLong: boolean }) {
  return (
    <span
      id="char-count"
      class="char-count"
      style={tooLong ? { color: "var(--error)" } : undefined}
    >
      {length} / {max}
    </span>
  );
}

// ── Inline SVG icons (matching the v0.1.5 markup) ──────────────────────────

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="currentColor"
        d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"
      />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="currentColor"
        d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"
      />
    </svg>
  );
}