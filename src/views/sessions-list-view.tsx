// v0.2-alpha-17 — SessionList (Preact JSX).
//
// Renders the sidebar's session list into the existing
// <div id="session-list"> shell defined in index.html. Subscribes to
// sessionListStore for state; main.ts drives the store via mutators.
//
// Sub-components:
//   - SessionItem       — one row (title + persona + project badge +
//                         token badge + export button + delete button)
//   - RenameEditor      — <input> swap when a row enters rename mode
//   - LoadMoreButton    — "加载更多..." at the bottom of the list
//   - EmptyState        — "暂无会话记录" when the list is empty
//
// Cross-cutting actions (select / delete / export / rename / load-more)
// come in via props from main.ts so this view stays a pure renderer.
// The view never mutates sessionListStore directly — main.ts owns the
// side-effects (Tauri invokes, toasts, chat view navigation).

import { useEffect, useRef, useState } from "preact/hooks";
import type { Session, Persona } from "../types";
import { sessionListStore } from "./sessions-list-store";
import type { SessionListState } from "./sessions-list-store";

export interface SessionListProps {
  /** Persona cache for avatar lookup. main.ts owns this list and
   *  re-renders the SessionList when it changes (via key= or by
   *  passing a fresh array reference). */
  personas: Persona[];
  /** Called when the user clicks a row. main.ts wires this to
   *  selectSession() — it loads the chat history via chatStore and
   *  highlights the row in the sidebar. */
  onSelect: (id: string) => void;
  /** Called when the user clicks the × button. main.ts wires this to
   *  deleteSession() — shows a confirmation prompt and invokes
   *  session_delete, then removes the row via the store. */
  onDelete: (id: string) => void;
  /**
   * Called when the user commits a new title via the rename editor.
   * main.ts invokes session_update and updates the store on success.
   * The Promise resolves once the DB write is done; rejection surfaces
   * as an error toast + the editor stays open with the old title.
   */
  onRename: (id: string, newTitle: string) => Promise<void>;
  /** Called when the user clicks the "加载更多..." button. main.ts
   *  advances the pagination offset, fetches the next page, and calls
   *  sessionListStore.appendMorePage(). */
  onLoadMore: () => Promise<void>;
  /** Called when the user clicks the 📤 button. main.ts wires this to
   *  copySessionAsMarkdown() which fetches + clipboard-writes the
   *  session's markdown export. */
  onExport: (id: string) => void;
}

export function SessionList(props: SessionListProps) {
  const [state, setState] = useState<SessionListState>(sessionListStore.get());

  useEffect(() => sessionListStore.subscribe(setState), []);

  return (
    <div class="sessions-list-view">
      {state.sessions.length === 0 && !state.isLoading ? (
        <EmptyState />
      ) : (
        <>
          {state.sessions.map((s: Session) => (
            <SessionItem
              key={s.id}
              session={s}
              persona={props.personas.find((p) => p.id === s.persona_id) ?? null}
              isActive={s.id === state.activeId}
              isRenaming={s.id === state.renameId}
              isRenamed={state.renamedSessionIds.has(s.id)}
              onSelect={props.onSelect}
              onDelete={props.onDelete}
              onStartRename={() => sessionListStore.beginRename(s.id)}
              onFinishRename={(newTitle) => props.onRename(s.id, newTitle)}
              onCancelRename={() => sessionListStore.cancelRename()}
              onExport={props.onExport}
            />
          ))}
          {state.hasMore ? (
            <LoadMoreButton onClick={props.onLoadMore} isLoading={state.isLoading} />
          ) : null}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return <div class="session-empty">暂无会话记录</div>;
}

function LoadMoreButton({ onClick, isLoading }: { onClick: () => Promise<void>; isLoading: boolean }) {
  return (
    <button
      type="button"
      class="session-load-more"
      disabled={isLoading}
      onClick={() => void onClick()}
    >
      {isLoading ? "加载中..." : "加载更多..."}
    </button>
  );
}

interface SessionItemProps {
  session: Session;
  persona: Persona | null;
  isActive: boolean;
  isRenaming: boolean;
  /** v0.2-alpha-27 — true if the user has manually renamed this
   *  session (vs. auto-rename from the first-message heuristic).
   *  Drives the 📌 marker + purple status dot (design 01). */
  isRenamed: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename: () => void;
  onFinishRename: (newTitle: string) => Promise<void>;
  onCancelRename: () => void;
  onExport: (id: string) => void;
}

function SessionItem(props: SessionItemProps) {
  const { session, persona, isActive, isRenaming, isRenamed } = props;
  // Derive the project badge text from the JSON-encoded context blob.
  // parseProjectContext lives in src/types.ts (it's the same shape on
  // both Rust and TS sides, kept in one place for cross-module reuse).
  const proj = parseProjectContext(session.project_context);
  // v0.2-alpha-27 — design 01 layout: subtitle = "project_path · relative time"
  // or "未关联项目 · relative time" if no project. Format mirrors the SVG.
  //
  // v0.2-alpha-32.3: split into parts so the view can render the
  // project as a styled chip and the time as a muted line next to
  // it. The chip is the visual answer to "I can't tell which project
  // a session belongs to" (Issue 4) — clicks open the per-session
  // override picker in alpha-32.4. For now the chip is read-only
  // with a tooltip showing the full path.
  const subtitleParts = buildSessionSubtitleParts(
    proj?.project_dir ?? null,
    session.updated_at,
  );

  return (
    <div
      class={`session-item${isActive ? " active" : ""}${isRenamed ? " renamed" : ""}`}
      data-session-id={session.id}
      onClick={() => props.onSelect(session.id)}
    >
      <div class="session-item-main">
        {isRenaming ? (
          <RenameEditor
            initial={session.title || "无标题会话"}
            onCommit={props.onFinishRename}
            onCancel={props.onCancelRename}
          />
        ) : (
          <span
            class="session-title"
            // v0.1.5 fired startRename on dblclick. We preserve that
            // gesture so existing muscle memory carries over.
            onDblClick={(e) => {
              e.stopPropagation();
              props.onStartRename();
            }}
          >
            <span
              // v0.2-alpha-27 — design 01 status dot: green for default
              // (completed/idle), purple for user-renamed sessions.
              class={`session-status-dot${isRenamed ? " renamed" : ""}`}
              aria-label={isRenamed ? "已手动命名" : "已完成"}
            />
            {persona?.avatar ? (
              <span class="session-persona-emoji">{persona.avatar}</span>
            ) : null}{" "}
            {isRenamed ? <span class="session-rename-pin" aria-label="用户已命名">📌 </span> : null}
            {session.title || "无标题会话"}
          </span>
        )}
        <span class="session-subtitle">
          {subtitleParts.project ? (
            <span
              class="session-project-chip"
              title={proj?.project_dir ?? subtitleParts.project}
            >
              <span aria-hidden="true">📁</span> {subtitleParts.project}
            </span>
          ) : (
            <span class="session-project-chip session-project-chip--empty">
              {subtitleParts.projectPlaceholder}
            </span>
          )}
          <span class="session-subtitle-sep" aria-hidden="true">·</span>
          <span class="session-subtitle-time">{subtitleParts.time}</span>
        </span>
      </div>
      {session.total_tokens && session.total_tokens > 0 ? (
        <span class="session-tokens" title={`总 token: ${session.total_tokens}`}>
          {formatTokens(session.total_tokens)}
        </span>
      ) : null}
      <button
        type="button"
        class="session-action-btn"
        title="复制为 Markdown"
        onClick={(e) => {
          e.stopPropagation();
          props.onExport(session.id);
        }}
      >
        📤
      </button>
      <button
        type="button"
        class="session-delete"
        title="删除会话"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete(session.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

interface RenameEditorProps {
  initial: string;
  onCommit: (newTitle: string) => Promise<void>;
  onCancel: () => void;
}

function RenameEditor({ initial, onCommit, onCancel }: RenameEditorProps) {
  const [value, setValue] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus + select-all on mount (matches v0.1.5 startRename behaviour).
  // The dependency is intentionally empty so the focus only fires on
  // the initial mount — re-renders caused by the parent re-rendering
  // (e.g. another session's token badge updating) shouldn't steal focus.
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  async function commit() {
    const next = value.trim();
    if (next === initial) {
      // No-op rename (user didn't change anything). Just exit edit mode.
      onCancel();
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCommit(next);
      // The parent removes rename mode via the store after success.
    } catch (e) {
      // Parent surfaces the toast; we keep the editor open so the user
      // doesn't lose their edit. Reset submitting so they can retry.
      setSubmitting(false);
      console.warn("[Rename] commit failed:", e);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      class="session-rename-input"
      value={value}
      disabled={submitting}
      // Stop click + dblclick from bubbling to the row's select handler.
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          void commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => {
        // Blur commits — matches v0.1.5 finishRename behaviour where
        // clicking away from the input saves the rename. The parent
        // catches failures and keeps the editor open via re-render.
        if (!submitting) void commit();
      }}
    />
  );
}

// ── Helpers (imported here instead of from main.ts to avoid circular deps) ──

function parseProjectContext(json: string | null): { name: string; project_dir: string } | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as { name?: string; project_dir?: string };
    if (!obj?.name) return null;
    return { name: obj.name, project_dir: obj.project_dir ?? "" };
  } catch {
    return null;
  }
}

/**
 * v0.2-alpha-27 — design 01 subtitle: "project_path · relative time"
 * (e.g. "~/code/hermes · 昨天") or "未关联项目 · 3 天前" if no project.
 * project_dir is shortened to "~/<last-2-segments>" for sidebar compactness.
 *
 * v0.2-alpha-32.3: returns structured parts (project + time) so the
 * view can render the project as a styled chip and the time as a
 * muted line next to it. The chip is the visual answer to "I can't
 * tell which project a session belongs to" (Issue 4) — it becomes
 * a click target in alpha-32.4 (per-session override picker).
 */
interface SessionSubtitle {
  /** Shortened project label, or null if no project is attached. */
  project: string | null;
  /** "未关联项目" if no project, else empty (chip carries the project). */
  projectPlaceholder: string;
  /** Relative time string, always present. */
  time: string;
}
function buildSessionSubtitleParts(projectDir: string | null, updatedAt: string): SessionSubtitle {
  const time = formatRelativeTime(updatedAt);
  if (!projectDir) return { project: null, projectPlaceholder: "未关联项目", time };
  return { project: shortenPath(projectDir), projectPlaceholder: "", time };
}

/** Shorten an absolute path to "~/<last-1-or-2-segments>" for sidebar density. */
function shortenPath(p: string): string {
  // Strip Windows drive letter if present (C:\foo\bar -> foo\bar)
  const normalized = p.replace(/^[A-Z]:\\/, "").replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized) return p;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return p;
  if (parts.length === 1) return `~/${parts[0]}`;
  // ~/parent/child — keep last 2 segments
  return `~/${parts.slice(-2).join("/")}`;
}

/** Compact relative time — "刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / X 周前 / X 月前". */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const deltaMs = now - then;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (deltaMs < min) return "刚刚";
  if (deltaMs < hour) return `${Math.floor(deltaMs / min)} 分钟前`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)} 小时前`;
  // Yesterday = calendar-day delta of 1
  const today = new Date(now);
  const thatDay = new Date(then);
  const dayDelta = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(thatDay.getFullYear(), thatDay.getMonth(), thatDay.getDate()).getTime()) /
      day,
  );
  if (dayDelta === 1) return "昨天";
  if (dayDelta < 7) return `${dayDelta} 天前`;
  if (dayDelta < 30) return `${Math.floor(dayDelta / 7)} 周前`;
  if (dayDelta < 365) return `${Math.floor(dayDelta / 30)} 个月前`;
  return `${Math.floor(dayDelta / 365)} 年前`;
}

function formatTokens(n: number): string {
  // Compact representation: 1.2k / 3.4M. Matches v0.1.5 src/tokenChart.ts
  // so users see the same number as the stats modal.
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}