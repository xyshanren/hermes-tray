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
// v0.2-alpha-17: formatTokens moved to sessions-list-view.tsx — it
// formats the per-session token badge that the Preact view now owns.

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
import type { Session } from './types';
import {
  getGatewayUrl,
  setApiKey,
  resolveGatewayUrl,
  applyPortOverride,
} from './lib/state';
import {
  copySessionAsMarkdown,
  copySessionShareLink,
  validateShareHash,
  clearShareHash,
} from './views/share-flow';
import { shareStore } from './views/share-modal-store';
import { mountShareImportModal } from './views/share-modal-mount';
// v0.2-alpha-17 — Sessions list + sidebar visibility moved to Preact
// + pub-sub stores. main.ts keeps the data-fetching callbacks (select /
// delete / rename / load-more / export) + the sidebar header button
// click handlers; the view owns the per-row rendering + inline rename
// editor + pagination + active highlight.
import { mountSessionList, sessionListStore, PAGE_SIZE } from './views/sessions-list-mount';
import { sidebarStore, mountSidebar } from './views/sidebar-mount';
// v0.2-alpha-16 — Chat view split into a Preact component backed by a
// pub-sub store. main.ts keeps the input form + SSE pipeline but
// delegates message-bubble rendering, streaming bubble updates, and
// the welcome screen to <ChatViewWithWelcome />.
import { chatStore, chatWelcomeStore, mountChatView } from './views/chat-view-mount';
import type { ChatMessage as Message, PendingAttachment, ChatMessageBar } from './views/chat-view-store';
// Re-export the chat formatters from main.ts so the existing
// src/messageBar.test.ts + src/routingTrace.test.ts suites (which
// import from './main') keep working without churn. The test files
// themselves were not migrated — the new helpers live in
// src/lib/chat-formatters.ts but main.ts remains the public face.
// We also import buildMessageBar for use in the streaming finalization
// path (referenced via `void buildMessageBar` to keep the symbol alive
// for any future imperative caller — the Preact view now renders the
// CLI bar from the ChatMessageBar data directly).
export { formatMessageBar, formatRoutingTrace, formatLatencyMs } from './lib/chat-formatters';
import { buildMessageBar } from './lib/chat-formatters';

const UNKNOWN_MODEL = '-';

// ── Session / FTS5 types ──────────────────────────────────────────────────────
//
// v0.2-alpha-17: Session / DbMessage / ProjectContext are imported from
// src/types.ts (alpha-1 extraction + alpha-8 schema sync). The local
// `interface Session` that lived here since v0.1.5 was redundant.

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
// v0.2-alpha-17: sidebarVisible moved to src/views/sidebar-store.ts.
// main.ts reads it via sidebarStore.get() when it needs to make a
// decision (e.g. Ctrl+K wants to surface the sidebar so the search
// results are visible).

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
//
// v0.2-alpha-16: `Message` / `PendingAttachment` / `ChatMessageBar` now
// live in src/views/chat-view-store.ts (imported at the top of this
// file). The old `ChatState` interface is gone — the messages array
// moved into chatStore (the pub-sub store owned by chat-view-store.ts)
// and the streaming chunk / DOM element refs are now internal to the
// Preact view. `state` below only keeps the fields main.ts owns:
//   - connectionStatus / currentModel: gateway-side state
//   - isLoading: drives the send-button label + disabled state
//   - isStreaming: shadowed by chatStore.streaming; kept here for the
//     legacy handleSubmit guard. Will move into the store in alpha-17.

const CONFIG = {
  defaultModel: 'hermes-agent',
  maxTokens: 4096,
  temperature: 0.7,
  maxInputLength: 4000,
};

interface MainState {
  messages: Message[];
  isLoading: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  currentModel: string;
  isStreaming: boolean;
}

const state: MainState = {
  messages: [],
  isLoading: false,
  connectionStatus: 'disconnected',
  currentModel: UNKNOWN_MODEL,
  isStreaming: false,
};

let messageInput: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let connectionStatusEl: HTMLElement | null = null;
let statusText: HTMLElement | null = null;
let modelName: HTMLElement | null = null;
let charCount: HTMLElement | null = null;
let chatForm: HTMLFormElement | null = null;

// S14-agent: per-stream metadata captured from the final SSE chunk.
// The agent pushes real prompt/completion/image token counts plus a
// routing_decision + elapsed_ms blob; finishStream() persists these
// via message_record_usage. These moved off the global `state` object
// because they only exist for the lifetime of one stream — module-level
// lets make that scope explicit and reset cleanly between turns.
let lastStreamUsage: Record<string, unknown> | null = null;
let lastStreamRouting: unknown = null;
let lastStreamElapsedMs: number | null = null;

let unlistenChunk: (() => void) | null = null;
let unlistenDone: (() => void) | null = null;

// ── Session Management ────────────────────────────────────────────────────────
//
// v0.2-alpha-17: the session list + pagination state moved into
// src/views/sessions-list-store.ts (PAGE_SIZE constant + store
// mutators). The actual `session_list` Tauri invoke still happens here
// in main.ts — we just call store.setFirstPage / store.appendMorePage
// with the fetched rows.

// ── Session export + share (T-Q-S10) ───────────────────────────────────────────
//
// Outbound + inbound share logic lives in src/views/share-flow.ts (alpha-15).
// main.ts only wires the share-link-btn click + the boot-time URL hash
// check. The import confirmation is a Preact modal mounted into
// <div id="share-import-modal">.

/**
 * v0.2-alpha-17: refresh just the sidebar row for the current session.
 * Used after each message send so the token badge stays live (T-Q-S9).
 *
 * Old version mutated a row DOM element directly. Now we just push the
 * fresh row into sessionListStore.patchSession — the Preact view
 * subscriber picks it up and re-renders the row. Falls back to a full
 * list reload if the session was deleted out from under us.
 */
async function refreshCurrentSessionRow(): Promise<void> {
  if (!currentSessionId) return;
  try {
    const fresh = await invoke<Session>('session_get', { id: currentSessionId });
    currentSession = fresh;
    sessionListStore.patchSession(fresh.id, fresh);
  } catch (e) {
    console.warn('[Session] refresh failed, falling back to full list:', e);
    await loadSessionList();
  }
}

/**
 * v0.2-alpha-17: load a page of sessions from the Tauri backend and
 * push it into sessionListStore. The Preact <SessionList> component
 * subscribes to the store and re-renders automatically.
 *
 * `reset = true` → first page (offset 0); `reset = false` → next page
 * (offset advanced by PAGE_SIZE). The offset is recomputed here from
 * the current store size rather than tracked as a module-level let —
 * the store is the source of truth for what we've loaded.
 */
async function loadSessionList(reset = true): Promise<void> {
  try {
    const offset = reset ? 0 : sessionListStore.get().sessions.length;
    const sessions = await invoke<Session[]>('session_list', {
      limit: PAGE_SIZE,
      offset,
    });
    if (reset) {
      sessionListStore.setFirstPage(sessions);
    } else {
      sessionListStore.appendMorePage(sessions);
    }
  } catch (e) {
    console.error('[Session] load error:', e);
    if (reset) sessionListStore.setFirstPage([]);
  }
}

/**
 * Callback passed to the SessionList view. Invokes session_update and
 * patches the store row on success. The view's <RenameEditor /> stays
 * open if the Promise rejects so the user can retry.
 */
async function handleSessionRename(id: string, newTitle: string): Promise<void> {
  try {
    const updated = await invoke<Session>('session_update', {
      id,
      patch: { title: newTitle },
    });
    sessionListStore.patchSession(id, updated);
    sessionListStore.cancelRename();
    if (id === currentSessionId) currentSession = updated;
  } catch (e) {
    showToast('重命名失败', String(e), 'error');
    throw e; // surface to RenameEditor so it can re-enable input
  }
}

/**
 * Callback passed to the SessionList view. Invokes session_delete and
 * removes the row on success. Confirmation prompt is handled here so
 * the view stays a pure renderer (alpha-15 share-import precedent:
 * don't move native confirm() into the Preact view in alpha-17 — a
 * proper confirmation modal is alpha-18+ work).
 */
async function handleSessionDelete(id: string): Promise<void> {
  if (!confirm('确定删除此会话？')) return;
  try {
    await invoke('session_delete', { id });
    sessionListStore.removeSession(id);
    if (currentSessionId === id) {
      currentSessionId = null;
      currentSession = null;
      state.messages = [];
      chatWelcomeStore.setContext(null);
      chatStore.setMessages([]);
    }
    showToast('会话已删除', '', 'success');
  } catch (e) {
    showToast('删除失败', String(e), 'error');
  }
}

/**
 * Callback passed to the SessionList view. Invokes the load-more
 * fetch (offset = current store length) and appends the page.
 */
async function handleSessionLoadMore(): Promise<void> {
  if (sessionListStore.get().isLoading) return;
  sessionListStore.setLoading(true);
  await loadSessionList(false);
}

// Exposed for potential external use


async function selectSession(id: string): Promise<void> {
  currentSessionId = id;
  // v0.2-alpha-17: the Preact <SessionList> view reads activeId from
  // sessionListStore and applies the .active class automatically.
  sessionListStore.setActiveId(id);
  // T-Q-S8: track the full session row so we can compose system prompts
  // at send-message time without an extra DB round-trip.
  try {
    currentSession = await invoke<Session>('session_get', { id });
  } catch (e) {
    console.warn('[Session] failed to load row for system-prompt compose:', e);
    currentSession = null;
  }
  // v0.2-alpha-16: hand the loaded history to chatStore; the Preact
  // <ChatViewWithWelcome /> subscription picks it up and renders the
  // bubbles. We also clear any stale welcome context — selecting an
  // existing session shouldn't show the "新会话已开始" hints.
  chatWelcomeStore.setContext(null);
  try {
    const msgs = await invoke<DbMessage[]>('message_list', { sessionId: id, limit: 100, offset: 0 });
    state.messages = msgs.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at)
    }));
    chatStore.setMessages(state.messages);
    await invoke('session_touch', { id });
  } catch (e) {
    console.error('[Session] select error:', e);
    // Surface the load failure via the store's error channel; the
    // Preact view renders a red error bubble in place of the welcome.
    chatStore.setError('加载会话失败');
    chatStore.setMessages([]);
  }
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
    // v0.2-alpha-16: drive the welcome bubble via the store instead of
    // building innerHTML inline. The persona + project context are
    // pushed into chatWelcomeStore; <ChatViewWithWelcome /> picks them
    // up and renders the equivalent welcome. We compute the project
    // hint shape here so all string assembly happens in main.ts (the
    // Preact view is pure render).
    const persona = personasCache.find(p => p.id === currentPersonaId);
    const proj = parseProjectContext(session.project_context);
    chatWelcomeStore.setContext({
      headline: '👋 新会话已开始',
      persona: persona
        ? { avatar: persona.avatar ?? '', name: persona.name }
        : null,
      project: proj
        ? {
            name: proj.name,
            version: proj.version ?? undefined,
            path: proj.project_dir,
          }
        : (projectDir ? { name: '', path: projectDir, scanFailed: true } : null),
    });
    chatStore.setMessages([]);
    // v0.2-alpha-17: prepend the new session to the sidebar list and
    // mark it active. The Preact view re-renders with the new row at
    // the top + the .active class applied automatically.
    sessionListStore.setFirstPage([session, ...sessionListStore.get().sessions]);
    sessionListStore.setActiveId(session.id);
    return session.id;
  } catch (e) {
    showToast('创建会话失败', String(e), 'error');
    return null;
  }
}

// v0.2-alpha-17: deleteSession was the old imperative version. The
// SessionList view now calls handleSessionDelete (defined above) which
// invokes session_delete + sessionListStore.removeSession. We keep no
// top-level deleteSession — call sites go through the view callback.

// v0.2-alpha-17: toggleSidebar / sidebarVisible moved to sidebarStore.
// The `<aside id="sidebar">` .hidden class + #sidebar-show-btn display
// are wired to the store via mountSidebar() (sidebar-mount.tsx).
// Callers that want to make a decision (Ctrl+K search handler, tray
// quick capture) read sidebarStore.get() instead of a module-level let.
// Top-level toggleSidebar wrapper removed — all call sites use
// sidebarStore.setVisible(true|false) directly.

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
      // v0.2-alpha-16: PendingAttachment now carries a stable `id` so
      // the Preact <AttachmentStrip /> uses it as a key without having
      // to derive one from the data URL. crypto.randomUUID() is
      // available in the WebView (Tauri 2 uses Edge WebView2 on
      // Windows + WebKitGTK on Linux) — fallback to a timestamp+counter
      // combo for paranoia.
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `att-${crypto.randomUUID()}`
        : `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      resolve({
        id,
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

  // v0.2-alpha-16: the messages container is owned by <ChatViewWithWelcome />
  // (mounted via mountChatView() below). We no longer query it here.
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
  sidebarToggleBtn?.addEventListener('click', () => sidebarStore.setVisible(false));
  sidebarShowBtn?.addEventListener('click', () => sidebarStore.setVisible(true));

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
      // v0.2-alpha-17: read visibility from sidebarStore so the search
      // result click surfaces the sidebar (lets the user see the
      // selected session highlight in the list).
      if (!sidebarStore.get()) sidebarStore.setVisible(true);
      await selectSession(sessionId);
    },
  });

  // v0.2-alpha-17: mount the sidebar visibility wiring (DOM toggle)
  // + the SessionList Preact view BEFORE the first loadSessionList so
  // the store-driven re-render has a target. The Preact view receives
  // an initial empty personas array; we re-mount it once personas
  // load (line ~1195 below) so the avatar prefix shows up.
  mountSidebar();
  mountSessionList({
    personas: personasCache,
    onSelect: selectSession,
    onDelete: handleSessionDelete,
    onRename: handleSessionRename,
    onLoadMore: handleSessionLoadMore,
    onExport: (id) => void copySessionAsMarkdown(invoke, showToast, id),
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
  // v0.2-alpha-17: re-mount the SessionList view with the loaded
  // personas so each row's avatar prefix renders correctly. Preact's
  // render() is idempotent on the same container — this replaces the
  // previous tree cleanly (useEffect cleanup runs on the old one).
  mountSessionList({
    personas: personasCache,
    onSelect: selectSession,
    onDelete: handleSessionDelete,
    onRename: handleSessionRename,
    onLoadMore: handleSessionLoadMore,
    onExport: (id) => void copySessionAsMarkdown(invoke, showToast, id),
  });
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
      // picks up the new persona without a restart. v0.2-alpha-17 also
      // re-mounts the SessionList so the per-row avatar prefix updates.
      void loadPersonas().then(() => {
        renderPersonaPicker();
        mountSessionList({
          personas: personasCache,
          onSelect: selectSession,
          onDelete: handleSessionDelete,
          onRename: handleSessionRename,
          onLoadMore: handleSessionLoadMore,
          onExport: (id) => void copySessionAsMarkdown(invoke, showToast, id),
        });
      });
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
  // import confirmation modal (alpha-15 — replaces v0.1.5's native
  // window.confirm() with a proper Preact modal).
  document.getElementById('share-link-btn')?.addEventListener('click', () => {
    if (currentSessionId) {
      void copySessionShareLink(invoke, showToast, currentSessionId);
    } else {
      showToast('没有当前会话', '请先创建或选择一个会话', 'info');
    }
  });
  // Check URL hash on startup for a pending share import.
  const hashResult = validateShareHash(window.location.hash);
  if (hashResult.ok) {
    shareStore.setPending(hashResult.doc);
  } else if (hashResult.reason === "unsupported-version") {
    // alpha-13 fix: clear stale hash BEFORE returning so the link
    // doesn't re-trigger this error toast on every reload.
    clearShareHash();
    showToast(
      "分享链接版本不支持",
      `version=${hashResult.version ?? "?"}`,
      "error",
    );
  } else if (hashResult.reason === "decode-failed") {
    // Stale or malformed #share= fragment. Clear so we don't retry.
    clearShareHash();
    showToast("分享链接解析失败", "URL 片段格式错误或已损坏", "error");
  }
  // no-match: silently ignore (the URL had no #share= fragment).
  mountShareImportModal();

  // ── T-Q-S11: backup modal wiring ──────────────────────────
  document.getElementById('sidebar-backup-btn')?.addEventListener('click', () => openBackupModal());
  mountBackupModal();

  // v0.2-alpha-16: mount the chat view Preact component. This replaces
  // the v0.1.5 innerHTML-based message rendering inside <div id="messages">.
  // Must run after the modal mounts above so chatStore / chatWelcomeStore
  // subscribers are already wired (we share the store imports).
  mountChatView();

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
      if (sidebarStore.get()) sidebarStore.setVisible(false);
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

  // v0.2-alpha-16: push the user message into the chat store. The
  // Preact <ChatViewWithWelcome /> subscription re-renders the new
  // bubble. We also keep state.messages in sync (main.ts reads from
  // it during the SSE submit pipeline) — chatStore.setMessages below
  // would replace, but appendMessage preserves prior history.
  chatStore.appendMessage({
    role: 'user',
    content,
    timestamp: new Date(),
    attachments: attachmentsAtSend.length > 0 ? attachmentsAtSend : undefined,
  });
  state.messages = chatStore.get().messages;
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

// v0.2-alpha-16: addMessage / renderMessage / createStreamMessage /
// scrollToBottom / formatMessage moved into src/views/chat-view.tsx
// and src/lib/chat-formatters.ts. The local DOM-rendering helpers are
// gone — main.ts only mutates the store now and the Preact view owns
// the bubble rendering + auto-scroll.

/**
 * S14-agent: turn the routing_decision JSON blob into a one-line trace
 * for the stats modal. The agent pushes a structured dict like:
 *   { mode: "native" | "text", primary_provider, primary_model,
 *     resolved_provider, resolved_model, fallback_used, fallback_reason,
 *     fallback_provider, fallback_model }
 * We render the bits the user cares about and ignore unknown fields so
 * future agent-side additions don't break the UI.
 *
 * v0.2-alpha-16: this function moved to src/lib/chat-formatters.ts and
 * is re-exported from main.ts above for backward compatibility with
 * src/routingTrace.test.ts (which imports from "./main").
 */

/**
 * v0.2-alpha-16: handleStreamChunk rewritten to delegate DOM updates to
 * the chat store. The Preact <ChatViewWithWelcome /> subscriber picks
 * up `appendStreamChunk` calls and re-renders the streaming bubble.
 *
 * Per-stream metadata (usage / routing / elapsed_ms) stays on
 * module-level `let` variables so finishStream() can read them when
 * the agent emits `hermes-stream-done`.
 */
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
        // Append to the streaming bubble via the store; the Preact
        // view re-renders automatically. We do NOT mutate a DOM
        // element directly anymore — that path is gone in alpha-16.
        chatStore.appendStreamChunk(delta);
      }
      // S14-agent: capture the final-chunk usage + routing metadata so
      // finishStream() can persist the real token count (replacing the
      // char/4 heuristic) and surface the routing decision in the
      // stats modal. We hold the *latest* value seen — OpenAI streaming
      // sends usage exactly once at the end, but a few proxies repeat it
      // across chunks and we want the most recent.
      const usage = json.usage;
      if (usage && typeof usage === 'object') {
        lastStreamUsage = usage;
        const rd = (usage as Record<string, unknown>).routing_decision;
        if (rd) lastStreamRouting = rd;
        const el = (usage as Record<string, unknown>).elapsed_ms;
        if (typeof el === 'number') lastStreamElapsedMs = el;
      }
      // Some agent shapes emit routing_decision at the top level of the
      // final chunk (not nested under usage). Cover that case too.
      const topRd = (json as Record<string, unknown>).routing_decision;
      if (topRd) lastStreamRouting = topRd;
      const topEl = (json as Record<string, unknown>).elapsed_ms;
      if (typeof topEl === 'number') lastStreamElapsedMs = topEl;
    } catch { /* skip invalid JSON */ }
  }
}

async function finishStream() {
  // v0.2-alpha-16: read the streaming bubble content from the store
  // (it's authoritative — chunks went through chatStore.appendStreamChunk).
  // We still own the DB persistence + S14 usage tracking here in
  // main.ts because those side-effects don't belong in a view file.
  const streamingSnapshot = chatStore.get().streaming;
  if (streamingSnapshot) {
    const finalContent = streamingSnapshot.content;
    // Compute the CLI bar metadata BEFORE we reset the per-stream
    // module-level lets below — the S14 final-chunk values are the
    // source of truth for the bar.
    const usage = lastStreamUsage;
    const costUsd = (usage && typeof usage.cost_estimate_usd === 'number')
      ? usage.cost_estimate_usd : 0;
    const routingObj = (lastStreamRouting ?? {}) as Record<string, unknown>;
    const costThresholdExceeded = routingObj.cost_threshold_exceeded === true;
    const ruleId = typeof routingObj.rule_id === 'string' ? routingObj.rule_id : null;
    const bar: ChatMessageBar = {
      costUsd,
      elapsedMs: lastStreamElapsedMs,
      ruleId,
      costThresholdExceeded,
    };
    // Hand the finalised bubble + bar to the Preact view. The store
    // clears its own streaming slot as part of finaliseStream().
    chatStore.finaliseStream(bar);
    state.messages = chatStore.get().messages;

    // Persist assistant message to DB
    if (currentSessionId) {
      // message_append returns the persisted Message (with the new id).
      // We need that id to call message_record_usage in the S14 path.
      try {
        const appended = await invoke<{ id: string; tokens: number }>('message_append', {
          sessionId: currentSessionId,
          role: 'assistant',
          content: finalContent,
          toolCalls: null,
        });
        // S14-agent: if the upstream pushed real usage, replace the
        // char/4 heuristic tokens + stash image_tokens / routing_decision
        // on the message metadata so the stats modal can show them.
        if (appended?.id && usage && typeof usage.prompt_tokens === 'number') {
          const detail = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
          const imageTokens = typeof detail.image_tokens === 'number'
            ? detail.image_tokens : 0;
          const routingJson = lastStreamRouting != null
            ? JSON.stringify(lastStreamRouting) : null;
          await invoke('message_record_usage', {
            id: appended.id,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens ?? 0,
            imageTokens,
            routingDecisionJson: routingJson,
            elapsedMs: lastStreamElapsedMs ?? null,
            costEstimateUsd: costUsd,
            costThresholdExceeded,
          });
          // The CLI bar itself is rendered by the Preact <AssistantBubble />
          // component from the `bar` prop we just attached to the
          // message in chatStore.finaliseStream — we no longer append
          // a DOM node imperatively. (buildMessageBar is unused on
          // this path; we keep the export alive for any future caller
          // that wants the imperative DOM form, e.g. tests.)
          void buildMessageBar;
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
  // S14: clear the per-stream metadata so the next turn starts fresh.
  lastStreamUsage = null;
  lastStreamRouting = null;
  lastStreamElapsedMs = null;
  updateSendButton();
}

async function sendMessage() {
  state.isLoading = true;
  updateSendButton();

  // v0.2-alpha-16: open the streaming bubble via the store. The Preact
  // <ChatViewWithWelcome /> subscriber picks up the change and renders
  // the empty streaming bubble; subsequent handleStreamChunk calls
  // accumulate content into it.
  state.isStreaming = true;
  chatStore.openStream();

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
    // v0.2-alpha-16: ChatMessage.role is 'user' | 'assistant' only
    // (system prompts are injected below via apiMessages, never as
    // history rows), so no role filter is needed here.
    const recent = state.messages.slice(-10);
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
    console.error('Send message error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    // v0.2-alpha-16: discard the half-written streaming bubble (the
    // store clears its slot) and surface the error through the store's
    // error channel — the Preact view renders a red error bubble.
    chatStore.abortStream();
    chatStore.setError(`连接失败: ${errorMsg} (${getGatewayUrl()})`);
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

// v0.2-alpha-16: scrollToBottom / messagesContainer moved into the
// Preact <ChatViewWithWelcome /> component. The view tracks its own
// scroll position via useEffect on each chatStore state change.
