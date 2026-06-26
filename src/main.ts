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
import { register } from '@tauri-apps/plugin-global-shortcut';
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
  description: string;
  system_prompt: string;
  avatar: string;
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
  content: string;
  timestamp: Date;
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  currentModel: string;
  isStreaming: boolean;
  streamContent: string;
  streamElement: HTMLElement | null;
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

async function createPersonaApi(name: string, description: string, system_prompt: string, avatar: string): Promise<Persona | null> {
  const id = `persona:${crypto.randomUUID()}`;
  const now = Date.now().toString();
  const persona: Persona = {
    id, name, description, system_prompt, avatar,
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
        <div class="stats-totals-label">预估成本</div>
        <div class="stats-totals-value">${formatCost(s.total_cost)}</div>
        <div class="stats-totals-sub">基于 ${s.by_model.length} 个模型</div>
      </div>
      <div class="stats-totals-cell">
        <div class="stats-totals-label">消息 / 会话</div>
        <div class="stats-totals-value">${s.total_messages}</div>
        <div class="stats-totals-sub">${s.total_sessions} 个会话</div>
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
  const desc = isEdit ? p!.description : '';
  const prompt = isEdit ? p!.system_prompt : '';
  const avatar = isEdit ? p!.avatar : '👤';
  // Builtin personas: name/avatar locked, description/prompt editable.
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
    if (!name) { showToast('请填写名称', '', 'error'); return; }
    if (!system_prompt) { showToast('请填写系统提示词', '', 'error'); return; }
    if (isEdit && p) {
      const updated = await updatePersonaApi({ ...p, name, description, system_prompt, avatar });
      if (updated) {
        await loadPersonas();
        renderPersonaPicker();
        personaModalMode = 'list';
        renderPersonaModal();
        showToast('已更新', updated.name, 'success');
      }
    } else {
      const created = await createPersonaApi(name, description, system_prompt, avatar);
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

  // Register global shortcut: Ctrl+Shift+H — show window + focus input
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await register('Ctrl+Shift+H', async () => {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
      messageInput?.focus();
      if (!sidebarVisible) toggleSidebar(true);
    });
    console.log('[GlobalShortcut] Ctrl+Shift+H registered');
  } catch (e) {
    console.warn('[GlobalShortcut] Failed to register:', e);
  }

  // Cleanup on unload
  window.addEventListener('unload', async () => {
    unlistenChunk?.();
    unlistenDone?.();
    try {
      const { unregister } = await import('@tauri-apps/plugin-global-shortcut');
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
  if (!content) return;
  messageInput.value = '';
  messageInput.dispatchEvent(new Event('input'));
  if (messageInput) messageInput.style.height = 'auto';

  // Ensure we have an active session
  if (!currentSessionId) {
    currentSessionId = await createSession();
    if (!currentSessionId) return;
  }

  addMessage('user', content);
  // Persist user message to DB
  if (currentSessionId) {
    invoke('message_append', {
      sessionId: currentSessionId,
      role: 'user',
      content,
      toolCalls: null,
    }).catch(e => console.error('[DB] save user msg failed:', e));
    invoke('session_touch', { id: currentSessionId }).catch(() => {});
    // T-Q-S9: refresh session list so the token badge in the sidebar
    // updates after each send. We only re-fetch the current row to
    // avoid a full list reload.
    void refreshCurrentSessionRow();
  }

  await sendMessage();
}

function addMessage(role: 'user' | 'assistant', content: string) {
  state.messages.push({ role, content, timestamp: new Date() });
  renderMessage({ role, content, timestamp: new Date() });
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
    } catch { /* skip invalid JSON */ }
  }
}

function finishStream() {
  if (state.streamContent) {
    state.messages.push({
      role: 'assistant',
      content: state.streamContent,
      timestamp: new Date(),
    });
      // Persist assistant message to DB
      if (currentSessionId) {
        invoke('message_append', {
          sessionId: currentSessionId,
          role: 'assistant',
          content: state.streamContent,
          toolCalls: null,
        }).catch(e => console.error('[DB] save assistant msg failed:', e));
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
    const userMessages = state.messages
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));
    const apiMessages = systemContent === null
      ? userMessages
      : [{ role: 'system' as const, content: systemContent }, ...userMessages];

    // Use streaming — response is empty, chunks via events
    const model = state.currentModel !== UNKNOWN_MODEL ? state.currentModel : CONFIG.defaultModel;
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
