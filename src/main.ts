// Hermes Chat - Main Application
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

// Configure marked with code highlighting via marked-highlight extension
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch { /* fall through */ }
    }
    return hljs.highlightAuto(code).value;
  },
}));

marked.setOptions({
  breaks: true,
  gfm: true,
});

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { composeSystemPrompt } from './systemPrompt';
import { layoutChart, formatTokens, formatCost, DEFAULT_CHART_LAYOUT, type DailyBucketLike } from './tokenChart';

const UNKNOWN_MODEL = '-';

// ── Session / FTS5 types ──────────────────────────────────────────────────────

interface Session {
  id: string;
  title: string;
  persona_id: string | null;
  project_dir: string | null;
  project_context: string | null; // JSON-encoded ProjectContext (T-Q-S8)
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number; // T-Q-S9: aggregate token count
  model: string | null; // T-Q-S9: per-session model
}

/**
 * T-Q-S12-light: pick the `model` field to send in a chat completion
 * request. Priority chain (highest first):
 *   1. persona.model — pinned model on the active persona
 *   2. currentModel — set by /v1/models response or user override
 *   3. defaultModel — user-saved in settings (DB config key)
 *   4. legacyDefault — hardcoded legacy fallback
 *
 * `currentModel` is the sentinel `UNKNOWN_MODEL` ("-") when the
 * gateway hasn't reported any. Pure function for testability.
 */
export function pickModelForRequest(
  persona: { model: string | null } | null,
  currentModel: string,
  defaultModel: string | null,
  legacyDefault: string,
): string {
  if (persona?.model) return persona.model;
  if (currentModel && currentModel !== '-') return currentModel;
  if (defaultModel) return defaultModel;
  return legacyDefault;
}

// ── Project context type (T-Q-S8) ──────────────────────────────────────────────
//
// Mirrors `db::project::ProjectContext` on the Rust side. The Rust side
// returns this struct from the `project_scan` Tauri command; we JSON-
// encode it for `session_create.project_context` so the cache lives in
// the DB. `parseProjectContext` decodes the stored JSON when reading.

interface ProjectContext {
  project_dir: string;
  name: string;
  version: string | null;
  description: string | null;
  readme_excerpt: string | null;
  languages: string[];
  has_git: boolean;
  git_remote: string | null;
  files_scanned: string[];
  summary_markdown: string;
  scanned_at: number;
}

function parseProjectContext(json: string | null): ProjectContext | null {
  if (!json) return null;
  try { return JSON.parse(json) as ProjectContext; } catch { return null; }
}

// ── Token stats types (T-Q-S9) ─────────────────────────────────────────────────
//
// Mirrors `db::token::{TokenStats, DailyBucket, ModelBucket}`. Rust
// side computes aggregates via SQL; we just render.

interface DailyBucket {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

interface ModelBucket {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  message_count: number;
}

interface TokenStats {
  period: string;
  start_unix_ms: number;
  end_unix_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  total_messages: number;
  total_sessions: number;
  daily: DailyBucket[];
  by_model: ModelBucket[];
  // S14-agent integration. The Rust token_stats aggregator reads
  // messages.metadata via json_extract and surfaces these so the
  // stats modal can show "图片 token" cost + the most recent
  // routing_decision / elapsed_ms. `recent_routing_decision` is the
  // raw JSON blob the agent pushed (mode / primary / resolved /
  // fallback_*); the modal renders the bits it knows and ignores
  // unknown fields.
  total_image_tokens: number;
  recent_routing_decision: string | null;
  recent_elapsed_ms: number | null;
  // ── v0.1.5 S12 cost-aware routing aggregates ─────────────────────────
  // Real USD cost (sum of messages.cost_estimate_usd) for the period.
  // Replaces the char/4 cost projection in the "预估成本" tile as
  // messages with S12 cost data accumulate.
  period_cost_total_usd: number;
  // Fallback hit rate in [0.0, 1.0]. Of messages that carried a
  // routing_decision in the period, the fraction that fired a
  // fallback. 0.0 when no messages in the period carry a routing
  // decision (pre-S12 / pre-S14).
  fallback_hit_rate: number;
  // Average wall-clock latency (ms) across the period, from
  // messages.metadata.elapsed_ms. 0.0 when no messages in the
  // period carry elapsed_ms.
  avg_latency_ms: number;
  // Count of messages where S12 cost-aware fallback flagged a budget
  // breach (cost_threshold_exceeded = 1). Surfaces silent overruns.
  cost_threshold_count: number;
  // Per-rule breakdown. `rule_id` from routing_decision.rule_id;
  // sorted by hit_count DESC.
  by_rule: RuleBucket[];
}

interface RuleBucket {
  rule_id: string;
  hit_count: number;
  cost_total: number;
}

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

interface SearchHit {
  message_id: string;
  session_id: string;
  session_title: string;
  snippet: string;
  rank: number;
}

// ── Persona types (T-Q-S7) ──────────────────────────────────────────────────────
//
// A persona = reusable assistant role. Carries system_prompt that gets
// injected when a new session is created from it. Also serves as the
// "session template" library — no separate templates table needed.

interface Persona {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  avatar: string;
  // T-Q-S12-light: optional model name. When this persona is selected,
  // the chat sends requests with `model: <this>`. `null` means
  // "fall back to the global default model".
  model: string | null;
  created_at: string;
  updated_at: string;
  is_builtin: number; // 0 or 1 — SQLite boolean convention
}

// ── Session State ─────────────────────────────────────────────────────────────

let currentSessionId: string | null = null;
let currentSession: Session | null = null; // T-Q-S8: full row for system-prompt composition
let sidebarVisible = false;

// ── Persona state (T-Q-S7) ──────────────────────────────────────────────────────
// `currentPersonaId` mirrors the persona picker in the header and is what
// gets passed to `session_create` as `personaId`. Persisted to the DB
// config table as `default_persona_id` so it survives app restarts.
let currentPersonaId: string | null = null;
let personasCache: Persona[] = [];

interface HermesResponse {
  ok: boolean;
  status: number;
  body: string;
}

interface GatewayInfo {
  ip: string;
  port: string;
  url: string;
}

// Resolved at runtime via hermes_resolve_gateway_ip()
let RESOLVED_GATEWAY_URL = '';
let API_KEY = 'hermes-local-dev-key';

async function hermesGet(path: string): Promise<HermesResponse> {
  return await invoke('hermes_proxy_get', {
    url: `${RESOLVED_GATEWAY_URL}${path}`,
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
}

async function hermesPostStream(path: string, body: object): Promise<void> {
  return await invoke('hermes_proxy_post_stream', {
    url: `${RESOLVED_GATEWAY_URL}${path}`,
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body)
  });
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  /** Text-only content for rendering + DB persistence. For multimodal
   * user messages, this is the visible text portion; the images are
   * reconstructed from the `attachments` field (if any) at send time. */
  content: string;
  /** T-Q-S14: image attachments sent alongside this message. Persisted
   * to DB only as part of the `metadata` blob (we keep a thin index
   * of names + types in `Message.metadata` so reloads can show what
   * was attached without the bytes). */
  attachments?: PendingAttachment[];
  timestamp: Date;
}

/** T-Q-S14: a single image attachment waiting to be sent. */
interface PendingAttachment {
  /** data: URL (base64-encoded) ready for OpenAI `image_url.url`. */
  dataUrl: string;
  /** Original filename for display. */
  name: string;
  /** MIME type, e.g. `image/png`. */
  type: string;
  /** Byte size — displayed alongside the thumbnail. */
  size: number;
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  currentModel: string;
  isStreaming: boolean;
  streamContent: string;
  streamElement: HTMLElement | null;
  // S14-agent: per-stream metadata captured from the final SSE chunk.
  // The agent pushes real prompt/completion/image token counts plus a
  // routing_decision + elapsed_ms blob; finishStream() persists these
  // via message_record_usage. Reset on every new turn.
  lastStreamUsage: Record<string, unknown> | null;
  lastStreamRouting: unknown;
  lastStreamElapsedMs: number | null;
}

const CONFIG = {
  defaultModel: 'hermes-agent',
  maxTokens: 4096,
  temperature: 0.7,
  maxInputLength: 4000,
};

const state: ChatState = {
  messages: [],
  isLoading: false,
  connectionStatus: 'disconnected',
  currentModel: UNKNOWN_MODEL,
  isStreaming: false,
  streamContent: '',
  streamElement: null,
  lastStreamUsage: null,
  lastStreamRouting: null,
  lastStreamElapsedMs: null,
};

let messagesContainer: HTMLElement | null = null;
let messageInput: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let connectionStatusEl: HTMLElement | null = null;
let statusText: HTMLElement | null = null;
let modelName: HTMLElement | null = null;
let charCount: HTMLElement | null = null;
let chatForm: HTMLFormElement | null = null;

let unlistenChunk: (() => void) | null = null;
let unlistenDone: (() => void) | null = null;

// ── Session Management ────────────────────────────────────────────────────────

let sessionOffset = 0;
const SESSION_PAGE = 50;

// ── Session export + share (T-Q-S10) ───────────────────────────────────────────
//
// Frontend calls `export_session_markdown` / `export_session_json`
// (Rust commands in `db::export`) and then either:
//   - writes the markdown to clipboard via `navigator.clipboard.writeText`
//   - encodes the JSON as a base64url URL fragment for sharing
//
// The share link is `https://<host>/<path>#share=<base64url(JSON.stringify(...))>`.
// Self-contained (no server), no signature in MVP (acceptable for
// personal use; future T-Q-S10.x could add HMAC).

async function copySessionAsMarkdown(sessionId: string): Promise<void> {
  try {
    const md = await invoke<string>('export_session_markdown', { sessionId });
    await navigator.clipboard.writeText(md);
    showToast('已复制', `Markdown ${md.length} 字符到剪贴板`, 'success');
  } catch (e) {
    showToast('导出失败', String(e), 'error');
  }
}

/**
 * Build a self-contained share link. The session's full state
 * (title, messages, persona, project) is encoded in the URL fragment
 * so the receiving end can preview the import without any server.
 *
 * `window.location.href + '#share=' + base64url(JSON.stringify(doc))`
 */
async function copySessionShareLink(sessionId: string): Promise<void> {
  try {
    const json = await invoke<unknown>('export_session_json', { sessionId });
    const text = JSON.stringify(json);
    const encoded = base64UrlEncode(text);
    const url = `${window.location.origin}${window.location.pathname}#share=${encoded}`;
    await navigator.clipboard.writeText(url);
    showToast('分享链接已复制', `${url.length} 字符 — 接收方打开即可导入`, 'success');
  } catch (e) {
    showToast('生成链接失败', String(e), 'error');
  }
}

/** URL-safe base64 (no padding, `-_` instead of `+/`). */
function base64UrlEncode(s: string): string {
  // btoa is only available for ASCII; we UTF-8-encode first.
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * T-Q-S10: import flow. On app launch, if the URL has a #share=
 * fragment, decode the base64url-encoded JSON and offer to import
 * the session into the local DB. We do not auto-import — the user
 * confirms via a toast action.
 *
 * For MVP we only show a preview toast ("Found a shared session
 * from <title>. Click to import.") and a confirmation flow.
 */
async function maybeImportFromHash(): Promise<void> {
  const hash = window.location.hash;
  const m = hash.match(/^#share=(.+)$/);
  if (!m) return;
  const encoded = m[1];
  try {
    const json = base64UrlDecode(encoded);
    const doc = JSON.parse(json) as {
      version: number;
      session: { id: string; title: string };
      messages: Array<{ role: string; content: string }>;
    };
    if (doc.version !== 1) {
      showToast('分享链接版本不支持', `version=${doc.version}`, 'error');
      return;
    }
    const msgCount = doc.messages?.length ?? 0;
    if (confirm(`导入分享的会话？\n\n标题: ${doc.session.title}\n消息数: ${msgCount}\n\n点击确定导入到本地，取消则忽略。`)) {
      // Re-import: for MVP, we just create a new local session and
      // append the messages. The persona/project from the share
      // document are dropped (different local IDs would be needed).
      const newSession = await invoke<Session>('session_create', {
        title: `[分享] ${doc.session.title}`,
        personaId: null,
        projectDir: null,
        projectContext: null,
      });
      for (const m2 of doc.messages) {
        await invoke('message_append', {
          sessionId: newSession.id,
          role: m2.role,
          content: m2.content,
          toolCalls: null,
        });
      }
      // Clear the hash to prevent re-import on next reload.
      history.replaceState(null, '', window.location.pathname);
      showToast('已导入', `${msgCount} 条消息 → ${newSession.id}`, 'success');
      await loadSessionList(true);
      await selectSession(newSession.id);
    } else {
      // User declined — clear hash so the dialog doesn't reappear.
      history.replaceState(null, '', window.location.pathname);
    }
  } catch (e) {
    showToast('分享链接解析失败', String(e), 'error');
    history.replaceState(null, '', window.location.pathname);
  }
}

/**
 * T-Q-S9: refresh just the sidebar row for the current session.
 * Used after each message send so the token badge stays live.
 * Falls back to a full list reload if the row can't be located.
 */
async function refreshCurrentSessionRow(): Promise<void> {
  if (!currentSessionId) return;
  try {
    const fresh = await invoke<Session>('session_get', { id: currentSessionId });
    currentSession = fresh;
    const row = document.querySelector<HTMLElement>(`.session-item[data-session-id="${currentSessionId}"]`);
    if (row) {
      // Re-render the title text + token badge in place. We rebuild
      // title (with persona avatar) and the badges from scratch.
      const persona = fresh.persona_id ? personasCache.find(p => p.id === fresh.persona_id) : null;
      const avatar = persona?.avatar ?? '';
      const titleText = `${avatar ? avatar + ' ' : ''}${fresh.title || '无标题会话'}`;
      const titleEl = row.querySelector<HTMLElement>('.session-title');
      if (titleEl) titleEl.textContent = titleText;
      // Update or insert token badge.
      let tokEl = row.querySelector<HTMLElement>('.session-tokens');
      if (fresh.total_tokens && fresh.total_tokens > 0) {
        if (!tokEl) {
          tokEl = document.createElement('span');
          tokEl.className = 'session-tokens';
          const deleteBtn = row.querySelector('.session-delete');
          if (deleteBtn) row.insertBefore(tokEl, deleteBtn);
          else row.appendChild(tokEl);
        }
        tokEl.title = `总 token: ${fresh.total_tokens}`;
        tokEl.textContent = `${formatTokens(fresh.total_tokens)} tok`;
      } else if (tokEl) {
        tokEl.remove();
      }
      // Update or insert project badge.
      const proj = parseProjectContext(fresh.project_context);
      let projEl = row.querySelector<HTMLElement>('.session-project');
      if (proj) {
        if (!projEl) {
          projEl = document.createElement('span');
          projEl.className = 'session-project';
          const tokEl2 = row.querySelector('.session-tokens');
          if (tokEl2) row.insertBefore(projEl, tokEl2);
          else {
            const deleteBtn = row.querySelector('.session-delete');
            if (deleteBtn) row.insertBefore(projEl, deleteBtn);
            else row.appendChild(projEl);
          }
        }
        projEl.title = proj.project_dir;
        projEl.textContent = `📁 ${proj.name}`;
      } else if (projEl) {
        projEl.remove();
      }
    }
  } catch (e) {
    console.warn('[Session] refresh failed, falling back to full list:', e);
    await loadSessionList();
  }
}

async function loadSessionList(resetOffset = true): Promise<void> {
  const listEl = document.getElementById('session-list');
  if (!listEl) return;
  if (resetOffset) sessionOffset = 0;
  try {
    const sessions = await invoke<Session[]>('session_list', { limit: SESSION_PAGE, offset: sessionOffset });
    if (resetOffset) listEl.innerHTML = '';
    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = `session-item${s.id === currentSessionId ? ' active' : ''}`;
      el.dataset.sessionId = s.id;
      // T-Q-S7 + T-Q-S8: prefix with persona avatar (if any) and project
      // badge (if any) so the role + project is visible at a glance.
      const persona = s.persona_id ? personasCache.find(p => p.id === s.persona_id) : null;
      const avatar = persona?.avatar ?? '';
      const proj = parseProjectContext(s.project_context);
      const titleEl = document.createElement('span');
      titleEl.className = 'session-title';
      titleEl.innerHTML = `${avatar ? `<span class="session-persona-emoji">${avatar}</span> ` : ''}${escapeHtml(s.title || '无标题会话')}`;
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startRename(s.id, titleEl);
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'session-delete';
      deleteBtn.dataset.id = s.id;
      deleteBtn.textContent = '×';
      deleteBtn.title = '删除会话';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession((e.target as HTMLElement).dataset.id!);
      });
      el.appendChild(titleEl);
      if (proj) {
        const projEl = document.createElement('span');
        projEl.className = 'session-project';
        projEl.title = proj.project_dir;
        projEl.textContent = `📁 ${proj.name}`;
        el.appendChild(projEl);
      }
      // T-Q-S9: compact token badge (only show if > 0)
      if (s.total_tokens && s.total_tokens > 0) {
        const tokEl = document.createElement('span');
        tokEl.className = 'session-tokens';
        tokEl.title = `总 token: ${s.total_tokens}`;
        tokEl.textContent = `${formatTokens(s.total_tokens)} tok`;
        el.appendChild(tokEl);
      }
      // T-Q-S10: export button (copy as markdown to clipboard)
      const exportBtn = document.createElement('button');
      exportBtn.className = 'session-action-btn';
      exportBtn.title = '复制为 Markdown';
      exportBtn.textContent = '📤';
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void copySessionAsMarkdown(s.id);
      });
      el.appendChild(exportBtn);
      el.appendChild(deleteBtn);
      el.addEventListener('click', () => selectSession(s.id));
      listEl.appendChild(el);
    }
    // Append load-more button if we got a full page
    const existingMore = listEl.querySelector('.session-load-more');
    if (existingMore) existingMore.remove();
    if (sessions.length === SESSION_PAGE) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'session-load-more';
      moreBtn.textContent = '加载更多...';
      moreBtn.addEventListener('click', async () => {
        sessionOffset += SESSION_PAGE;
        moreBtn.textContent = '加载中...';
        moreBtn.disabled = true;
        await loadSessionList(false);
      });
      listEl.appendChild(moreBtn);
    }
    if (resetOffset && listEl.children.length === 0) {
      listEl.innerHTML = '<div class="session-empty">暂无会话记录</div>';
    }
  } catch (e) {
    console.error('[Session] load error:', e);
  }
}

async function startRename(id: string, titleEl: HTMLElement): Promise<void> {
  const current = titleEl.textContent || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = current;
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await finishRename(id, input, current);
    } else if (e.key === 'Escape') {
      titleEl.textContent = current;
      input.replaceWith(titleEl);
    }
  });
  input.addEventListener('blur', async () => {
    await finishRename(id, input, current);
  });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

async function finishRename(id: string, input: HTMLInputElement, _current: string): Promise<void> {
  const newTitle = input.value.trim();
  const titleSpan = document.createElement('span');
  titleSpan.className = 'session-title';
  titleSpan.textContent = newTitle || '无标题会话';
  titleSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(id, titleSpan);
  });
  input.replaceWith(titleSpan);
  if (!newTitle) return;
  try {
    await invoke<Session>('session_update', { id, patch: { title: newTitle } });
  } catch (e) {
    showToast('重命名失败', String(e), 'error');
  }
}

// Exposed for potential external use


async function selectSession(id: string): Promise<void> {
  currentSessionId = id;
  // T-Q-S8: track the full session row so we can compose system prompts
  // at send-message time without an extra DB round-trip.
  try {
    currentSession = await invoke<Session>('session_get', { id });
  } catch (e) {
    console.warn('[Session] failed to load row for system-prompt compose:', e);
    currentSession = null;
  }
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;
  try {
    const msgs = await invoke<DbMessage[]>('message_list', { sessionId: id, limit: 100, offset: 0 });
    state.messages = msgs.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at)
    }));
    messagesEl.innerHTML = '';
    for (const m of state.messages) {
      renderMessage(m);
    }
    if (state.messages.length === 0) {
      messagesEl.innerHTML = '<div class="welcome-message"><p>👋 此会话暂无消息</p><p class="hint">在下方输入消息开始对话</p></div>';
    }
    await invoke('session_touch', { id });
  } catch (e) {
    console.error('[Session] select error:', e);
    messagesEl.innerHTML = '<div class="welcome-message"><p>❌ 加载会话失败</p></div>';
  }
  // Highlight active session in list
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.sessionId === id);
  });
}

async function createSession(): Promise<string | null> {
  try {
    // T-Q-S8: if a default project path is configured, scan it and attach
    // the result to the new session. The scan is best-effort — if it
    // fails (path deleted, permission denied), we still create the
    // session with project_dir = path but project_context = null.
    let projectDir: string | null = null;
    let projectContextJson: string | null = null;
    if (defaultProjectPath) {
      const ctx = await scanProject(defaultProjectPath);
      if (ctx) {
        projectDir = ctx.project_dir;
        projectContextJson = JSON.stringify(ctx);
      } else {
        // Scan failed but user has a default set — still record the path
        // so the user can see/fix it in the session row.
        projectDir = defaultProjectPath;
      }
    }

    // T-Q-S7 + T-Q-S8: pass currentPersonaId + project context. The
    // session stores both fields; system-prompt injection happens at
    // send-message time (gateway/agent layer) so persona switches
    // mid-session work.
    const session = await invoke<Session>('session_create', {
      title: '新会话',
      personaId: currentPersonaId,
      projectDir,
      projectContext: projectContextJson,
    });
    currentSessionId = session.id;
    currentSession = session;
    state.messages = [];
    const messagesEl = document.getElementById('messages');
    if (messagesEl) {
      const persona = personasCache.find(p => p.id === currentPersonaId);
      const proj = parseProjectContext(session.project_context);
      const personaHint = persona
        ? `<p class="hint">Persona: ${persona.avatar ?? ''} ${escapeHtml(persona.name)}</p>`
        : '';
      const projectHint = proj
        ? `<p class="hint">项目: ${escapeHtml(proj.name)}${proj.version ? ` v${escapeHtml(proj.version)}` : ''} (${escapeHtml(proj.project_dir)})</p>`
        : (projectDir ? `<p class="hint">项目路径已设置但扫描失败: ${escapeHtml(projectDir)}</p>` : '');
      const hint = personaHint + projectHint || '<p class="hint">在下方输入消息开始对话</p>';
      messagesEl.innerHTML = `<div class="welcome-message"><p>👋 新会话已开始</p>${hint}</div>`;
    }
    await loadSessionList(true);
    return session.id;
  } catch (e) {
    showToast('创建会话失败', String(e), 'error');
    return null;
  }
}

async function deleteSession(id: string): Promise<void> {
  if (!confirm('确定删除此会话？')) return;
  try {
    await invoke('session_delete', { id });
    if (currentSessionId === id) {
      currentSessionId = null;
      currentSession = null;
      state.messages = [];
      const messagesEl = document.getElementById('messages');
      if (messagesEl) {
        messagesEl.innerHTML = '<div class="welcome-message"><p>👋 欢迎使用 Hermes Chat</p><p class="hint">在下方输入消息开始对话</p></div>';
      }
    }
    await loadSessionList();
    showToast('会话已删除', '', 'success');
  } catch (e) {
    showToast('删除失败', String(e), 'error');
  }
}

function toggleSidebar(show?: boolean): void {
  sidebarVisible = show !== undefined ? show : !sidebarVisible;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('hidden', !sidebarVisible);
  const showBtn = document.getElementById('sidebar-show-btn');
  if (showBtn) showBtn.style.display = sidebarVisible ? 'none' : '';
}

// T-Q-S6: load the most recent non-empty session. Called by tray
// "续上次" menu item. Shows a toast if there are no sessions.
async function loadLastSession(): Promise<void> {
  try {
    // session_list is sorted by updated_at DESC (most recent first)
    const sessions = await invoke<Session[]>('session_list', { limit: 1, offset: 0 });
    if (sessions.length === 0) {
      showToast('没有历史会话', '请先创建新会话', 'info');
      return;
    }
    const last = sessions[0];
    await selectSession(last.id);
    showToast('已加载上次会话', last.title || '无标题会话', 'success');
  } catch (e) {
    showToast('加载失败', String(e), 'error');
  }
}

// ── Persona CRUD + state (T-Q-S7) ──────────────────────────────────────────────

async function loadPersonas(): Promise<Persona[]> {
  try {
    personasCache = await invoke<Persona[]>('persona_list');
  } catch (e) {
    console.error('[Persona] list failed:', e);
    personasCache = [];
  }
  return personasCache;
}

async function loadDefaultPersonaId(): Promise<string | null> {
  try {
    const entry = await invoke<{ key: string; value: string } | null>('db_config_get', { key: 'default_persona_id' });
    return entry?.value ?? null;
  } catch (e) {
    console.warn('[Persona] default_persona_id not loaded:', e);
    return null;
  }
}

async function setDefaultPersonaId(id: string | null): Promise<void> {
  try {
    if (id === null) {
      // We don't have a "delete key" command; setting to empty string is the
      // closest analog. The picker treats empty/missing the same as "no default".
      await invoke('db_config_set', { key: 'default_persona_id', value: '' });
    } else {
      await invoke('db_config_set', { key: 'default_persona_id', value: id });
    }
  } catch (e) {
    console.warn('[Persona] default_persona_id not saved:', e);
  }
}

// T-Q-S12-light: default model fallback. Used when no persona.model
// is set. Persists across restarts; per-session overrides take
// precedence (state.currentModel).
async function loadDefaultModel(): Promise<string | null> {
  try {
    const entry = await invoke<{ key: string; value: string } | null>('db_config_get', { key: 'default_model' });
    const v = entry?.value?.trim() ?? '';
    return v.length > 0 ? v : null;
  } catch (e) {
    console.warn('[Model] default_model not loaded:', e);
    return null;
  }
}

async function setDefaultModel(name: string | null): Promise<void> {
  try {
    await invoke('db_config_set', { key: 'default_model', value: name ?? '' });
  } catch (e) {
    console.warn('[Model] default_model not saved:', e);
  }
}

let defaultModel: string | null = null;

// T-Q-S14: image attachments waiting to be sent. Cleared on each send.
let pendingAttachments: PendingAttachment[] = [];

// T-Q-S13: voice recording state. We keep the MediaRecorder here
// (outside the function) so a stop click can reach it.
let mediaRecorder: MediaRecorder | null = null;
let recordingStream: MediaStream | null = null;
let recordingChunks: Blob[] = [];

function renderPersonaPicker(): void {
  const select = document.getElementById('persona-picker') as HTMLSelectElement | null;
  if (!select) return;
  // Build options: first entry is "无 (default)", then each persona.
  // Use avatar emoji + name for the dropdown label.
  const opts: string[] = ['<option value="">— 无 (默认) —</option>'];
  for (const p of personasCache) {
    const label = p.avatar ? `${p.avatar} ${escapeHtml(p.name)}` : escapeHtml(p.name);
    opts.push(`<option value="${escapeHtml(p.id)}">${label}</option>`);
  }
  select.innerHTML = opts.join('');
  // Apply current selection; if currentPersonaId was deleted, fall back to empty.
  const valid = personasCache.some(p => p.id === currentPersonaId);
  select.value = valid && currentPersonaId ? currentPersonaId : '';
  currentPersonaId = valid ? currentPersonaId : null;
}

async function onPersonaPickerChange(): Promise<void> {
  const select = document.getElementById('persona-picker') as HTMLSelectElement | null;
  if (!select) return;
  const newId = select.value || null;
  currentPersonaId = newId;
  await setDefaultPersonaId(newId);
  const persona = personasCache.find(p => p.id === newId);
  showToast('已切换 Persona', persona ? `${persona.avatar ?? ''} ${persona.name}` : '默认 (无)', 'success');
}

async function createPersonaApi(name: string, description: string, system_prompt: string, avatar: string, model: string | null): Promise<Persona | null> {
  const id = `persona:${crypto.randomUUID()}`;
  const now = Date.now().toString();
  const persona: Persona = {
    id, name, description, system_prompt, avatar, model,
    created_at: now, updated_at: now, is_builtin: 0,
  };
  try {
    return await invoke<Persona>('persona_create', { persona });
  } catch (e) {
    showToast('创建 Persona 失败', String(e), 'error');
    return null;
  }
}

async function updatePersonaApi(persona: Persona): Promise<Persona | null> {
  persona.updated_at = Date.now().toString();
  try {
    return await invoke<Persona>('persona_update', { persona });
  } catch (e) {
    showToast('更新 Persona 失败', String(e), 'error');
    return null;
  }
}

async function deletePersonaApi(id: string): Promise<boolean> {
  if (id.startsWith('builtin:')) {
    showToast('无法删除', '内置 Persona 不可删除', 'error');
    return false;
  }
  if (!confirm('确定删除此 Persona？关联会话将保留但不再引用此角色。')) return false;
  try {
    await invoke('persona_delete', { id });
    if (currentPersonaId === id) {
      currentPersonaId = null;
      await setDefaultPersonaId(null);
    }
    return true;
  } catch (e) {
    showToast('删除失败', String(e), 'error');
    return false;
  }
}

/**
 * Compose the system prompt for the current session (T-Q-S7 + T-Q-S8).
 *
 * Combines the session's persona (looked up from `personasCache`) with
 * the session's cached project context (parsed from `project_context`).
 * Returns null when neither is present — the caller should NOT inject
 * a system message in that case.
 */
async function buildCurrentSystemPrompt(): Promise<string | null> {
  const persona = currentSession?.persona_id
    ? personasCache.find(p => p.id === currentSession!.persona_id) ?? null
    : null;
  const project = parseProjectContext(currentSession?.project_context ?? null);
  return composeSystemPrompt(persona, project);
}

// ── Project context (T-Q-S8) ───────────────────────────────────────────────────
//
// default_project_path is a setting: when the user clicks "new session",
// we scan this path and attach the resulting ProjectContext to the new
// session. Stored in the `config` table (not config.json) so it
// survives app restarts and is queryable from Rust.

async function loadDefaultProjectPath(): Promise<string | null> {
  try {
    const entry = await invoke<{ key: string; value: string } | null>('db_config_get', { key: 'default_project_path' });
    const v = entry?.value?.trim() ?? '';
    return v.length > 0 ? v : null;
  } catch (e) {
    console.warn('[Project] default_project_path not loaded:', e);
    return null;
  }
}

async function setDefaultProjectPath(path: string | null): Promise<void> {
  try {
    await invoke('db_config_set', { key: 'default_project_path', value: path ?? '' });
  } catch (e) {
    console.warn('[Project] default_project_path not saved:', e);
  }
}

/** Scan a path on the Rust side. Returns null on failure (and shows a toast). */
async function scanProject(path: string): Promise<ProjectContext | null> {
  try {
    return await invoke<ProjectContext>('project_scan', { path });
  } catch (e) {
    showToast('项目扫描失败', `${path}: ${e}`, 'error');
    return null;
  }
}

let defaultProjectPath: string | null = null;

// ── Token stats (T-Q-S9) ──────────────────────────────────────────────────────

type StatsPeriod = 'day' | 'week' | 'month' | 'all';
let currentStats: TokenStats | null = null;
let currentStatsPeriod: StatsPeriod = 'week';

async function loadTokenStats(period: StatsPeriod): Promise<TokenStats | null> {
  try {
    currentStats = await invoke<TokenStats>('token_stats', { period });
    currentStatsPeriod = period;
    return currentStats;
  } catch (e) {
    showToast('加载统计失败', String(e), 'error');
    return null;
  }
}

function openStatsModal(): void {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  void loadTokenStats(currentStatsPeriod).then(() => renderStatsModal());
}

function closeStatsModal(): void {
  const modal = document.getElementById('stats-modal');
  if (modal) modal.classList.add('hidden');
}

function renderStatsModal(): void {
  const body = document.getElementById('stats-modal-body');
  if (!body) return;
  if (!currentStats) {
    body.innerHTML = '<div class="stats-empty">暂无数据</div>';
    return;
  }
  const s = currentStats;
  // S14-agent: derive a one-line "最近 vision" trace + latency badge so
  // the user can see what their last vision call did and how long it
  // took. Empty string -> the JSX conditional hides the block.
  const routingTrace = formatRoutingTrace(s.recent_routing_decision ?? null);
  const latencyBadge = formatLatencyMs(s.recent_elapsed_ms);
  // v0.1.5 S12: 4 new aggregate tiles + 2 breakdown tables (by model,
  // by rule). The "本月 Cost" tile uses the S12 real value when it's
  // > 0; otherwise falls back to the char/4 projected `total_cost` so
  // pre-S12 DBs still render something useful. The label flips between
  // "本月 Cost (S12)" and "预估成本" depending on which path is active.
  const costTotalUsd = s.period_cost_total_usd ?? 0;
  const hasRealCost = costTotalUsd > 0;
  const costValue = hasRealCost ? costTotalUsd : s.total_cost;
  const costLabel = hasRealCost ? '本月 Cost (S12)' : '预估成本';
  const costSub = hasRealCost
    ? `S12 真实值 · ${s.by_model.length} 个模型`
    : `基于 ${s.by_model.length} 个模型`;
  // Fallback hit rate as integer percent (0-100). null/undefined guard.
  const fallbackPct = Math.round((s.fallback_hit_rate ?? 0) * 100);
  // Avg latency in seconds, 1 decimal. ms → s, 0 if no data.
  const avgLatencySec = (s.avg_latency_ms ?? 0) > 0
    ? ((s.avg_latency_ms ?? 0) / 1000).toFixed(1)
    : '0.0';
  // Cost threshold count — show "0 次" when nothing tripped, since
  // "—" would be visually confusing next to the integer tile siblings.
  const thresholdCount = s.cost_threshold_count ?? 0;
  body.innerHTML = `
    <div class="stats-period-tabs">
      ${(['day', 'week', 'month', 'all'] as const).map(p =>
        `<button class="stats-period-btn ${p === currentStatsPeriod ? 'active' : ''}" data-period="${p}">${
          p === 'day' ? '今日' : p === 'week' ? '本周' : p === 'month' ? '本月' : '全部'
        }</button>`
      ).join('')}
    </div>
    <div class="stats-totals">
      <div class="stats-totals-cell">
        <div class="stats-totals-label">总 Token</div>
        <div class="stats-totals-value">${formatTokens(s.total_input_tokens + s.total_output_tokens)}</div>
        <div class="stats-totals-sub">↑ ${formatTokens(s.total_input_tokens)} / ↓ ${formatTokens(s.total_output_tokens)}</div>
      </div>
      <div class="stats-totals-cell">
        <div class="stats-totals-label">${escapeHtml(costLabel)}</div>
        <div class="stats-totals-value">${formatCost(costValue)}</div>
        <div class="stats-totals-sub">${escapeHtml(costSub)}</div>
      </div>
      <div class="stats-totals-cell">
        <div class="stats-totals-label">消息 / 会话</div>
        <div class="stats-totals-value">${s.total_messages}</div>
        <div class="stats-totals-sub">${s.total_sessions} 个会话</div>
      </div>
    </div>
    <div class="stats-totals">
      <div class="stats-totals-cell">
        <div class="stats-totals-label">图片 Token (S14)</div>
        <div class="stats-totals-value">${formatTokens(s.total_image_tokens ?? 0)}</div>
        <div class="stats-totals-sub">来自 vision 附件的输入 token</div>
      </div>
      <div class="stats-totals-cell stats-totals-cell-vision">
        <div class="stats-totals-label">最近 Vision</div>
        <div class="stats-totals-value stats-totals-trace">${escapeHtml(routingTrace || '—')}</div>
        <div class="stats-totals-sub">${escapeHtml(latencyBadge || '')}</div>
      </div>
    </div>
    <div class="stats-totals">
      <div class="stats-totals-cell">
        <div class="stats-totals-label">Fallback 命中率 (S12)</div>
        <div class="stats-totals-value">${fallbackPct}%</div>
        <div class="stats-totals-sub">已 fallback / 已路由</div>
      </div>
      <div class="stats-totals-cell">
        <div class="stats-totals-label">平均 Latency (S12)</div>
        <div class="stats-totals-value">${avgLatencySec}s</div>
        <div class="stats-totals-sub">来自 elapsed_ms 平均</div>
      </div>
      <div class="stats-totals-cell">
        <div class="stats-totals-label">Cost Threshold 触发</div>
        <div class="stats-totals-value">${thresholdCount}</div>
        <div class="stats-totals-sub">${thresholdCount > 0 ? '预算超支次数' : '本周期内无超支'}</div>
      </div>
    </div>
    <div class="stats-chart-section">
      <h3>每日 Token 用量</h3>
      ${renderChartSvg(s.daily)}
    </div>
    <div class="stats-models-section">
      <h3>按模型分列</h3>
      <table class="stats-models-table">
        <thead><tr><th>模型</th><th>消息</th><th>Input</th><th>Output</th><th>成本</th></tr></thead>
        <tbody>
          ${s.by_model.length === 0
            ? '<tr><td colspan="5" class="stats-empty">暂无数据</td></tr>'
            : s.by_model.map(m => `<tr>
                <td>${escapeHtml(m.model)}</td>
                <td>${m.message_count}</td>
                <td>${formatTokens(m.input_tokens)}</td>
                <td>${formatTokens(m.output_tokens)}</td>
                <td>${formatCost(m.cost)}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="stats-models-section">
      <h3>By Rule (S12)</h3>
      <table class="stats-models-table">
        <thead><tr><th>规则</th><th>命中数</th><th>成本 (USD)</th></tr></thead>
        <tbody>
          ${(s.by_rule ?? []).length === 0
            ? '<tr><td colspan="3" class="stats-empty">暂无 routing_decision 数据</td></tr>'
            : (s.by_rule ?? []).map(r => `<tr>
                <td>${escapeHtml(r.rule_id)}</td>
                <td>${r.hit_count}</td>
                <td>${formatCost(r.cost_total)}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  // Period tab click handlers.
  body.querySelectorAll<HTMLButtonElement>('.stats-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.period as StatsPeriod;
      void loadTokenStats(p).then(() => renderStatsModal());
    });
  });
}

function renderChartSvg(daily: DailyBucket[]): string {
  if (daily.length === 0) {
    return '<div class="stats-empty">本周期内无消息</div>';
  }
  const { layout, points } = layoutChart(daily as DailyBucketLike[], DEFAULT_CHART_LAYOUT);
  // Y-axis tick lines: 0, 1/4, 1/2, 3/4, max.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yVal = layout.yMax * f;
    const yPx = layout.padding.top + (layout.height - layout.padding.top - layout.padding.bottom) * (1 - f);
    return `<line x1="${layout.padding.left}" y1="${yPx.toFixed(1)}" x2="${layout.width - layout.padding.right}" y2="${yPx.toFixed(1)}" stroke="var(--border)" stroke-dasharray="2 3" />
            <text x="${layout.padding.left - 6}" y="${(yPx + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${formatTokens(yVal)}</text>`;
  }).join('');
  // Bars: input (bottom) + output (stacked on top).
  const bars = points.map((p, idx) => {
    const inY = layout.height - layout.padding.bottom - p.inputH;
    const outY = inY - p.outputH;
    const innerW = layout.width - layout.padding.left - layout.padding.right;
    const barW = Math.max(2, Math.min(40, (innerW / points.length) * 0.7));
    const x = p.x;
    const src = daily[idx];
    return `<g>
      <rect x="${x.toFixed(1)}" y="${inY.toFixed(1)}" width="${barW.toFixed(1)}" height="${p.inputH.toFixed(1)}" fill="var(--primary)" opacity="0.85">
        <title>${p.date}: ${formatTokens(p.total)} (input ${formatTokens(src.input_tokens)} / output ${formatTokens(src.output_tokens)})</title>
      </rect>
      <rect x="${x.toFixed(1)}" y="${outY.toFixed(1)}" width="${barW.toFixed(1)}" height="${p.outputH.toFixed(1)}" fill="var(--primary)" opacity="0.45">
      </rect>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(layout.height - layout.padding.bottom + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${p.date.slice(5)}</text>
    </g>`;
  }).join('');
  // Legend.
  const legend = `<g transform="translate(${layout.padding.left}, 4)">
    <rect width="10" height="10" fill="var(--primary)" opacity="0.85" />
    <text x="14" y="9" font-size="11" fill="var(--text-secondary)">Input</text>
    <rect x="60" width="10" height="10" fill="var(--primary)" opacity="0.45" />
    <text x="74" y="9" font-size="11" fill="var(--text-secondary)">Output</text>
  </g>`;
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" class="stats-chart" preserveAspectRatio="xMidYMid meet">${ticks}${bars}${legend}</svg>`;
}

// ── Backup (T-Q-S11) ─────────────────────────────────────────────────────────────

type BackupTab = 'create' | 'restore';

function openBackupModal(tab: BackupTab = 'create'): void {
  const modal = document.getElementById('backup-modal');
  if (!modal) return;
  // Switch to the requested tab.
  document.querySelectorAll<HTMLElement>('.backup-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('backup-tab-create')?.classList.toggle('hidden', tab !== 'create');
  document.getElementById('backup-tab-restore')?.classList.toggle('hidden', tab !== 'restore');
  modal.classList.remove('hidden');
}

function closeBackupModal(): void {
  document.getElementById('backup-modal')?.classList.add('hidden');
}

async function handleBackupCreate(): Promise<void> {
  const pathInput = document.getElementById('backup-create-path') as HTMLInputElement | null;
  const pwInput = document.getElementById('backup-create-password') as HTMLInputElement | null;
  const pwConfirmInput = document.getElementById('backup-create-password-confirm') as HTMLInputElement | null;
  const path = pathInput?.value.trim() ?? '';
  const password = pwInput?.value ?? '';
  const passwordConfirm = pwConfirmInput?.value ?? '';
  if (!path) { showToast('请填写输出路径', '', 'error'); return; }
  if (password.length < 8) { showToast('密码太短', '建议至少 8 位', 'error'); return; }
  if (password !== passwordConfirm) { showToast('两次密码不一致', '', 'error'); return; }
  try {
    const info = await invoke<{ output_path: string; plaintext_bytes: number; encrypted_bytes: number }>('backup_create', {
      outputPath: path,
      password,
    });
    showToast(
      '备份已创建',
      `${info.output_path}\n明文 ${formatBytes(info.plaintext_bytes)} → 加密 ${formatBytes(info.encrypted_bytes)}`,
      'success',
    );
    // Clear password fields for safety.
    if (pwInput) pwInput.value = '';
    if (pwConfirmInput) pwConfirmInput.value = '';
    closeBackupModal();
  } catch (e) {
    showToast('备份失败', String(e), 'error');
  }
}

async function handleBackupVerify(): Promise<void> {
  const pathInput = document.getElementById('backup-restore-path') as HTMLInputElement | null;
  const pwInput = document.getElementById('backup-restore-password') as HTMLInputElement | null;
  const path = pathInput?.value.trim() ?? '';
  const password = pwInput?.value ?? '';
  if (!path || !password) { showToast('请填写路径和密码', '', 'error'); return; }
  try {
    const ok = await invoke<boolean>('backup_verify', { inputPath: path, password });
    if (ok) {
      showToast('密码正确', '可以安全恢复', 'success');
    } else {
      showToast('密码错误', '请检查后重试', 'error');
    }
  } catch (e) {
    showToast('验证失败', String(e), 'error');
  }
}

async function handleBackupRestore(): Promise<void> {
  const pathInput = document.getElementById('backup-restore-path') as HTMLInputElement | null;
  const pwInput = document.getElementById('backup-restore-password') as HTMLInputElement | null;
  const path = pathInput?.value.trim() ?? '';
  const password = pwInput?.value ?? '';
  if (!path || !password) { showToast('请填写路径和密码', '', 'error'); return; }
  if (!confirm('⚠️ 恢复操作会覆盖当前所有数据, 且需要重启应用才能生效. 确定继续吗?')) return;
  try {
    const info = await invoke<{ input_path: string; plaintext_bytes: number; requires_restart: boolean }>(
      'backup_restore',
      { inputPath: path, password },
    );
    if (info.requires_restart) {
      showToast('恢复成功', '请重启应用以加载新数据', 'success');
    } else {
      showToast('恢复成功', `${info.plaintext_bytes} 字节已加载`, 'success');
    }
    closeBackupModal();
  } catch (e) {
    showToast('恢复失败', String(e), 'error');
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Image attachments (T-Q-S14) ──────────────────────────────────────────────────

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per image
const ATTACHMENT_MAX_COUNT = 4; // per single message

/**
 * S14 v0.1.4: when the user is approaching the per-message image cap,
 * show a warning toast so they can switch strategies (vision_analyze
 * pre-processing, splitting into multiple messages) before hitting
 * the hard limit. The threshold is `max - 2` so the user has one
 * chance to add the final 2 images after seeing the hint.
 *
 * Returns a structured decision so the UI handler doesn't have to
 * recompute the threshold or remember the magic -2 offset.
 */
export type AttachmentLimitDecision =
  | { level: 'ok' }
  | { level: 'warn'; message: string }
  | { level: 'block'; message: string };

export function evaluateAttachmentLimit(
  currentCount: number,
  addingCount: number,
  max: number = ATTACHMENT_MAX_COUNT,
): AttachmentLimitDecision {
  const next = currentCount + addingCount;
  if (next > max) {
    return {
      level: 'block',
      message: `每次消息最多 ${max} 张图片，当前 ${currentCount} 张 + 新增 ${addingCount} 张 = ${next} 张超限`,
    };
  }
  if (next >= max - 2 && currentCount < max - 2) {
    // Only warn on the transition into the warning zone, not on every
    // subsequent add — otherwise a user dragging 4 files one-by-one
    // would see 3 stacked toasts.
    return {
      level: 'warn',
      message: `即将达到每次 ${max} 张图片上限; 多余的图建议用 vision_analyze 工具预生成描述后用文字提交`,
    };
  }
  return { level: 'ok' };
}

/** Convert a File to a data URL + extract metadata. */
function fileToAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`不是图片: ${file.name} (${file.type || 'unknown'})`));
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      reject(new Error(
        `图片太大: ${file.name} (${formatBytes(file.size)} > ${formatBytes(ATTACHMENT_MAX_BYTES)})`,
      ));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('FileReader 返回非字符串结果'));
        return;
      }
      resolve({
        dataUrl,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addAttachments(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  // S14 v0.1.4: structured decision covers the three outcomes
  // (under limit / approaching limit / over limit) with helpful copy.
  // The hard block stays an error toast; the soft warn is an info toast
  // so the user sees the hint but isn't blocked from sending.
  const decision = evaluateAttachmentLimit(pendingAttachments.length, list.length);
  if (decision.level === 'block') {
    showToast('太多附件', decision.message, 'error');
    return;
  }
  const results: PendingAttachment[] = [];
  for (const f of list) {
    try {
      results.push(await fileToAttachment(f));
    } catch (e) {
      showToast('附件失败', String(e), 'error');
    }
  }
  pendingAttachments = [...pendingAttachments, ...results];
  if (decision.level === 'warn') {
    showToast('接近附件上限', decision.message, 'info');
  }
  renderAttachmentPreviews();
}

function removeAttachment(idx: number): void {
  pendingAttachments = pendingAttachments.filter((_, i) => i !== idx);
  renderAttachmentPreviews();
}

function renderAttachmentPreviews(): void {
  const container = document.getElementById('attachment-previews');
  if (!container) return;
  if (pendingAttachments.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = pendingAttachments.map((a, i) => `
    <div class="attachment-thumb" data-idx="${i}">
      <img src="${escapeHtml(a.dataUrl)}" alt="${escapeHtml(a.name)}" />
      <button class="attachment-remove" data-idx="${i}" title="移除">×</button>
      <div class="attachment-meta">
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-size">${formatBytes(a.size)}</div>
      </div>
    </div>
  `).join('');
  container.querySelectorAll<HTMLButtonElement>('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      removeAttachment(idx);
    });
  });
}

/**
 * Build the OpenAI-compatible multimodal content array for the API.
 * Pure function so we can unit-test it.
 *
 * - text-only: returns the same string (cheap path)
 * - text + 1+ images: returns an array with a text part + image_url parts
 * - images only (empty text): returns an array with only image parts
 */
export function buildMultimodalContent(
  text: string,
  attachments: PendingAttachment[],
): string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> {
  if (attachments.length === 0) return text;
  const parts: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];
  if (text.length > 0) parts.push({ type: 'text', text });
  for (const a of attachments) {
    parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
  }
  return parts;
}

// ── Voice input (T-Q-S13) ───────────────────────────────────────────────────────
//
// Web Audio API + MediaRecorder. Records from the default mic, then
// hands the audio bytes to the Rust `hermes_proxy_transcribe` Tauri
// command which uploads them to hermes-agent's
// /v1/audio/transcriptions endpoint (OpenAI Whisper-compatible).
// We never see the STT model — hermes-agent does the recognition.

const VOICE_MAX_MS = 60_000; // 1 min cap to keep uploads sane

async function startRecording(): Promise<void> {
  const micBtn = document.getElementById('mic-btn');
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('不支持录音', '当前环境无麦克风 API (需 HTTPS 或 localhost)', 'error');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Pick the best MIME type the browser supports. webm/opus is the
    // Chrome / Tauri-WebView2 default; Safari prefers mp4. The Rust
    // side derives the right file extension from the MIME type.
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav',
    ];
    const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingStream = stream;
    recordingChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      void onRecordingComplete();
    };
    mediaRecorder.start(100); // emit a chunk every 100ms
    micBtn?.classList.add('recording');
    showToast('开始录音', '再次点击麦克风停止 (上限 1 分钟)', 'info');
    // Auto-stop after VOICE_MAX_MS as a safety net.
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      }
    }, VOICE_MAX_MS);
  } catch (e) {
    showToast('麦克风权限被拒', String(e), 'error');
  }
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach(t => t.stop());
    recordingStream = null;
  }
  document.getElementById('mic-btn')?.classList.remove('recording');
}

async function onRecordingComplete(): Promise<void> {
  const blob = new Blob(recordingChunks, {
    type: mediaRecorder?.mimeType ?? 'audio/webm',
  });
  recordingChunks = [];
  if (blob.size === 0) {
    showToast('录音为空', '没有捕获到音频数据', 'error');
    return;
  }
  // Convert to base64 in chunks to avoid call-stack overflow on
  // large recordings (Tauri IPC has a 1MB-ish soft limit on
  // single-string args, though it auto-chunks; base64 inflates
  // 33% so 1.5MB audio → 2MB base64).
  const arrayBuf = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  let binary = '';
  const CHUNK = 0x8000; // 32 KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))),
    );
  }
  const audioBase64 = btoa(binary);
  const url = `${RESOLVED_GATEWAY_URL}/v1/audio/transcriptions`;
  try {
    const text = await invoke<string>('hermes_proxy_transcribe', {
      args: {
        url,
        audioBase64,
        mimeType: blob.type,
      },
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!text) {
      showToast('转写为空', '识别结果为空字符串', 'info');
      return;
    }
    // Fill the message input with the transcript. Append if there's
    // already text, otherwise replace.
    if (messageInput) {
      const current = messageInput.value.trim();
      messageInput.value = current ? `${current} ${text}` : text;
      messageInput.dispatchEvent(new Event('input'));
      messageInput.focus();
    }
    showToast('已转写', `${text.length} 字符 — 检查后发送`, 'success');
  } catch (e) {
    showToast('转写失败', String(e), 'error');
  }
}

// ── Persona Modal (T-Q-S7) ─────────────────────────────────────────────────────
//
// 3-state modal: list view (default) → create form → edit form. Single
// HTML container swapped between states. Builtin personas are read-only.

let personaModalMode: 'list' | 'create' | 'edit' = 'list';
let personaEditId: string | null = null;

function openPersonaModal(): void {
  const modal = document.getElementById('persona-modal');
  if (!modal) return;
  personaModalMode = 'list';
  personaEditId = null;
  renderPersonaModal();
  modal.classList.remove('hidden');
}

function closePersonaModal(): void {
  const modal = document.getElementById('persona-modal');
  if (modal) modal.classList.add('hidden');
}

function renderPersonaModal(): void {
  const body = document.getElementById('persona-modal-body');
  if (!body) return;
  if (personaModalMode === 'list') {
    body.innerHTML = renderPersonaListHtml();
    wirePersonaListEvents();
  } else if (personaModalMode === 'create') {
    body.innerHTML = renderPersonaFormHtml(null);
    wirePersonaFormEvents(null);
  } else if (personaModalMode === 'edit' && personaEditId) {
    const p = personasCache.find(x => x.id === personaEditId) ?? null;
    body.innerHTML = renderPersonaFormHtml(p);
    wirePersonaFormEvents(p);
  }
}

function renderPersonaListHtml(): string {
  const rows = personasCache.map(p => {
    const builtin = p.is_builtin === 1;
    const safeName = escapeHtml(p.name);
    const safeAvatar = escapeHtml(p.avatar || '');
    const safeDesc = escapeHtml(p.description || '(无描述)');
    const safePrompt = escapeHtml((p.system_prompt || '').slice(0, 120));
    const tag = builtin ? '<span class="persona-tag builtin">内置</span>' : '';
    const actions = builtin
      ? ''
      : `<button class="persona-action-btn" data-action="edit" data-id="${escapeHtml(p.id)}">编辑</button>
         <button class="persona-action-btn danger" data-action="delete" data-id="${escapeHtml(p.id)}">删除</button>`;
    return `
      <div class="persona-row" data-id="${escapeHtml(p.id)}">
        <div class="persona-avatar">${safeAvatar || '👤'}</div>
        <div class="persona-info">
          <div class="persona-name">${safeName} ${tag}</div>
          <div class="persona-desc">${safeDesc}</div>
          <div class="persona-prompt-preview">${safePrompt}${(p.system_prompt || '').length > 120 ? '…' : ''}</div>
        </div>
        <div class="persona-actions">${actions}</div>
      </div>`;
  }).join('');
  return `
    <div class="persona-toolbar">
      <button id="persona-new-btn" class="btn btn-primary">+ 新建 Persona</button>
    </div>
    <div class="persona-list">${rows || '<div class="persona-empty">暂无 Persona</div>'}</div>`;
}

function renderPersonaFormHtml(p: Persona | null): string {
  const isEdit = p !== null;
  const builtin = isEdit && p!.is_builtin === 1;
  const name = isEdit ? p!.name : '';
  const desc = isEdit ? p!.description || '' : '';
  const prompt = isEdit ? p!.system_prompt : '';
  const avatar = isEdit ? p!.avatar || '👤' : '👤';
  const model = isEdit ? p!.model || '' : '';
  // Builtin personas: name/avatar locked, description/prompt/model editable.
  const fieldDisabled = (_n: string) => builtin ? `disabled title="内置 Persona 不可修改"` : '';
  return `
    <div class="persona-form">
      <div class="form-group">
        <label>头像 (Emoji)</label>
        <input type="text" id="pf-avatar" maxlength="4" value="${escapeHtml(avatar)}" ${fieldDisabled('avatar')} />
      </div>
      <div class="form-group">
        <label>名称 *</label>
        <input type="text" id="pf-name" maxlength="60" value="${escapeHtml(name)}" ${fieldDisabled('name')} />
      </div>
      <div class="form-group">
        <label>简介</label>
        <input type="text" id="pf-desc" maxlength="200" value="${escapeHtml(desc)}" placeholder="一句话描述这个角色" />
      </div>
      <div class="form-group">
        <label>系统提示词 *</label>
        <textarea id="pf-prompt" rows="8" placeholder="定义助手的角色、风格、约束...">${escapeHtml(prompt)}</textarea>
        <span class="form-hint">每次新建会话时自动注入到 system 消息</span>
      </div>
      <div class="form-group">
        <label>绑定 Model (T-Q-S12-light)</label>
        <input type="text" id="pf-model" maxlength="80" value="${escapeHtml(model)}" placeholder="例如 gpt-4o-mini / deepseek-chat (留空 = 用默认)" />
        <span class="form-hint">选这个 Persona 时, 对话会用这个 model 名发请求. 留空则用全局默认.</span>
      </div>
      <div class="persona-form-actions">
        <button id="pf-cancel" class="btn btn-secondary">返回</button>
        <button id="pf-save" class="btn btn-primary">${isEdit ? '保存' : '创建'}</button>
      </div>
    </div>`;
}

function wirePersonaListEvents(): void {
  document.getElementById('persona-new-btn')?.addEventListener('click', () => {
    personaModalMode = 'create';
    renderPersonaModal();
  });
  document.querySelectorAll<HTMLElement>('.persona-action-btn').forEach(btn => {
    const id = btn.dataset.id!;
    const action = btn.dataset.action!;
    btn.addEventListener('click', async () => {
      if (action === 'edit') {
        personaModalMode = 'edit';
        personaEditId = id;
        renderPersonaModal();
      } else if (action === 'delete') {
        if (await deletePersonaApi(id)) {
          await loadPersonas();
          renderPersonaPicker();
          renderPersonaModal();
        }
      }
    });
  });
}

function wirePersonaFormEvents(p: Persona | null): void {
  const isEdit = p !== null;
  document.getElementById('pf-cancel')?.addEventListener('click', () => {
    personaModalMode = 'list';
    renderPersonaModal();
  });
  document.getElementById('pf-save')?.addEventListener('click', async () => {
    const name = (document.getElementById('pf-name') as HTMLInputElement).value.trim();
    const description = (document.getElementById('pf-desc') as HTMLInputElement).value.trim();
    const system_prompt = (document.getElementById('pf-prompt') as HTMLTextAreaElement).value.trim();
    const avatar = (document.getElementById('pf-avatar') as HTMLInputElement).value.trim() || '👤';
    const modelRaw = (document.getElementById('pf-model') as HTMLInputElement | null)?.value.trim() ?? '';
    const model = modelRaw.length > 0 ? modelRaw : null;
    if (!name) { showToast('请填写名称', '', 'error'); return; }
    if (!system_prompt) { showToast('请填写系统提示词', '', 'error'); return; }
    if (isEdit && p) {
      const updated = await updatePersonaApi({ ...p, name, description, system_prompt, avatar, model });
      if (updated) {
        await loadPersonas();
        renderPersonaPicker();
        personaModalMode = 'list';
        renderPersonaModal();
        showToast('已更新', updated.name, 'success');
      }
    } else {
      const created = await createPersonaApi(name, description, system_prompt, avatar, model);
      if (created) {
        await loadPersonas();
        renderPersonaPicker();
        personaModalMode = 'list';
        renderPersonaModal();
        showToast('已创建', created.name, 'success');
      }
    }
  });
}

// ── Search Modal ──────────────────────────────────────────────────────────────

function openSearchModal(): void {
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-input') as HTMLInputElement;
  const results = document.getElementById('search-results');
  if (!modal || !input || !results) return;
  modal.classList.remove('hidden');
  input.value = '';
  results.innerHTML = '';
  input.focus();
}

function closeSearchModal(): void {
  const modal = document.getElementById('search-modal');
  if (modal) modal.classList.add('hidden');
}

async function runSearch(query: string): Promise<void> {
  const results = document.getElementById('search-results');
  if (!results) return;
  if (!query.trim()) {
    results.innerHTML = '';
    return;
  }
  try {
    results.innerHTML = '<div class="search-empty">搜索中...</div>';
    const hits = await invoke<SearchHit[]>('session_search', { query: query.trim(), limit: 20 });
    results.innerHTML = '';
    if (hits.length === 0) {
      results.innerHTML = `<div class="search-empty">未找到与「${escapeHtml(query.trim())}」相关的会话</div>`;
      return;
    }
    const countDiv = document.createElement('div');
    countDiv.className = 'search-count';
    countDiv.textContent = `${hits.length} 个结果`;
    results.appendChild(countDiv);
    for (const hit of hits) {
      const el = document.createElement('div');
      el.className = 'search-result-item';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'search-result-title';
      titleDiv.textContent = hit.session_title || '无标题会话';
      const snippetDiv = document.createElement('div');
      snippetDiv.className = 'search-result-snippet';
      snippetDiv.innerHTML = sanitizeSnippet(hit.snippet);
      el.appendChild(titleDiv);
      el.appendChild(snippetDiv);
      el.addEventListener('click', async () => {
        closeSearchModal();
        if (!sidebarVisible) toggleSidebar(true);
        await selectSession(hit.session_id);
      });
      results.appendChild(el);
    }
  } catch (e) {
    results.innerHTML = `<div class="search-empty">搜索失败: ${e}</div>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Strip dangerous HTML tags from FTS5 snippet (keeps <b> for highlighting)
function sanitizeSnippet(s: string): string {
  return s
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=/gi, ' data-ignored=')
    .replace(/javascript:/gi, '');
}

window.addEventListener('DOMContentLoaded', async () => {
  // Resolve WSL2 gateway IP dynamically
  try {
    const info = await invoke<GatewayInfo>('hermes_resolve_gateway_ip');
    RESOLVED_GATEWAY_URL = info.url;
    console.log('[Hermes] Gateway resolved:', info.url);
  } catch {
    // Fallback
    RESOLVED_GATEWAY_URL = 'http://172.31.98.230:8642';
    console.warn('[Hermes] Gateway IP detection failed, using fallback');
  }

  // Load saved API key and port from config
  try {
    const config: Record<string, any> = await invoke('hermes_get_config');
    if (config.api_key) {
      API_KEY = config.api_key;
    }
    if (config.port && RESOLVED_GATEWAY_URL) {
      // Replace port in the URL
      RESOLVED_GATEWAY_URL = RESOLVED_GATEWAY_URL.replace(/:\d+$/, `:${config.port}`);
    }
  } catch { /* no config */ }

  messagesContainer = document.getElementById('messages');
  messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
  sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  connectionStatusEl = document.getElementById('connection-status');
  statusText = document.getElementById('status-text');
  modelName = document.getElementById('model-name');
  charCount = document.getElementById('char-count');
  chatForm = document.getElementById('chat-form') as HTMLFormElement;

  chatForm?.addEventListener('submit', handleSubmit);

  // T-Q-S13: mic button — toggle recording. While recording, the
  // button pulses red. On stop, the audio blob is sent to hermes-agent
  // for transcription; the text fills the message input.
  const micBtn = document.getElementById('mic-btn');
  micBtn?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      void startRecording();
    }
  });

  // T-Q-S14: attach button + drag/drop handlers. We listen on the
  // form (not the textarea) so a drop anywhere in the input area
  // works. preventDefault on dragenter/over is required to enable
  // the drop event; we toggle a CSS class for a visual highlight.
  const attachBtn = document.getElementById('attach-btn');
  const attachFileInput = document.getElementById('attach-file-input') as HTMLInputElement | null;
  attachBtn?.addEventListener('click', () => attachFileInput?.click());
  attachFileInput?.addEventListener('change', () => {
    if (attachFileInput.files && attachFileInput.files.length > 0) {
      void addAttachments(attachFileInput.files);
      attachFileInput.value = ''; // reset so re-picking same file works
    }
  });
  let dragCounter = 0;
  chatForm?.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    chatForm?.classList.add('dragging');
  });
  chatForm?.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  chatForm?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      chatForm?.classList.remove('dragging');
      dragCounter = 0;
    }
  });
  chatForm?.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    chatForm?.classList.remove('dragging');
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files && dt.files.length > 0) {
      void addAttachments(dt.files);
    }
  });
  messageInput?.addEventListener('input', handleInput);
  messageInput?.addEventListener('keydown', handleKeydown);

  // Setup SSE stream listeners
  unlistenChunk = await listen<string>('hermes-stream-chunk', (event) => {
    handleStreamChunk(event.payload);
  });
  unlistenDone = await listen('hermes-stream-done', () => {
    finishStream();
  });

  // Listen for gateway notifications from tray menu
  await listen<{ type: string; title: string; message: string }>('gateway-notification', (event) => {
    showToast(event.payload.title, event.payload.message, event.payload.type as ToastType);
  });

  // ── T-Q-S6: Tray quick action listeners ──────────────────
  // Rust side emits these when user clicks tray menu items
  // (新建会话 / 续上次 / 搜索). Frontend owns the actual UX.
  await listen('tray://new-session', () => {
    void createSession();
  });
  await listen('tray://continue-last', () => {
    void loadLastSession();
  });
  await listen('tray://open-search', () => {
    openSearchModal();
  });

  // ── Settings Initialization ──────────────────

  const settingsModal = document.getElementById('settings-modal')!;
  const settingsBtn = document.getElementById('settings-btn')!;
  const settingsClose = document.getElementById('settings-close')!;
  const settingsCancel = document.getElementById('settings-cancel')!;
  const settingsSave = document.getElementById('settings-save')!;
  const wslDistroSelect = document.getElementById('setting-wsl-distro') as HTMLSelectElement;
  const portInput = document.getElementById('setting-port') as HTMLInputElement;
  const apiKeyInput = document.getElementById('setting-api-key') as HTMLInputElement;
  const defaultProjectPathInput = document.getElementById('setting-default-project-path') as HTMLInputElement;
  const defaultModelInput = document.getElementById('setting-default-model') as HTMLInputElement;

  // Open settings
  settingsBtn.addEventListener('click', () => openSettings());
  settingsClose.addEventListener('click', closeSettings);
  settingsCancel.addEventListener('click', closeSettings);

  // Click overlay to close
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  // Save
  settingsSave.addEventListener('click', () => saveSettings());

  // Load WSL distro list on open
  function openSettings() {
    settingsModal.classList.remove('hidden');
    loadSettings();
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
  }

  async function loadSettings() {
    // Load WSL distro list
    try {
      const distros = await invoke<string[]>('hermes_list_wsl_distros');
      wslDistroSelect.innerHTML = '';
      for (const d of distros) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        wslDistroSelect.appendChild(opt);
      }
    } catch { /* no WSL */ }

    // Load current config values
    try {
      const config: Record<string, any> = await invoke('hermes_get_config');
      if (config.wsl_distro && wslDistroSelect.querySelector(`option[value="${config.wsl_distro}"]`)) {
        wslDistroSelect.value = config.wsl_distro;
      }
      if (config.port) {
        portInput.value = config.port;
      }
      if (config.api_key) {
        apiKeyInput.value = config.api_key;
      }
    } catch { /* no config yet */ }

    // T-Q-S8: load default_project_path from the DB-backed config table
    // (separate from the legacy config.json shown above).
    try {
      const entry = await invoke<{ key: string; value: string } | null>('db_config_get', { key: 'default_project_path' });
      if (entry?.value) {
        defaultProjectPathInput.value = entry.value;
        defaultProjectPath = entry.value;
      }
    } catch { /* key not set yet */ }

    // T-Q-S12-light: load default_model from the DB-backed config table.
    try {
      const entry = await invoke<{ key: string; value: string } | null>('db_config_get', { key: 'default_model' });
      if (entry?.value) {
        defaultModelInput.value = entry.value;
        defaultModel = entry.value;
      }
    } catch { /* key not set yet */ }
  }

  async function saveSettings() {
    const updates: Record<string, any> = {};
    const distro = wslDistroSelect.value;
    const port = portInput.value;
    const apiKey = apiKeyInput.value;

    if (distro) updates.wsl_distro = distro;
    if (port) updates.port = Number(port);
    if (apiKey) updates.api_key = apiKey;

    try {
      await invoke('hermes_save_config', { updates });

      // T-Q-S8: save default_project_path to the DB-backed config table.
      // Save as empty string when the input is blank so subsequent loads
      // can distinguish "user cleared it" from "not set yet".
      const newDefaultPath = defaultProjectPathInput.value.trim();
      await setDefaultProjectPath(newDefaultPath.length > 0 ? newDefaultPath : null);
      defaultProjectPath = newDefaultPath.length > 0 ? newDefaultPath : null;

      // T-Q-S12-light: save default_model.
      const newDefaultModel = defaultModelInput.value.trim();
      await setDefaultModel(newDefaultModel.length > 0 ? newDefaultModel : null);
      defaultModel = newDefaultModel.length > 0 ? newDefaultModel : null;

      showToast('设置已保存', '配置已更新，部分设置可能需要重启后生效', 'success');
      closeSettings();

      // Apply settings at runtime
      if (apiKey) API_KEY = apiKey;

      // Re-resolve gateway after distro/port change
      try {
        const info = await invoke<GatewayInfo>('hermes_resolve_gateway_ip');
        RESOLVED_GATEWAY_URL = info.url;
        // Apply port override
        if (port && RESOLVED_GATEWAY_URL) {
          RESOLVED_GATEWAY_URL = RESOLVED_GATEWAY_URL.replace(/:\d+$/, `:${port}`);
        }
      } catch { /* keep old */ }
    } catch (e) {
      showToast('保存失败', String(e), 'error');
    }
  }

  // ── Session Sidebar ───────────────────────────────────────────────────────
  const sidebarNewBtn = document.getElementById('sidebar-new-btn');
  const sidebarSearchBtn = document.getElementById('sidebar-search-btn');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarShowBtn = document.getElementById('sidebar-show-btn');

  sidebarNewBtn?.addEventListener('click', async () => {
    await createSession();
  });

  sidebarSearchBtn?.addEventListener('click', openSearchModal);
  sidebarToggleBtn?.addEventListener('click', () => toggleSidebar(false));
  sidebarShowBtn?.addEventListener('click', () => toggleSidebar(true));

  // Ctrl+K = search
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearchModal();
    }
    if (e.key === 'Escape') {
      closeSearchModal();
    }
  });

  // Search modal
  const searchModal = document.getElementById('search-modal')!;
  const searchClose = document.getElementById('search-close')!;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  searchClose.addEventListener('click', closeSearchModal);
  searchModal.addEventListener('click', (e) => {
    if (e.target === searchModal) closeSearchModal();
  });
  let searchDebounce: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(searchInput.value), 250);
  });

  // Load session list on startup
  await loadSessionList();

  // ── T-Q-S7: Persona init ─────────────────────────────
  // Load builtin + custom personas, then restore the user's last
  // selected default from the DB config. If the saved id no longer
  // exists (e.g. deleted), the picker silently falls back to "无".
  await loadPersonas();
  currentPersonaId = await loadDefaultPersonaId();
  renderPersonaPicker();
  const personaPicker = document.getElementById('persona-picker') as HTMLSelectElement | null;
  personaPicker?.addEventListener('change', () => { void onPersonaPickerChange(); });

  // Manage button (next to picker) → open the persona library modal
  document.getElementById('persona-manage-btn')?.addEventListener('click', () => openPersonaModal());
  const personaModal = document.getElementById('persona-modal');
  document.getElementById('persona-modal-close')?.addEventListener('click', closePersonaModal);
  personaModal?.addEventListener('click', (e) => {
    if (e.target === personaModal) closePersonaModal();
  });

  // ── T-Q-S8: default project path init ────────────────────
  // Restore the user's saved project path so new sessions auto-attach
  // the project context. If the saved path no longer exists, the scan
  // will fail at createSession time and the user will see a toast.
  defaultProjectPath = await loadDefaultProjectPath();

  // ── T-Q-S12-light: default model init ────────────────────
  defaultModel = await loadDefaultModel();

  // ── T-Q-S9: stats modal wiring ───────────────────
  const statsModal = document.getElementById('stats-modal');
  document.getElementById('stats-modal-close')?.addEventListener('click', closeStatsModal);
  statsModal?.addEventListener('click', (e) => {
    if (e.target === statsModal) closeStatsModal();
  });
  document.getElementById('sidebar-stats-btn')?.addEventListener('click', () => openStatsModal());

  // ── T-Q-S10: share link button + import from URL hash ─────────
  // The share button copies a self-contained URL to the clipboard.
  // On app launch, if the URL has #share=<base64url-json>, show an
  // import confirmation modal.
  document.getElementById('share-link-btn')?.addEventListener('click', () => {
    if (currentSessionId) {
      void copySessionShareLink(currentSessionId);
    } else {
      showToast('没有当前会话', '请先创建或选择一个会话', 'info');
    }
  });
  // Check URL hash on startup for a pending share import.
  void maybeImportFromHash();

  // ── T-Q-S11: backup modal wiring ──────────────────────────
  document.getElementById('sidebar-backup-btn')?.addEventListener('click', () => openBackupModal('create'));
  document.getElementById('backup-modal-close')?.addEventListener('click', closeBackupModal);
  document.getElementById('backup-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('backup-modal')) closeBackupModal();
  });
  document.querySelectorAll<HTMLElement>('.backup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab as BackupTab;
      document.querySelectorAll<HTMLElement>('.backup-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === target);
      });
      document.getElementById('backup-tab-create')?.classList.toggle('hidden', target !== 'create');
      document.getElementById('backup-tab-restore')?.classList.toggle('hidden', target !== 'restore');
    });
  });
  document.getElementById('backup-create-btn')?.addEventListener('click', () => { void handleBackupCreate(); });
  document.getElementById('backup-verify-btn')?.addEventListener('click', () => { void handleBackupVerify(); });
  document.getElementById('backup-restore-btn')?.addEventListener('click', () => { void handleBackupRestore(); });

  // Register global shortcut: Ctrl+Shift+H — quick capture new session
  try {
    await register('Ctrl+Shift+H', async () => {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
      // T-Q-S5 增强: 复用 createSession() 直接开新会话（其内部已自动
      // 设 currentSessionId、刷新 messages 显示与侧边栏列表）
      const newId = await createSession();
      if (!newId) {
        console.warn('[GlobalShortcut] createSession returned null');
        messageInput?.focus();
        return;
      }
      // 收掉侧边栏到 focus 模式、清空输入、focus 让用户立刻打字
      if (sidebarVisible) toggleSidebar(false);
      if (messageInput) messageInput.value = '';
      messageInput?.focus();
    });
    console.log('[GlobalShortcut] Ctrl+Shift+H registered (quick capture)');
  } catch (e) {
    console.warn('[GlobalShortcut] Failed to register:', e);
  }

  // Cleanup on unload
  window.addEventListener('unload', async () => {
    unlistenChunk?.();
    unlistenDone?.();
    try {
      await unregister('Ctrl+Shift+H');
    } catch { /* ignore */ }
  });

  checkConnection();

  // Periodic health check every 30 seconds
  setInterval(() => {
    checkConnection();
  }, 30000);
});

type ToastType = 'success' | 'error' | 'info';

function showToast(title: string, message: string, type: ToastType = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-message">${message}</div>`;
  toast.addEventListener('click', () => {
    toast.classList.add('fadeout');
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  // Auto-dismiss after 3.5s
  setTimeout(() => {
    if (toast.isConnected) {
      toast.classList.add('fadeout');
      setTimeout(() => toast.remove(), 300);
    }
  }, 3500);
}

function handleInput() {
  if (!messageInput || !sendBtn || !charCount) return;
  const length = messageInput.value.length;
  charCount.textContent = `${length} / ${CONFIG.maxInputLength}`;
  sendBtn.disabled = state.isLoading || length > CONFIG.maxInputLength;
  charCount.style.color = length > CONFIG.maxInputLength ? 'var(--error)' : '';
  // Auto-resize: reset then set to scrollHeight
  messageInput.style.height = 'auto';
  const newHeight = Math.min(messageInput.scrollHeight, 200);
  messageInput.style.height = newHeight + 'px';
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn?.disabled) chatForm?.dispatchEvent(new Event('submit'));
  }
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!messageInput || state.isLoading) return;
  const content = messageInput.value.trim();
  // T-Q-S14: allow send if attachments are present even when text is empty.
  if (!content && pendingAttachments.length === 0) return;
  const attachmentsAtSend = pendingAttachments;
  messageInput.value = '';
  messageInput.dispatchEvent(new Event('input'));
  if (messageInput) messageInput.style.height = 'auto';
  pendingAttachments = [];
  renderAttachmentPreviews();

  // Ensure we have an active session
  if (!currentSessionId) {
    currentSessionId = await createSession();
    if (!currentSessionId) return;
  }

  addMessage('user', content, attachmentsAtSend);
  // Persist user message to DB (text only — images go in metadata for size).
  if (currentSessionId) {
    const metadata = attachmentsAtSend.length > 0
      ? JSON.stringify({
          attachments: attachmentsAtSend.map(a => ({ name: a.name, type: a.type, size: a.size })),
        })
      : null;
    invoke('message_append', {
      sessionId: currentSessionId,
      role: 'user',
      content,
      toolCalls: null,
      metadata,
    }).catch(e => console.error('[DB] save user msg failed:', e));
    invoke('session_touch', { id: currentSessionId }).catch(() => {});
    // T-Q-S9: refresh session list so the token badge in the sidebar
    // updates after each send. We only re-fetch the current row to
    // avoid a full list reload.
    void refreshCurrentSessionRow();
  }

  await sendMessage();
}

function addMessage(role: 'user' | 'assistant', content: string, attachments?: PendingAttachment[]) {
  const msg: Message = { role, content, timestamp: new Date() };
  if (attachments && attachments.length > 0) msg.attachments = attachments;
  state.messages.push(msg);
  renderMessage(msg);
  scrollToBottom();
}

function renderMessage(message: Message) {
  if (!messagesContainer) return;
  const welcome = messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${message.role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = message.role === 'user' ? '👤' : '🤖';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = message.role === 'assistant' ? formatMessage(message.content) : message.content;

  div.appendChild(avatar);
  div.appendChild(content);
  messagesContainer.appendChild(div);
}

function formatMessage(content: string): string {
  // Use marked for full GFM markdown rendering (tables, code blocks with syntax highlighting, etc.)
  return marked.parse(content) as string;
}

/**
 * S14-agent: turn the routing_decision JSON blob into a one-line trace
 * for the stats modal. The agent pushes a structured dict like:
 *   { mode: "native" | "text", primary_provider, primary_model,
 *     resolved_provider, resolved_model, fallback_used, fallback_reason,
 *     fallback_provider, fallback_model }
 * We render the bits the user cares about and ignore unknown fields so
 * future agent-side additions don't break the UI.
 */
export function formatRoutingTrace(blob: string | null): string {
  if (!blob) return '';
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(blob) as Record<string, unknown>; }
  catch { return ''; }
  const mode = typeof parsed.mode === 'string' ? parsed.mode : null;
  const provider = typeof parsed.resolved_provider === 'string' ? parsed.resolved_provider : null;
  const model = typeof parsed.resolved_model === 'string' ? parsed.resolved_model : null;
  const fallbackUsed = parsed.fallback_used === true;
  const fallbackReason = typeof parsed.fallback_reason === 'string' ? parsed.fallback_reason : null;
  const fallbackProvider = typeof parsed.fallback_provider === 'string' ? parsed.fallback_provider : null;
  if (fallbackUsed && fallbackProvider) {
    return `vision fallback: ${provider}/${model} (primary ${fallbackReason ?? 'unavailable'})`;
  }
  if (mode && provider) {
    return `vision ${mode}: ${provider}/${model}`;
  }
  return '';
}

/** S14-agent: render elapsed_ms as a human latency string. */
export function formatLatencyMs(ms: number | null): string {
  if (ms == null || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function createStreamMessage(): HTMLElement {
  if (!messagesContainer) return document.createElement('div');
  const div = document.createElement('div');
  div.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🤖';
  const content = document.createElement('div');
  content.className = 'message-content';
  div.appendChild(avatar);
  div.appendChild(content);
  messagesContainer.appendChild(div);
  scrollToBottom();
  return content;
}

function handleStreamChunk(payload: string) {
  // Parse SSE data: lines that start with "data: "
  const lines = payload.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);
    if (data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        state.streamContent += delta;
        if (state.streamElement) {
          state.streamElement.innerHTML = formatMessage(state.streamContent);
          scrollToBottom();
        }
      }
      // S14-agent: capture the final-chunk usage + routing metadata so
      // finishStream() can persist the real token count (replacing the
      // char/4 heuristic) and surface the routing decision in the
      // stats modal. We hold the *latest* value seen — OpenAI streaming
      // sends usage exactly once at the end, but a few proxies repeat it
      // across chunks and we want the most recent.
      const usage = json.usage;
      if (usage && typeof usage === 'object') {
        state.lastStreamUsage = usage;
        const rd = (usage as Record<string, unknown>).routing_decision;
        if (rd) state.lastStreamRouting = rd;
        const el = (usage as Record<string, unknown>).elapsed_ms;
        if (typeof el === 'number') state.lastStreamElapsedMs = el;
      }
      // Some agent shapes emit routing_decision at the top level of the
      // final chunk (not nested under usage). Cover that case too.
      const topRd = (json as Record<string, unknown>).routing_decision;
      if (topRd) state.lastStreamRouting = topRd;
      const topEl = (json as Record<string, unknown>).elapsed_ms;
      if (typeof topEl === 'number') state.lastStreamElapsedMs = topEl;
    } catch { /* skip invalid JSON */ }
  }
}

/**
 * v0.1.5 S12: turn the per-turn routing telemetry into the one-line
 * "CLI bar" text. Format:
 *   💰 $0.0234 · ⏱ 3.4s · 🛡 vision_fallback_config
 *
 * Pure function so it can be unit-tested without a DOM. Each section
 * is appended in fixed order (cost → latency → rule) and only when
 * the field has a meaningful value, so pre-S12 messages that have no
 * telemetry get a single missing segment (or nothing) rather than a
 * half-empty bar.
 *
 * Returns the formatted string, or null when none of the three
 * fields has a meaningful value (e.g. a pre-S12 message) — the
 * caller can then skip appending a bar at all.
 */
export function formatMessageBar(args: {
  costUsd: number;
  elapsedMs: number | null;
  ruleId: string | null;
  costThresholdExceeded: boolean;
}): string | null {
  const parts: string[] = [];
  if (args.costUsd > 0) {
    parts.push(`💰 $${args.costUsd.toFixed(4)}`);
  }
  if (args.elapsedMs != null && args.elapsedMs > 0) {
    // Reuse formatLatencyMs from the routing-trace helper.
    parts.push(`⏱ ${formatLatencyMs(args.elapsedMs)}`);
  }
  if (args.ruleId) {
    parts.push(`🛡 ${args.ruleId}`);
  } else if (args.costThresholdExceeded) {
    // Threshold was tripped but the agent didn't surface a rule_id —
    // surface the breach anyway so the user can see something fired.
    parts.push(`🛡 cost_threshold_exceeded`);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/**
 * v0.1.5 S12: DOM wrapper around `formatMessageBar`. Creates the
 * `<div class="message-bar">` element and adds the `-warn` modifier
 * when the S12 cost-aware fallback flagged a budget overrun, so
 * silent overruns are visible without opening the stats modal.
 */
function buildMessageBar(args: {
  costUsd: number;
  elapsedMs: number | null;
  ruleId: string | null;
  costThresholdExceeded: boolean;
}): HTMLElement | null {
  const text = formatMessageBar(args);
  if (text == null) return null;
  const div = document.createElement('div');
  div.className = 'message-bar';
  if (args.costThresholdExceeded) div.classList.add('message-bar-warn');
  div.textContent = text;
  return div;
}

async function finishStream() {
  if (state.streamContent) {
    state.messages.push({
      role: 'assistant',
      content: state.streamContent,
      timestamp: new Date(),
    });
      // Persist assistant message to DB
      if (currentSessionId) {
        // message_append returns the persisted Message (with the new id).
        // We need that id to call message_record_usage in the S14 path.
        try {
          const appended = await invoke<{ id: string; tokens: number }>('message_append', {
            sessionId: currentSessionId,
            role: 'assistant',
            content: state.streamContent,
            toolCalls: null,
          });
          // S14-agent: if the upstream pushed real usage, replace the
          // char/4 heuristic tokens + stash image_tokens / routing_decision
          // on the message metadata so the stats modal can show them.
          const usage = state.lastStreamUsage;
          if (appended?.id && usage && typeof usage.prompt_tokens === 'number') {
            const detail = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
            const imageTokens = typeof detail.image_tokens === 'number'
              ? detail.image_tokens : 0;
            const routingJson = state.lastStreamRouting != null
              ? JSON.stringify(state.lastStreamRouting) : null;
            // v0.1.5 S12: real cost (USD) + cost-aware fallback flag.
            // - cost_estimate_usd is pushed at the top level of the usage
            //   payload by the agent (replaces the char/4 projection).
            // - cost_threshold_exceeded lives inside routing_decision
            //   (mirrors the S12 RoutingDecision dataclass field).
            // - rule_id is the S12 routing rule that fired (e.g.
            //   "vision_fallback_config"), used for the CLI bar.
            const costUsd = typeof usage.cost_estimate_usd === 'number'
              ? usage.cost_estimate_usd : 0;
            const routingObj = (state.lastStreamRouting ?? {}) as Record<string, unknown>;
            const costThresholdExceeded = routingObj.cost_threshold_exceeded === true;
            const ruleId = typeof routingObj.rule_id === 'string'
              ? routingObj.rule_id : null;
            await invoke('message_record_usage', {
              id: appended.id,
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens ?? 0,
              imageTokens,
              routingDecisionJson: routingJson,
              elapsedMs: state.lastStreamElapsedMs ?? null,
              costEstimateUsd: costUsd,
              costThresholdExceeded,
            });
            // v0.1.5 S12 CLI bar: render the per-turn cost / latency /
            // rule summary as a one-liner under the assistant message.
            // We attach it to the parent .message.assistant element (not
            // the content div) so it sits BELOW the markdown body and
            // stays in place across future re-renders.
            const barParent = state.streamElement?.parentElement;
            if (barParent) {
              const bar = buildMessageBar({
                costUsd,
                elapsedMs: state.lastStreamElapsedMs,
                ruleId,
                costThresholdExceeded,
              });
              if (bar) barParent.appendChild(bar);
            }
          }
        } catch (e) {
          console.error('[DB] save assistant msg failed:', e);
        }
        invoke('session_touch', { id: currentSessionId }).catch(() => {});
        // T-Q-S9: refresh sidebar row so the token badge updates after
        // each assistant reply. The user sees their spend climbing live.
        void refreshCurrentSessionRow();
      }
  }
  state.isLoading = false;
  state.isStreaming = false;
  state.streamContent = '';
  state.streamElement = null;
  // S14: clear the per-stream metadata so the next turn starts fresh.
  state.lastStreamUsage = null;
  state.lastStreamRouting = null;
  state.lastStreamElapsedMs = null;
  updateSendButton();
}

async function sendMessage() {
  state.isLoading = true;
  updateSendButton();

  // Start streaming message
  state.isStreaming = true;
  state.streamContent = '';
  state.streamElement = createStreamMessage();

  try {
    // T-Q-S7 + T-Q-S8: prepend a system message that combines the session's
    // persona system_prompt with the cached project context summary.
    // Compose is a pure function in src/systemPrompt.ts (covered by
    // 12 unit tests); here we just wire the inputs.
    const systemContent = await buildCurrentSystemPrompt();
    // T-Q-S14: build multimodal content for the last user message if
    // it has attachments. Older messages in the window are sent as
    // text (their attachments are not re-attached — hermes-agent
    // would need to re-read them from storage, out of MVP scope).
    const recent = state.messages
      .filter(m => m.role !== 'system')
      .slice(-10);
    // Find the last user message in the window. We only attach images
    // to the most recent user turn — older ones are sent as text only.
    let lastUserIdx = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].role === 'user') { lastUserIdx = i; break; }
    }
    const userMessages = recent.map((m, i) => ({
      role: m.role,
      content: (i === lastUserIdx && m.attachments && m.attachments.length > 0)
        ? buildMultimodalContent(m.content, m.attachments)
        : m.content,
    }));
    const apiMessages = systemContent === null
      ? userMessages
      : [{ role: 'system' as const, content: systemContent }, ...userMessages];

    // Use streaming — response is empty, chunks via events
    // T-Q-S12-light: model priority chain. See `pickModelForRequest`
    // for the pure function and its tests. hermes-agent handles
    // routing/retries; tray just sends the name.
    const persona = currentSession?.persona_id
      ? personasCache.find(p => p.id === currentSession!.persona_id) ?? null
      : null;
    const model = pickModelForRequest(persona, state.currentModel, defaultModel, CONFIG.defaultModel);
    await hermesPostStream('/v1/chat/completions', {
      model,
      messages: apiMessages,
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature,
      stream: true,
    });

  } catch (error) {
    state.isStreaming = false;
    state.streamContent = '';
    console.error('Send message error:', error);
    let errorMsg = error instanceof Error ? error.message : String(error);

    // Remove the stream message element if present
    if (state.streamElement) {
      state.streamElement.parentElement?.remove();
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error';
    errorDiv.innerHTML = `<div class="message-content">❌ 连接失败: ${errorMsg}<br><small>请确保 Hermes Gateway 正在运行 (${RESOLVED_GATEWAY_URL})</small></div>`;
    messagesContainer?.appendChild(errorDiv);
    scrollToBottom();
    updateSendButton();
  }
}

async function checkConnection() {
  updateConnectionStatus('connecting');
  // Show the resolved URL in status
  if (statusText) {
    statusText.textContent = `连接中... (${RESOLVED_GATEWAY_URL})`;
  }
  try {
    const response = await hermesGet('/health');
    if (response.ok) {
      updateConnectionStatus('connected');
      await fetchModelInfo();
    } else {
      if (statusText) statusText.textContent = `连接失败 (HTTP ${response.status})`;
    }
  } catch (e) {
    if (statusText) statusText.textContent = `连接失败: ${e}`;
  }
}

async function fetchModelInfo() {
  try {
    const response = await hermesGet('/v1/models');
    if (response.ok) {
      const data = JSON.parse(response.body);
      if (data.data && data.data.length > 0) {
        state.currentModel = data.data[0].id;
      } else {
        state.currentModel = CONFIG.defaultModel;
      }
    } else {
      state.currentModel = CONFIG.defaultModel;
    }
  } catch {
    state.currentModel = CONFIG.defaultModel;
  }
  if (modelName) modelName.textContent = state.currentModel;
}

function updateConnectionStatus(status: 'disconnected' | 'connecting' | 'connected') {
  state.connectionStatus = status;
  if (connectionStatusEl) connectionStatusEl.className = `status-dot ${status}`;
  if (statusText) {
    const labels: Record<string, string> = { disconnected: '未连接', connecting: '连接中...', connected: '已连接' };
    statusText.textContent = labels[status] || status;
  }
}

function updateSendButton() {
  if (!sendBtn) return;
  const label = document.getElementById('send-btn-label');
  const icon = document.getElementById('send-btn-icon');
  if (!label || !icon) return;
  sendBtn.disabled = state.isLoading;
  if (state.isLoading) {
    label.textContent = '生成中...';
    icon.style.display = 'none';
  } else {
    label.textContent = '';
    icon.style.display = '';
  }
}

function scrollToBottom() {
  if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
