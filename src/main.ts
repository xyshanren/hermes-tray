// Hermes Chat - Main Application
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
const API_KEY = 'hermes-local-dev-key';

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
  currentModel: '-',
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
  addMessage('user', content);
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
  let formatted = content
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .split('\n\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('');
  formatted = formatted.replace(/([^>])\n([^<])/g, '$1<br>$2');
  return formatted;
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
    await hermesPostStream('/v1/chat/completions', {
      model: CONFIG.defaultModel,
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
        if (modelName) modelName.textContent = state.currentModel;
      }
    }
  } catch { /* skip */ }
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
