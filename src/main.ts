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
import { formatTokens } from './tokenChart';

import { hermesGet, hermesPostStream, authHeaders } from './lib/api';
import { showToast, type ToastType } from './lib/toast';
import { mountAppToaster } from './lib/toaster-mount';
import { mountSearchModal } from './views/search-modal-mount';
import { searchModalStore } from './views/search-modal-store';
import { mountPersonaModal } from './views/persona-modal-mount';
import { personaStore } from './views/persona-modal-store';
import { mountBackupModal } from './views/backup-modal-mount';
import { backupStore } from './views/backup-modal-store';
import { mountStatsModal } from './views/stats-modal-mount';
import { statsStore } from './views/stats-modal-store';
import { mountSettingsModal } from './views/settings-modal-mount';
import { settingsStore } from './views/settings-modal-store';
import { escapeHtml } from './lib/sanitize';
import type { Persona } from './types';
import {
  encodeShareDoc,
  buildShareUrl,
  parseShareHash,
} from './shareLink';
import {
  getGatewayUrl,
  setApiKey,
  resolveGatewayUrl,
  applyPortOverride,
} from './lib/state';

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

// Token stats types (T-Q-S9) live in src/types.ts and are imported where
// needed (e.g. src/views/stats-modal.tsx). The local interfaces below
// are only for DbMessage and other app-shell types.

// ── Db message shape ──────────────────────────────────────────────────────

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

// SearchHit is imported by ./views/search-modal.tsx from ./types directly.
// No local interface needed in main.ts — the previous runSearch() used it,
// but runSearch() moved to the view.

// ── Persona types (T-Q-S7) ──────────────────────────────────────────────────────
//
// A persona = reusable assistant role. Carries system_prompt that gets
// injected when a new session is created from it. Also serves as the
// "session template" library — no separate templates table needed.
//
// The Persona interface lives in ./types (alpha-1 extraction + alpha-8 schema
// sync). main.ts imports it via `import type { Persona } from './types'`.

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

// v0.2-alpha-3 — HermesResponse / GatewayInfo + hermesGet / hermesPostStream +
// module-level gateway URL / API key bindings moved out:
//   - HermesResponse / GatewayInfo → './types' (single source of truth, matches Rust schema)
//   - hermesGet / hermesPostStream / authHeaders → './lib/api'
//   - getGatewayUrl / setGatewayUrl / getApiKey / setApiKey /
//     resolveGatewayUrl / applyPortOverride → './lib/state'
// Import block at the top of this file already pulls them in; just call them.
//
// Bootstrap (DOMContentLoaded) and the settings save handler are the two
// places that mutate state — they call the new setters. Everything else
// reads via getters and stays untouched.

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
 * Encoding lives in `./shareLink` (encodeShareDoc + buildShareUrl);
 * this wrapper just owns the Tauri invoke + clipboard + toast bits.
 */
async function copySessionShareLink(sessionId: string): Promise<void> {
  try {
    const json = await invoke<unknown>('export_session_json', { sessionId });
    const encoded = encodeShareDoc(json);
    const url = buildShareUrl(encoded, window.location.origin, window.location.pathname);
    await navigator.clipboard.writeText(url);
    showToast('分享链接已复制', `${url.length} 字符 — 接收方打开即可导入`, 'success');
  } catch (e) {
    showToast('生成链接失败', String(e), 'error');
  }
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
  // parseShareHash returns null on no-match OR decode failure, so the only
  // way to reach the body is a successfully-decoded document.
  const decoded = parseShareHash(window.location.hash);
  if (decoded === null) return;
  try {
    const doc = decoded as {
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

// alpha-11: setDefaultModel moved into views/settings-modal.tsx (which
// now writes db_config directly via invoke). main.ts keeps the module-
// level defaultModel let for sendMessage + model picker reads.

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

// createPersonaApi / updatePersonaApi / deletePersonaApi moved into
// ./views/persona-modal.tsx (alpha-8). main.ts no longer wraps the
// CRUD commands — the persona-modal component calls invoke directly
// with toast-side error handling.

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
//
// Token stats modal migrated to src/views/stats-modal.tsx in alpha-10.
// TokenStats / DailyBucket / ModelBucket / RuleBucket types live in
// src/types.ts (already exported since alpha-1). renderChartSvg and
// the innerHTML-driven renderStatsModal are gone — the Preact
// component renders the same structure as JSX with proper Preact
// reconciliation.

// ── Backup (T-Q-S11) ─────────────────────────────────────────────────────────────

function openBackupModal(): void {
  backupStore.setOpen(true);
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
  const url = `${getGatewayUrl()}/v1/audio/transcriptions`;
  try {
    const text = await invoke<string>('hermes_proxy_transcribe', {
      args: {
        url,
        audioBase64,
        mimeType: blob.type,
      },
      headers: authHeaders(),
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
// 3-state modal: list view (default) → create form → edit form. Builtin
// personas are read-only (name + avatar locked, the rest editable).
//
// The actual UI lives in ./views/persona-modal.tsx (Preact JSX). The
// openPersonaModal wrapper preserves the original call sites (header
// button, sidebar search button, etc.) — it drives the personaStore
// which the mounted component subscribes to. closePersonaModal lives
// inside PersonaModal's × button + personaStore.close(), so no main.ts
// wrapper is needed.

function openPersonaModal(): void {
  personaStore.setOpen(true);
}

// ── Search Modal ──────────────────────────────────────────────────────────────
//
// The actual UI lives in ./views/search-modal.tsx (Preact JSX). These two
// wrappers preserve the original openSearchModal/closeSearchModal call sites
// (sidebar button, Ctrl+K, tray menu, result-click, Escape) — they just
// drive the searchModalStore which the mounted component subscribes to.

function openSearchModal(): void {
  searchModalStore.setOpen(true);
}

function openSettings(): void {
  settingsStore.setOpen(true);
}

function closeSearchModal(): void {
  searchModalStore.setOpen(false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// escapeHtml + sanitizeSnippet moved to ./views/search-modal.tsx (alpha-7
// search modal view). They were only used by the search UI.

window.addEventListener('DOMContentLoaded', async () => {
  // v0.2-alpha-6 — Mount the sonner <Toaster /> before any showToast call.
  // Read theme from <html class="dark"> which the inline IIFE in index.html
  // already populated before main.ts runs.
  mountAppToaster();

  // v0.2-alpha-3 — Resolve WSL2 gateway IP dynamically via ./lib/state.
  // resolveGatewayUrl handles the fallback internally.
  const resolvedUrl = await resolveGatewayUrl();
  console.log('[Hermes] Gateway resolved:', resolvedUrl);

  // Load saved API key and port from config
  try {
    const config: Record<string, any> = await invoke('hermes_get_config');
    if (config.api_key) {
      setApiKey(config.api_key);
    }
    if (config.port) {
      applyPortOverride(config.port);
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
  //
  // Settings modal migrated to src/views/settings-modal.tsx in alpha-11.
  // Form fields, load/save handlers, theme segmented control, and the
  // new "Gateway 连接" group (remote IP support) all live there now.
  // Sidebar settings button + tray menu entry both call openSettings()
  // below; close/cancel/×/overlay-click + Save/Cancel buttons are handled
  // by the Preact component.

  const settingsBtn = document.getElementById('settings-btn')!;
  settingsBtn.addEventListener('click', () => openSettings());

  mountSettingsModal({
    onDefaultsChanged: ({ defaultProjectPath: proj, defaultModel: model }) => {
      // Refresh module-level lets used by sendMessage + model picker.
      defaultProjectPath = proj;
      defaultModel = model;
    },
  });

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

  // v0.2-alpha-7 — Search modal: Preact component mounted once into the
  // #search-modal overlay root. The component owns its input/results/
  // debounce/result-click logic; main.ts only wires external triggers
  // (sidebar button / Ctrl+K / tray menu / Escape) via openSearchModal +
  // closeSearchModal, which drive the searchModalStore the component
  // subscribes to.
  mountSearchModal({
    onSelect: async (sessionId) => {
      if (!sidebarVisible) toggleSidebar(true);
      await selectSession(sessionId);
    },
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

  // Manage button (next to picker) → open the persona library modal.
  // × button click + overlay-click-to-close are owned by the PersonaModal
  // component itself (alpha-8); mountPersonaModal below wires the store
  // subscription that toggles the overlay's .hidden class.
  document.getElementById('persona-manage-btn')?.addEventListener('click', () => openPersonaModal());
  mountPersonaModal({
    onPersonasChanged: () => {
      // Refresh the header persona picker + personasCache so session creation
      // picks up the new persona without a restart.
      void loadPersonas().then(() => renderPersonaPicker());
    },
  });

  // ── T-Q-S8: default project path init ────────────────────
  // Restore the user's saved project path so new sessions auto-attach
  // the project context. If the saved path no longer exists, the scan
  // will fail at createSession time and the user will see a toast.
  defaultProjectPath = await loadDefaultProjectPath();

  // ── T-Q-S12-light: default model init ────────────────────
  defaultModel = await loadDefaultModel();

  // ── T-Q-S9: stats modal wiring ───────────────────
  document.getElementById('sidebar-stats-btn')?.addEventListener('click', () => openStatsModal());
  mountStatsModal();

// Sidebar stats button → opens the Preact-rendered stats modal.
function openStatsModal(): void {
  statsStore.setOpen(true);
}

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
  document.getElementById('sidebar-backup-btn')?.addEventListener('click', () => openBackupModal());
  mountBackupModal();

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

// showToast + ToastType moved to ./lib/toast (sonner wrapper) —
// see top-of-file imports. Toaster mounted via mountAppToaster() at
// DOMContentLoaded below.

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
    errorDiv.innerHTML = `<div class="message-content">❌ 连接失败: ${errorMsg}<br><small>请确保 Hermes Gateway 正在运行 (${getGatewayUrl()})</small></div>`;
    messagesContainer?.appendChild(errorDiv);
    scrollToBottom();
    updateSendButton();
  }
}

async function checkConnection() {
  updateConnectionStatus('connecting');
  // Show the resolved URL in status
  if (statusText) {
    statusText.textContent = `连接中... (${getGatewayUrl()})`;
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
