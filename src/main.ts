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
// v0.2-alpha-19: listen / register / unregister / getCurrentWindow
// imports moved out of main.ts — chat-stream owns the SSE listeners,
// tray-menu owns the tray:// listeners, shortcuts owns the global
// shortcut registration.
import { composeSystemPrompt } from './systemPrompt';
// v0.2-alpha-17: formatTokens moved to sessions-list-view.tsx — it
// formats the per-session token badge that the Preact view now owns.

import { hermesGet, authHeaders } from './lib/api';
import { showToast } from './lib/toast';
// ToastType used to be imported here for the gateway-notification
// listener; that listener moved to src/lib/tray-menu.ts in alpha-19.
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
} from './lib/state';
// v0.2-alpha-19: setApiKey / resolveGatewayUrl / applyPortOverride
// moved to src/lib/boot.ts (applyBootConfig owns the gateway + api_key
// + port init flow).
import {
  copySessionAsMarkdown,
} from './views/share-flow';
// v0.2-alpha-19: copySessionShareLink + validateShareHash +
// clearShareHash moved into src/lib/share-ui.ts (the alpha-19 share-UI
// helper module owns the boot-time hash check + the header share-link
// button click). main.ts only passes deps to initShareUI().
// shareStore + mountShareImportModal also moved — share-ui.ts owns
// the full share-link flow.
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
// v0.2-alpha-18 — chat input form (textarea + send button + attach
// preview + drag/drop + mic) migrated to Preact. main.ts keeps:
//   - fileToAttachment (Tauri FileReader side-effect)
//   - addAttachments (orchestrates the limit-decision + store writes)
//   - startRecording / stopRecording / onRecordingComplete (MediaRecorder
//     + hermes_proxy_transcribe invoke)
//   - handleSubmit (the SSE submit pipeline: chatStore.appendMessage +
//     message_append + sendMessage)
//   - drag/drop listeners on the form (DragEvent.files doesn't go
//     through Preact cleanly)
//   - updateSendButton (gone — the Preact view owns the button state)
import { chatInputStore, mountChatInput, getChatInputHandle } from './views/chat-input-mount';
// v0.2-alpha-19: SSE pipeline + S14 usage extraction + multimodal
// content builder extracted from main.ts. main.ts only provides deps
// (current session / personas / model picks / system prompt composer)
// via initChatStream() — the actual hermesPostStream + listen +
// message_append + message_record_usage flow lives in chat-stream.ts.
import { initChatStream, sendChatMessage } from './lib/chat-stream';
import { mountSplashScreen } from './views/splash-mount';
import { splashStore } from './views/splash-store';
import {
  loadDefaultPersonaId,
  loadDefaultModel,
  loadDefaultProjectPath,
  setDefaultPersonaId,
} from './lib/db-config';
import { applyBootConfig } from './lib/boot';
import { registerQuickCaptureShortcut } from './lib/shortcuts';
import { registerTrayMenuListeners } from './lib/tray-menu';
import { initShareUI } from './lib/share-ui';
import { mountConfirmModal, requestConfirm } from './views/confirm-modal-mount';
import { mountShortcutsModal } from './views/shortcuts-modal-mount';
import { shortcutsModalStore } from './views/shortcuts-modal-store';
import type { ChatMessage as Message, PendingAttachment } from './views/chat-view-store';
// Re-export the chat formatters from main.ts so the existing
// src/messageBar.test.ts + src/routingTrace.test.ts suites (which
// import from './main') keep working without churn. The test files
// themselves were not migrated — the new helpers live in
// src/lib/chat-formatters.ts but main.ts remains the public face.
// v0.2-alpha-19: buildMessageBar import removed — the Preact view
// renders the CLI bar from the ChatMessageBar data directly (alpha-16).
export { formatMessageBar, formatRoutingTrace, formatLatencyMs } from './lib/chat-formatters';

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

// v0.2-alpha-18: messageInput / sendBtn / charCount DOM refs are
// gone — the Preact <ChatInput /> component owns the form. main.ts
// reads/writes the textarea via the imperative handle returned by
// mountChatInput() (getChatInputHandle() / chatInputStore). The
// `chatForm` ref below is just for the drag/drop listeners (DragEvent
// with file DataTransfer doesn't go through Preact cleanly, so we
// attach native listeners to the raw form element).
const chatForm: HTMLFormElement | null = document.getElementById('chat-form') as HTMLFormElement | null;
let connectionStatusEl: HTMLElement | null = null;
let statusText: HTMLElement | null = null;
let modelName: HTMLElement | null = null;

// S14-agent: per-stream metadata captured from the final SSE chunk
// moved to src/lib/chat-stream.ts in alpha-19. main.ts no longer
// holds per-stream state directly — chat-stream.ts owns its own
// module-level lets and exposes initChatStream() + sendChatMessage()
// + disposeChatStream().

// v0.2-alpha-19: unlistenChunk / unlistenDone moved to
// src/lib/chat-stream.ts. main.ts only holds the dispose handle for
// the chat-stream module + the gateway-notification listener (which
// stays in main.ts because it's a cross-cutting toast).

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
      // v0.2-alpha-20: tell the chat view whether the DB has any
      // sessions so it can pick between the first-run welcome card
      // (design 06) and the standard WelcomeBubble. Only update on
      // the first page load — append-more doesn't change the flag.
      chatStore.setHasSessions(sessions.length > 0);
    } else {
      sessionListStore.appendMorePage(sessions);
    }
  } catch (e) {
    console.error('[Session] load error:', e);
    if (reset) {
      sessionListStore.setFirstPage([]);
      // v0.2-alpha-20: a load failure shouldn't pretend to be empty
      // — keep the optimistic default (hasSessions=true) so the
      // user sees the standard welcome instead of a misleading
      // "first run" state.
    }
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
 * the view stays a pure renderer (alpha-15 share-import precedent).
 * v0.2-alpha-19: native window.confirm() replaced with the Preact
 * <ConfirmModal /> mounted via mountConfirmModal(). requestConfirm()
 * returns a Promise — true on confirm, false on Cancel / × / Escape /
 * overlay-click.
 */
async function handleSessionDelete(id: string): Promise<void> {
  const confirmed = await requestConfirm({
    title: "删除会话",
    message: "确定删除此会话？",
    danger: true,
    confirmLabel: "删除",
  });
  if (!confirmed) return;
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

// v0.2-alpha-19: loadDefaultPersonaId + setDefaultPersonaId +
// loadDefaultModel moved into src/lib/db-config.ts. The bare
// invoke() calls are wrapped with consistent error handling
// (console.warn) + the "empty string = null" convention for string
// preferences.
// alpha-11: setDefaultModel moved into views/settings-modal.tsx (which
// now writes db_config directly via invoke). main.ts keeps the module-
// level defaultModel let for sendMessage + model picker reads.

let defaultModel: string | null = null;

// T-Q-S14: image attachments waiting to be sent. Cleared on each send.
// v0.2-alpha-18: pendingAttachments moved to chatInputStore
// (src/views/chat-input-store.ts). main.ts reads/writes via the store
// so the Preact <AttachmentStrip /> subscribes and re-renders. The
// local `pendingAttachments` let is gone — every reference below
// (fileToAttachment callers / addAttachments / handleSubmit) now goes
// through chatInputStore.get().pendingAttachments + .addAttachment().

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
//
// v0.2-alpha-19: loadDefaultProjectPath moved into src/lib/db-config.ts.

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
  // v0.2-alpha-18: read + write via chatInputStore (Preact view
  // subscribes for the visual strip). No more renderAttachmentPreviews.
  const decision = evaluateAttachmentLimit(chatInputStore.get().pendingAttachments.length, list.length);
  if (decision.level === 'block') {
    showToast('太多附件', decision.message, 'error');
    return;
  }
  for (const f of list) {
    try {
      const att = await fileToAttachment(f);
      chatInputStore.addAttachment(att);
    } catch (e) {
      showToast('附件失败', String(e), 'error');
    }
  }
  if (decision.level === 'warn') {
    showToast('接近附件上限', decision.message, 'info');
  }
}

// v0.2-alpha-18: removeAttachment + renderAttachmentPreviews moved
// into the Preact <AttachmentStrip /> component. The × button on each
// thumb now calls chatInputStore.removeAttachment(idx) directly.

// v0.2-alpha-19: buildMultimodalContent moved to src/lib/multimodal.ts.
// Re-imported at the top of this file. The 9 multimodal.test.ts cases
// already import from "./lib/multimodal" (updated in alpha-19).

// ── Voice input (T-Q-S13) ───────────────────────────────────────────────────────
//
// Web Audio API + MediaRecorder. Records from the default mic, then
// hands the audio bytes to the Rust `hermes_proxy_transcribe` Tauri
// command which uploads them to hermes-agent's
// /v1/audio/transcriptions endpoint (OpenAI Whisper-compatible).
// We never see the STT model — hermes-agent does the recognition.

const VOICE_MAX_MS = 60_000; // 1 min cap to keep uploads sane

async function startRecording(): Promise<void> {
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
    // v0.2-alpha-18: the .recording class is now driven by
    // chatInputStore.isRecording — the Preact view subscribes and
    // re-renders the mic button. We just toggle the store.
    chatInputStore.setRecording(true);
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
  // v0.2-alpha-18: clear the .recording class via the store; the
  // Preact mic button subscriber drops the class automatically.
  chatInputStore.setRecording(false);
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
    // v0.2-alpha-18: append the transcript via the imperative
    // handle. It both writes the DOM value AND dispatches an input
    // event so the Preact <ChatInput /> state stays in sync (the
    // view's controlled input relies on onInput firing to pick up
    // external mutations).
    const handle = getChatInputHandle();
    if (handle) handle.appendText(text);
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

  // v0.2-alpha-19 — Mount the splash screen (design 17) FIRST so
  // it's visible while the rest of the boot is in flight. The
  // <div id="splash"> shell is shown by default in index.html and
  // fades out + unmounts once splashStore.hide() fires at the end
  // of this handler.
  mountSplashScreen();

  // v0.2-alpha-19: gateway URL + API key + port override extracted
  // into src/lib/boot.ts. applyBootConfig() resolves the WSL gateway
  // (or falls back to the default), then applies any saved api_key
  // + port from the legacy hermes_get_config command.
  await applyBootConfig();
  splashStore.setProgress(30);

  // v0.2-alpha-16: the messages container is owned by <ChatViewWithWelcome />
  // (mounted via mountChatView() below). We no longer query it here.
  // v0.2-alpha-18: textarea / send button / char count DOM refs are
  // also gone — the Preact <ChatInput /> component owns them.
  // We still keep a ref to <form id="chat-form"> for the drag/drop
  // listeners (DragEvent.files doesn't go through Preact cleanly).
  connectionStatusEl = document.getElementById('connection-status');
  statusText = document.getElementById('status-text');
  modelName = document.getElementById('model-name');

  // v0.2-alpha-18: mount the Preact <ChatInput /> component into the
  // existing <form id="chat-form"> shell. The view owns the textarea
  // (controlled state), send button (disabled when isLoading + length
  // over cap), mic button (pulse red when isRecording), attach button
  // (triggers the hidden <input type="file">), and attachment preview
  // strip. main.ts provides callbacks for the three external actions
  // it owns: onSubmit (the SSE pipeline), onAttach (fileToAttachment +
  // store writes), onMicToggle (startRecording / stopRecording).
  mountChatInput({
    isLoading: state.isLoading,
    onSubmit: handleSubmit,
    onAttach: (files) => void addAttachments(files),
    onMicToggle: () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      } else {
        void startRecording();
      }
    },
  });

  // T-Q-S14: drag/drop handlers. We listen on the form (not the
  // textarea) so a drop anywhere in the input area works. The
  // `dragCounter` pattern handles nested dragenter/dragleave events
  // fired when the cursor crosses internal element boundaries —
  // .dragging stays on until the drag actually leaves the form.
  // preventDefault on dragenter/over is required to enable the drop
  // event. We toggle a CSS class for a visual highlight.
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

  // v0.2-alpha-19: SSE stream listeners (hermes-stream-chunk /
// hermes-stream-done) are wired by initChatStream() in
// src/lib/chat-stream.ts. The dispose handle is captured below for
// window unload cleanup.

  // v0.2-alpha-19: tray menu listeners + gateway-notification
// listener moved to src/lib/tray-menu.ts. We capture the dispose
// handle for the window unload cleanup.
  const disposeTrayMenuHandle = await registerTrayMenuListeners({
    createSession,
    loadLastSession,
    openSearchModal,
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

  // Ctrl+K = search; Ctrl+/ = shortcuts modal (v0.2-alpha-19).
  // Escape closes the search modal — the shortcuts modal closes
  // itself via its own keydown listener (which we mount below).
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearchModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      shortcutsModalStore.toggle();
      return;
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
  splashStore.setProgress(50);

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
  // v0.2-alpha-19: the share-link button click + boot-time hash check
  // moved to src/lib/share-ui.ts. We pass in the current session id
  // getter so the button can decide whether to copy or show a hint.
  initShareUI({
    getCurrentSessionId: () => currentSessionId,
  });

  // ── T-Q-S11: backup modal wiring ──────────────────────────
  document.getElementById('sidebar-backup-btn')?.addEventListener('click', () => openBackupModal());
  mountBackupModal();

  // v0.2-alpha-16: mount the chat view Preact component. This replaces
  // the v0.1.5 innerHTML-based message rendering inside <div id="messages">.
  // Must run after the modal mounts above so chatStore / chatWelcomeStore
  // subscribers are already wired (we share the store imports).
  //
  // v0.2-alpha-20: thread the empty-state action callbacks (CTA +
  // retry + open settings + gateway hint). The first-run welcome
  // card (design 06) and the no-network error card (design 07) both
  // surface these buttons.
  mountChatView({
    onCreateSession: () => void createSession(),
    onRetryConnection: () => void checkConnection(),
    onOpenSettings: () => openSettings(),
    gatewayHint: `当前 Gateway: ${getGatewayUrl()}`,
  });

  // v0.2-alpha-19: chat view mounted + initial state fetched. Mark
  // the boot as complete and fade the splash out. The store snaps
  // progress to 100 + sets visible=false; the Preact view returns
  // null on the next render, removing the overlay from the DOM.
  splashStore.setProgress(100);
  splashStore.hide();

  // v0.2-alpha-19: register the Ctrl+Shift+H global shortcut via
  // src/lib/shortcuts.ts. We pass in the imperative callbacks
  // (createSession + chat input handle + sidebar store) so the
  // module has no direct import on main.ts.
  const disposeShortcutHandle = await registerQuickCaptureShortcut({
    createSession,
    clearAndFocusInput: () => {
      // The imperative handle dispatches an input event so the
      // Preact view picks up the cleared value (alpha-18 pattern).
      const handle = getChatInputHandle();
      handle?.clearText();
      // Focus even when createSession returned null — the user
      // wanted to use the input, give them the input.
      handle?.focus();
    },
    hideSidebar: () => sidebarStore.setVisible(false),
  });

  // v0.2-alpha-19: wire the SSE pipeline module. We pass in deps so
  // the module never needs to import main.ts's module-level lets.
  // The dispose handle is captured below for the unload cleanup.
  const disposeChatStreamHandle = await initChatStream({
    getCurrentSessionId: () => currentSessionId,
    getCurrentSession: () => currentSession,
    getRecentMessages: () => state.messages,
    getPersonasCache: () => personasCache,
    getCurrentModel: () => state.currentModel,
    getDefaultModel: () => defaultModel,
    getDefaultPersonaId: () => currentPersonaId,
    setIsLoading: (b) => { state.isLoading = b; },
    setIsStreaming: (b) => { state.isStreaming = b; },
    setMessages: (m) => { state.messages = m; },
    onAfterReply: () => { void refreshCurrentSessionRow(); },
    buildSystemPrompt: () => buildCurrentSystemPrompt(),
  });

  // v0.2-alpha-19: mount the confirm modal — replaces the last
  // window.confirm() call site in handleSessionDelete (sidebar's ×
  // button). Generic enough to serve future confirmation flows.
  mountConfirmModal();

  // v0.2-alpha-19: mount the shortcuts modal (design 16). Triggered
  // by Ctrl+/ — see the global keydown listener above.
  mountShortcutsModal();

  // Cleanup on unload
  window.addEventListener('unload', async () => {
    try { await disposeChatStreamHandle(); } catch { /* ignore */ }
    try { await disposeShortcutHandle(); } catch { /* ignore */ }
    try { await disposeTrayMenuHandle(); } catch { /* ignore */ }
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

// v0.2-alpha-18: handleInput / handleKeydown moved into the Preact
// <ChatInput /> component. The textarea is now controlled by the
// view's local state; char count + auto-resize + Enter-to-submit all
// happen in JSX. main.ts no longer needs to listen on the form or
// textarea directly — handleSubmit (below) is invoked by the view's
// <form onSubmit> handler via the onSubmit callback prop.

async function handleSubmit(content: string, attachmentsAtSend: PendingAttachment[]) {
  // T-Q-S14: allow send if attachments are present even when text is empty.
  if (!content && attachmentsAtSend.length === 0) return;
  // Clear the form immediately so the user can keep typing while
  // the SSE pipeline spins up. The Preact view's controlled input
  // resets via chatInputHandle.clearText(); pendingAttachments goes
  // through chatInputStore.clearAttachments().
  const handle = getChatInputHandle();
  if (handle) handle.clearText();
  chatInputStore.clearAttachments();

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

  await sendChatMessage();
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

// v0.2-alpha-19: handleStreamChunk + finishStream + sendMessage +
// per-stream module-level lets (lastStreamUsage / lastStreamRouting /
// lastStreamElapsedMs) all moved to src/lib/chat-stream.ts. main.ts
// only:
//   - imports initChatStream + sendChatMessage + disposeChatStream
//   - provides deps via initChatStream({...}) in DOMContentLoaded
//   - calls sendChatMessage() from handleSubmit instead of sendMessage()
//
// The SSE listener setup (listen('hermes-stream-chunk') +
// listen('hermes-stream-done')) lives in initChatStream; the dispose
// handle is invoked from the window unload handler.
//
// S14 usage extraction (prompt_tokens / completion_tokens / image_tokens /
// routing_decision / cost_estimate_usd) also lives in chat-stream —
// the agent pushes these on the final SSE chunk and chat-stream persists
// them via message_record_usage in finishStream.

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
  // v0.2-alpha-20: mirror the connection status into chatStore so
  // <ChatView /> can pick between the standard welcome / first-run
  // card (designs 06 / 08) and the no-network error card (design 07).
  // Only the "connected" state maps to online; the other two
  // transitional states count as offline for empty-state purposes.
  chatStore.setConnectionStatus(status === 'connected' ? 'online' : 'offline');
  if (connectionStatusEl) connectionStatusEl.className = `status-dot ${status}`;
  if (statusText) {
    const labels: Record<string, string> = { disconnected: '未连接', connecting: '连接中...', connected: '已连接' };
    statusText.textContent = labels[status] || status;
  }
}

// v0.2-alpha-18: updateSendButton deleted — the Preact <SendButton>
// sub-component reads `isLoading` from chatStore and renders the
// disabled + label + icon state directly. No more imperative DOM
// patching needed.

// v0.2-alpha-16: scrollToBottom / messagesContainer moved into the
// Preact <ChatViewWithWelcome /> component. The view tracks its own
// scroll position via useEffect on each chatStore state change.
