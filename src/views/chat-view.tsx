// v0.2-alpha-16 — ChatView (Preact JSX).
//
// Renders the message list + the active streaming bubble + transient
// errors + the welcome screen into the existing `<div id="messages">`
// shell defined in index.html. The component subscribes to chatStore
// for state; main.ts drives the store via the mutators in
// chat-view-store.ts.
//
// What lives here vs. what stays in main.ts:
//   - HERE:  message bubble rendering, streaming bubble rendering,
//            welcome screen, error bubble, auto-scroll-to-bottom.
//   - MAIN:  input form (textarea + send button + char count +
//            attachment previews + mic/attach buttons + drag-drop +
//            Enter to submit) — it stays in main.ts because it's
//            tightly coupled to the SSE submit pipeline (handleSubmit
//            → createSession → addMessage → sendMessage). alpha-17
//            will lift this once the streaming submit is also
//            migrated to a Preact-friendly path.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  chatStore,
  formatMessage,
  type ChatMessage,
  type ChatMessageBar,
  type PendingAttachment,
} from "./chat-view-store";
import type { ChatStoreState } from "./chat-view-store";

interface WelcomeContext {
  /** Override the headline emoji + text (default: "👋 欢迎使用 Hermes Chat"). */
  headline?: string;
  /** Persona badge line (when set). */
  persona?: { avatar: string; name: string } | null;
  /** Project hint line (when set). scanFailed shows a different label. */
  project?: { name: string; version?: string; path?: string; scanFailed?: boolean } | null;
}

/**
 * v0.2-alpha-20 — Default welcome (design 06).
 *
 * Shown when the user has at least one session + the gateway is
 * reachable + the current view has no messages + no active error.
 * Matches the v0.1.5 lightweight welcome (👋 headline + persona /
 * project hint lines) — see design 06 for the simpler v0.2 variant
 * (persona chips + CTA + shortcuts hint). The persona / project
 * "badge" rows from the v0.1.5 welcome still appear when context
 * supplies them, so the personalisation line isn't lost.
 */
function WelcomeBubble({ context }: { context: WelcomeContext | null }) {
  const headline = context?.headline ?? "👋 欢迎使用 Hermes Chat";
  const persona = context?.persona;
  const project = context?.project;
  const hintLines: string[] = [];
  if (persona) {
    hintLines.push(`Persona: ${persona.avatar ?? ""} ${persona.name}`);
  }
  if (project) {
    if (project.scanFailed) {
      hintLines.push(`项目路径已设置但扫描失败: ${project.path ?? ""}`);
    } else {
      const ver = project.version ? ` v${project.version}` : "";
      const path = project.path ? ` (${project.path})` : "";
      hintLines.push(`项目: ${project.name}${ver}${path}`);
    }
  }
  if (hintLines.length === 0) {
    hintLines.push("在下方输入消息开始对话");
  }
  return (
    <div class="welcome-message">
      <p>{headline}</p>
      {hintLines.map((line, i) => (
        <p key={i} class="hint">{line}</p>
      ))}
    </div>
  );
}

/**
 * v0.2-alpha-20 — First-run welcome (design 06 main-card variant).
 *
 * Bigger, friendlier version of WelcomeBubble used on first launch
 * (no sessions in DB yet). Centered card with logo, description,
 * recommended-persona chips, the primary "create first session" CTA,
 * and a keyboard-shortcuts hint footer. main.ts wires the CTA to
 * createSession(); the chips surface the same personas the user
 * will see in the picker (cosmetic for now — clicking a chip also
 * creates the session).
 */
function FirstRunWelcome({
  onCreateSession,
  recommendedPersonas,
}: {
  onCreateSession: () => void;
  recommendedPersonas: { avatar: string; name: string; tag: string }[];
}) {
  return (
    <div class="welcome-card first-run-welcome" role="region" aria-label="首次使用引导">
      <div class="welcome-card-logo" aria-hidden="true">💬</div>
      <h2 class="welcome-card-title">欢迎使用 Hermes Chat</h2>
      <p class="welcome-card-desc">
        Hermes 是你的本地 AI 对话助手，支持多会话管理、Token 成本统计与加密备份。
        选择一个 Persona 开始你的第一次对话。
      </p>
      <div class="welcome-card-divider">推荐 Persona</div>
      <div class="welcome-card-personas">
        {recommendedPersonas.map((p) => (
          <button
            key={p.name}
            type="button"
            class="persona-chip"
            onClick={onCreateSession}
          >
            <span class="persona-chip-avatar" aria-hidden="true">{p.avatar}</span>
            <span class="persona-chip-text">
              <span class="persona-chip-name">{p.name}</span>
              <span class="persona-chip-tag">{p.tag}</span>
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        class="btn btn-primary welcome-card-cta"
        onClick={onCreateSession}
      >
        创建第一个会话 →
      </button>
      <p class="welcome-card-shortcuts">
        或按 <kbd>Ctrl</kbd>+<kbd>K</kbd> 快速搜索 · <kbd>Ctrl</kbd>+<kbd>N</kbd> 新建会话
      </p>
    </div>
  );
}

/**
 * v0.2-alpha-20 — Empty (no network, design 07).
 *
 * Shown when checkConnection() reports the gateway is offline + no
 * messages are loaded. Centered card with an error icon, the
 * human-readable reason ("无法连接 hermes-agent"), the gateway URL
 * (passed in via `gatewayHint` so we don't pull it from a global),
 * and two action buttons: retry the connection, or open the
 * settings modal to fix the URL / API key.
 */
function EmptyNoNetwork({
  gatewayHint,
  onRetry,
  onOpenSettings,
}: {
  gatewayHint: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div class="welcome-card no-network-card" role="status" aria-live="polite">
      <div class="welcome-card-error-icon" aria-hidden="true">⚠️</div>
      <h2 class="welcome-card-title">无法连接 hermes-agent</h2>
      <p class="welcome-card-desc">
        请检查 hermes-agent 服务是否启动，或确认 Gateway 地址是否正确。
      </p>
      <p class="welcome-card-hint">{gatewayHint}</p>
      <div class="welcome-card-actions">
        <button type="button" class="btn btn-primary" onClick={onRetry}>
          重试连接
        </button>
        <button type="button" class="btn btn-secondary" onClick={onOpenSettings}>
          查看连接设置
        </button>
      </div>
    </div>
  );
}

/**
 * v0.2-alpha-20 — design 08 mapping.
 *
 * The "online + has sessions in DB but the user just deleted the
 * active one" case (design 08) is currently unreachable in our boot
 * flow because loadLastSession() always picks the most recent
 * session — there's no path where currentSessionId=null while
 * hasSessions=true. When we eventually add a "create new session,
 * no auto-select" UX we'll re-introduce EmptyNoSessions as a slim
 * variant of FirstRunWelcome (persona chips don't apply when the
 * user is past first-run). For now the standard WelcomeBubble
 * covers design 08 — see ChatView's `showStandardWelcome` branch.
 *
 * Keeping this comment block as a marker so the next person knows
 * where design 08 lives in the wiring.
 */

function UserBubble({ msg }: { msg: ChatMessage }) {
  // User messages render attachments as a thumbnail strip + the raw
  // text below. We DO NOT markdown-render user content — that would be
  // an XSS vector if the model ever echoes user input back to another
  // user. main.ts guarantees user text comes from a trusted textarea.
  return (
    <div class="message user">
      <div class="message-avatar">👤</div>
      <div class="message-content">{msg.content}</div>
      {msg.attachments && msg.attachments.length > 0 ? (
        <AttachmentStrip attachments={msg.attachments} />
      ) : null}
    </div>
  );
}

function AssistantBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div class="message assistant">
      <div class="message-avatar">🤖</div>
      <div
        class="message-content"
        // marked.parse returns sanitised GFM HTML. Assistant content is
        // generated by the agent (a trusted side) but still rendered
        // as innerHTML — see AGENTS.md §security for the threat model.
        dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
      />
      {msg.bar ? <MessageBar bar={msg.bar} /> : null}
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  // We render the streaming bubble with the same shape as a finalised
  // assistant bubble so the user's eye doesn't jump when the stream
  // finalises. The "is-streaming" class is purely cosmetic (CSS can
  // show a subtle pulse if desired) — semantics don't depend on it.
  return (
    <div class="message assistant is-streaming">
      <div class="message-avatar">🤖</div>
      <div
        class="message-content"
        dangerouslySetInnerHTML={{ __html: formatMessage(content) }}
      />
    </div>
  );
}

function ErrorBubble({ message }: { message: string }) {
  // We render the gateway URL inline so the user can see the address
  // the tray was trying to reach — matches the v0.1.5 message verbatim
  // for visual regression parity.
  // We can't easily get the URL into JSX without lifting it through
  // the store, so we keep the existing message format and just embed
  // the human-readable part. main.ts continues to log the full URL.
  return (
    <div class="message error">
      <div class="message-content">
        ❌ {message}
      </div>
    </div>
  );
}

/**
 * v0.2-alpha-22 — Block error (design 18 "整块错误").
 *
 * Shown when there's an error AND no messages — e.g. session load
 * failed before any message was hydrated. Centered card with a red
 * ❌ icon, the headline reason, the underlying message, and an
 * optional retry button. Distinct from ErrorBubble (which renders
 * inline under the message list when messages exist).
 */
function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div class="error-block" role="alert">
      <div class="error-block-icon" aria-hidden="true">❌</div>
      <h3 class="error-block-title">加载会话失败</h3>
      <p class="error-block-message">{message}</p>
      {onRetry ? (
        <button type="button" class="btn btn-primary" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

/**
 * v0.2-alpha-22 — Fatal error banner (design 18 "致命错误 Banner").
 *
 * Sticky to the top of the chat surface. Fixed visibility — the
 * user must click × to dismiss (which calls chatStore.clearFatal).
 * Used for runtime fatals (DB corruption, gateway dropped
 * mid-session) where the app can still render but the user must
 * acknowledge before normal UI resumes.
 *
 * Renders NOTHING when chatStore.fatal is null — the banner doesn't
 * take space when not in use.
 */
function FatalBanner() {
  const message = useFatalBannerMessage();
  if (message === null) return null;
  return (
    <div class="fatal-banner" role="alert" aria-live="assertive">
      <div class="fatal-banner-icon" aria-hidden="true">⚠️</div>
      <div class="fatal-banner-text">
        <strong class="fatal-banner-title">无法连接 Hermes Gateway</strong>
        <span class="fatal-banner-message">{message}</span>
      </div>
      <button
        type="button"
        class="fatal-banner-dismiss"
        aria-label="关闭"
        onClick={() => chatStore.clearFatal()}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Lightweight subscription hook for the fatal-banner message. We
 * only need the string (not the full state object) so the banner
 * doesn't re-render on unrelated chat mutations.
 */
function useFatalBannerMessage(): string | null {
  const [message, setMessage] = useState<string | null>(chatStore.get().fatal);
  useEffect(() => chatStore.subscribe((s) => setMessage(s.fatal)), []);
  return message;
}

function AttachmentStrip({ attachments }: { attachments: PendingAttachment[] }) {
  return (
    <div class="message-attachments">
      {attachments.map((a, idx) => (
        // Fall back to the array index when no id is present (older
        // attachments without crypto.randomUUID). Stable enough since
        // user bubbles rarely re-render in place.
        <div key={a.id ?? `att-${idx}`} class="message-attachment">
          {a.type.startsWith("image/") ? (
            <img src={a.dataUrl} alt={a.name} class="message-attachment-thumb" />
          ) : (
            <div class="message-attachment-file">📎 {a.name}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function MessageBar({ bar }: { bar: ChatMessageBar }) {
  const className = bar.costThresholdExceeded ? "message-bar message-bar-warn" : "message-bar";
  // formatMessageBar is a pure function — imported for parity with
  // the inline formatters in src/lib/chat-formatters.ts. We render
  // the bar text content directly (no HTML interpolation needed).
  const text = renderBarText(bar);
  if (!text) return null;
  return <div class={className}>{text}</div>;
}

/**
 * Local copy of formatMessageBar to keep the Preact component free of
 * direct DOM-builder imports. The DOM-builder version lives in
 * chat-formatters.ts for the imperative call site in finishStream.
 */
function renderBarText(bar: ChatMessageBar): string | null {
  const parts: string[] = [];
  if (bar.costUsd > 0) parts.push(`💰 $${bar.costUsd.toFixed(4)}`);
  if (bar.elapsedMs != null && bar.elapsedMs > 0) {
    const ms = bar.elapsedMs;
    const latency = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    parts.push(`⏱ ${latency}`);
  }
  if (bar.ruleId) {
    parts.push(`🛡 ${bar.ruleId}`);
  } else if (bar.costThresholdExceeded) {
    parts.push("🛡 cost_threshold_exceeded");
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function ChatView({
  welcomeContext,
  onCreateSession,
  onRetryConnection,
  onOpenSettings,
  recommendedPersonas,
  gatewayHint,
}: {
  welcomeContext?: WelcomeContext | null;
  onCreateSession?: () => void;
  onRetryConnection?: () => void;
  onOpenSettings?: () => void;
  /** Persona chips shown in the first-run welcome card. Defaults to
   *  the built-in `hermes-agent` + `code-reviewer` pair from design 06
   *  when the caller doesn't supply a list. */
  recommendedPersonas?: { avatar: string; name: string; tag: string }[];
  /** Human-readable gateway hint shown in the no-network card. */
  gatewayHint?: string;
}) {
  const [state, setState] = useState<ChatStoreState>(chatStore.get());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => chatStore.subscribe(setState), []);

  // Auto-scroll to bottom on every state change. We don't compare to
  // previous state — Preact bails out re-renders when the store
  // reference is unchanged, so we only land here when something
  // actually changed. The user's manual scroll-up is preserved
  // between renders because we only scroll the container itself.
  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state]);

  const isEmpty =
    state.messages.length === 0 && state.streaming === null && state.error === null;

  // v0.2-alpha-20: pick the empty-state variant based on
  // connectionStatus + hasSessions. Priority:
  //   1. no-network  (design 07 — error card)
  //   2. first-run   (design 06 — welcome card with persona chips)
  //   3. standard    (lightweight WelcomeBubble — alpha-16 default)
  // No-network wins on first launch so the user sees the error early
  // instead of a clean empty state that hides the bug.
  const showNoNetwork = isEmpty && state.connectionStatus === "offline";
  const showFirstRun =
    isEmpty && state.connectionStatus === "online" && !state.hasSessions;
  const showStandardWelcome =
    isEmpty && state.connectionStatus === "online" && state.hasSessions;

  // v0.2-alpha-22: pick the error variant based on whether any
  // messages have loaded. Block error (design 18 "整块错误") wins
  // when there are no messages — gives the user a clear
  // "what went wrong + retry" surface. Inline ErrorBubble stays
  // for the messages-present case (it appends below the last
  // turn, matching the alpha-16 behavior).
  const showErrorBlock = state.error !== null && state.messages.length === 0;

  // Default persona chips for the first-run card (design 06). The
  // caller can override via the prop — main.ts will eventually pass
  // the real personasCache here, but the static defaults keep the
  // view self-contained for tests + the alpha-20 boot.
  const personas = recommendedPersonas ?? DEFAULT_RECOMMENDED_PERSONAS;

  return (
    <div ref={scrollRef} class="chat-view">
      {/* v0.2-alpha-22: FatalBanner sits at the top of the chat
          surface (design 18 "致命错误 Banner"). It subscribes to
          chatStore.fatal independently of the main view state, so
          unrelated mutations don't cause it to re-render. */}
      <FatalBanner />
      {state.messages.map((m) =>
        m.role === "user" ? (
          <UserBubble key={messageKey(m)} msg={m} />
        ) : (
          <AssistantBubble key={messageKey(m)} msg={m} />
        ),
      )}
      {state.streaming ? <StreamingBubble content={state.streaming.content} /> : null}
      {state.error && !showErrorBlock ? <ErrorBubble message={state.error} /> : null}
      {showErrorBlock ? (
        <ErrorBlock
          message={state.error!}
          onRetry={() => onRetryConnection?.()}
        />
      ) : null}
      {showNoNetwork ? (
        <EmptyNoNetwork
          gatewayHint={gatewayHint ?? "默认 Gateway: http://127.0.0.1:8788"}
          onRetry={() => onRetryConnection?.()}
          onOpenSettings={() => onOpenSettings?.()}
        />
      ) : null}
      {showFirstRun ? (
        <FirstRunWelcome
          onCreateSession={() => onCreateSession?.()}
          recommendedPersonas={personas}
        />
      ) : null}
      {showStandardWelcome ? <WelcomeBubble context={welcomeContext ?? null} /> : null}
    </div>
  );
}

/** v0.2-alpha-20 — default persona chips for the first-run welcome
 *  card (design 06). Matches the v0.1.5 picker defaults (通用助手
 *  hermes-agent + 代码审查 code-reviewer). main.ts can override via
 *  the `recommendedPersonas` prop once personasCache is wired in. */
const DEFAULT_RECOMMENDED_PERSONAS: { avatar: string; name: string; tag: string }[] = [
  { avatar: "🦊", name: "hermes-agent", tag: "通用助手" },
  { avatar: "🛡", name: "code-reviewer", tag: "代码审查" },
];

/**
 * Stable key per message. We use `timestamp.getTime()` cast to string
 * since ChatMessage doesn't carry an explicit id field (we add one
 * lazily in the store when finalising a stream).
 *
 * If a message has no timestamp yet (shouldn't happen — every path
 * sets one), fall back to its position so we still get a valid key.
 */
function messageKey(m: ChatMessage & { id?: string }): string {
  if (m.id) return m.id;
  return m.timestamp ? `t-${m.timestamp.getTime()}` : `i-${Math.random()}`;
}

/* ── Welcome context store ──────────────────────────────────────────────── */

interface WelcomeStore {
  context: WelcomeContext | null;
}

const welcomeListeners = new Set<(s: WelcomeStore) => void>();
let welcomeState: WelcomeStore = { context: null };

function notifyWelcome(): void {
  for (const l of welcomeListeners) l(welcomeState);
}

export const chatWelcomeStore = {
  get(): WelcomeStore {
    return welcomeState;
  },
  setContext(context: WelcomeContext | null): void {
    welcomeState = { context };
    notifyWelcome();
  },
  subscribe(listener: (s: WelcomeStore) => void): () => void {
    welcomeListeners.add(listener);
    listener(welcomeState);
    return () => {
      welcomeListeners.delete(listener);
    };
  },
};

/**
 * v0.2-alpha-20 — Props for the empty-state action buttons (CTA +
 * retry + settings). main.ts supplies these so the Preact view
 * stays decoupled from the SSE / settings / session mutators.
 */
export interface ChatViewActions {
  onCreateSession?: () => void;
  onRetryConnection?: () => void;
  onOpenSettings?: () => void;
  /** Default Gateway hint shown in the no-network card. */
  gatewayHint?: string;
  /** Persona chips for the first-run welcome card. */
  recommendedPersonas?: { avatar: string; name: string; tag: string }[];
}

/**
 * ChatViewWithWelcome — convenience wrapper that subscribes to
 * `chatWelcomeStore` and passes the latest context into <ChatView>.
 * main.ts renders this single component; the input form + sidebar +
 * header all stay outside the Preact tree for now (alpha-17 scope).
 */
export function ChatViewWithWelcome({ actions }: { actions?: ChatViewActions } = {}) {
  const [welcome, setWelcome] = useState<WelcomeStore>(chatWelcomeStore.get());
  useEffect(() => chatWelcomeStore.subscribe(setWelcome), []);
  return (
    <ChatView
      welcomeContext={welcome.context}
      onCreateSession={actions?.onCreateSession}
      onRetryConnection={actions?.onRetryConnection}
      onOpenSettings={actions?.onOpenSettings}
      gatewayHint={actions?.gatewayHint}
      recommendedPersonas={actions?.recommendedPersonas}
    />
  );
}