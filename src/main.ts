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

const UNKNOWN_MODEL = '-';

// ── Session / FTS5 types ──────────────────────────────────────────────────────

interface Session {
  id: string;
  title: string;
  persona_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
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

// ── Session State ─────────────────────────────────────────────────────────────

let currentSessionId: string | null = null;
let sidebarVisible = false;

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
      const titleEl = document.createElement('span');
      titleEl.className = 'session-title';
      titleEl.textContent = s.title || '无标题会话';
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
    const session = await invoke<Session>('session_create', { title: '新会话', personaId: null });
    currentSessionId = session.id;
    state.messages = [];
    const messagesEl = document.getElementById('messages');
    if (messagesEl) {
      messagesEl.innerHTML = '<div class="welcome-message"><p>👋 新会话已开始</p><p class="hint">在下方输入消息开始对话</p></div>';
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

  // ── Settings Initialization ──────────────────

  const settingsModal = document.getElementById('settings-modal')!;
  const settingsBtn = document.getElementById('settings-btn')!;
  const settingsClose = document.getElementById('settings-close')!;
  const settingsCancel = document.getElementById('settings-cancel')!;
  const settingsSave = document.getElementById('settings-save')!;
  const wslDistroSelect = document.getElementById('setting-wsl-distro') as HTMLSelectElement;
  const portInput = document.getElementById('setting-port') as HTMLInputElement;
  const apiKeyInput = document.getElementById('setting-api-key') as HTMLInputElement;

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

  // Cleanup on unload
  window.addEventListener('unload', () => {
    unlistenChunk?.();
    unlistenDone?.();
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
    const apiMessages = state.messages
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

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
