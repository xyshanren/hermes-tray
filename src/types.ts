// v0.2 — Type definitions extracted from main.ts (T-Q-S2 / S7 / S8 / S9 / S12-light / S14)
// Mirrors the Rust structs in src-tauri/src/db/{session,project,token,persona,message}.rs.
// Kept in one file to make cross-module type imports simple: `import type { Session } from '@/types'`.

// ── Session (T-Q-S2) ────────────────────────────────────────────────────────────

export interface Session {
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

// ── Project context (T-Q-S8) ────────────────────────────────────────────────────
//
// Mirrors `db::project::ProjectContext` on the Rust side. The Rust side
// returns this struct from the `project_scan` Tauri command; we JSON-
// encode it for `session_create.project_context` so the cache lives in
// the DB. `parseProjectContext` decodes the stored JSON when reading.

export interface ProjectContext {
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

export function parseProjectContext(json: string | null): ProjectContext | null {
  if (!json) return null;
  try { return JSON.parse(json) as ProjectContext; } catch { return null; }
}

// ── Token stats (T-Q-S9) ────────────────────────────────────────────────────────

export interface DailyBucket {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface ModelBucket {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  message_count: number;
}

export interface RuleBucket {
  rule_id: string;
  hit_count: number;
  cost_total: number;
}

export interface TokenStats {
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
  // S14-agent: token/image cost + routing decision from most recent message
  total_image_tokens: number;
  recent_routing_decision: string | null;
  recent_elapsed_ms: number | null;
  // v0.1.5 S12 cost-aware routing aggregates
  period_cost_total_usd: number;
  fallback_hit_rate: number;
  avg_latency_ms: number;
  cost_threshold_count: number;
  by_rule: RuleBucket[];
}

// ── Message / Search ──────────────────────────────────────────────────────────

export interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

export interface SearchHit {
  message_id: string;
  session_id: string;
  session_title: string;
  snippet: string;
  rank: number;
}

// ── Persona (T-Q-S7) ──────────────────────────────────────────────────────────
//
// A persona = reusable assistant role. Carries system_prompt that gets
// injected when a new session is created from it. Also serves as the
// "session template" library — no separate templates table needed.

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar: string;
  system_prompt: string;
  model: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ── Chat runtime types (frontend-only, not in DB) ────────────────────────────

export interface HermesResponse {
  ok: boolean;
  status: number;
  body: string;
}

export interface GatewayInfo {
  ip: string;
  port: string;
  url: string;
  distro: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: PendingAttachment[];
  created_at: string;
}

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  dataUrl: string;
}

export interface ChatState {
  isLoading: boolean;
  isStreaming: boolean;
  streamContent: string;
  streamElement: HTMLElement | null;
  messages: Message[];
  currentModel: string;
}

// ── Toast (frontend notification) ─────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info';

// ── Backup (T-Q-S11) ──────────────────────────────────────────────────────────

export type BackupTab = 'create' | 'restore';

// ── Stats period (T-Q-S9) ─────────────────────────────────────────────────────

export type StatsPeriod = 'day' | 'week' | 'month' | 'all';

// ── Connection status ─────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';