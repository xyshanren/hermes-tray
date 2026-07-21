// v0.2-alpha-32.5 — Per-session project override picker (header chip + dropdown).
//
// Replaces the static #header-project-chip / #header-project-name spans
// from alpha-27. Renders a clickable chip showing the current project
// name; clicking opens a dropdown with:
//   - Current project (highlighted, non-clickable)
//   - MRU paths (last 5 unique project paths)
//   - 📂 浏览... → native folder picker
//   - 🚫 清除项目关联 → set project_dir = null
//
// Actions are delegated to main.ts via props (the view never calls
// Tauri invoke directly — same pattern as SessionList / SearchModal).

import { useEffect, useRef, useState } from "preact/hooks";
import { projectPickerStore, type ProjectPickerState } from "./project-picker-store";

export interface ProjectPickerProps {
  /** User picked a path from MRU or folder dialog. main.ts runs
   *  scanProject + session_update, then calls store.applyProject(). */
  onPick: (path: string) => void;
  /** User clicked "清除项目关联". main.ts patches session with
   *  project_dir = null + project_context = null. */
  onClear: () => void;
  /** User clicked "浏览..." — main.ts opens the native folder dialog
   *  and calls onPick with the result (or does nothing on cancel). */
  onBrowse: () => void;
}

export function ProjectPicker(props: ProjectPickerProps) {
  const [state, setState] = useState<ProjectPickerState>(projectPickerStore.get());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => projectPickerStore.subscribe(setState), []);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!state.isOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        projectPickerStore.setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state.isOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!state.isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") projectPickerStore.setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [state.isOpen]);

  const proj = state.currentProject;
  const hasSession = state.sessionId != null;

  // Hide entirely when no active session.
  if (!hasSession) return null;

  const chipLabel = proj ? proj.name : "未关联项目";

  return (
    <div class="project-picker" ref={rootRef}>
      <button
        type="button"
        class={`project-picker-chip${proj ? "" : " project-picker-chip--empty"}`}
        title={proj ? proj.project_dir : "点击关联项目目录"}
        onClick={() => projectPickerStore.toggle()}
        disabled={state.isLoading}
      >
        <span class="project-picker-chip-icon" aria-hidden="true">📁</span>
        <span class="project-picker-chip-name">{chipLabel}</span>
        <span class="project-picker-chip-arrow" aria-hidden="true">▾</span>
      </button>

      {state.isOpen && (
        <div class="project-picker-dropdown" role="listbox" aria-label="选择项目目录">
          {/* Current project indicator */}
          {proj && (
            <div class="project-picker-current" aria-disabled="true">
              <span class="project-picker-current-icon" aria-hidden="true">✓</span>
              <span class="project-picker-current-name">{proj.name}</span>
              <span class="project-picker-current-path">{shortenPath(proj.project_dir)}</span>
            </div>
          )}

          {/* MRU paths */}
          {state.recentPaths.length > 0 && (
            <div class="project-picker-section">
              <div class="project-picker-section-label">最近使用</div>
              {state.recentPaths
                .filter((p) => p !== proj?.project_dir)
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    class="project-picker-item"
                    title={p}
                    disabled={state.isLoading}
                    onClick={() => props.onPick(p)}
                  >
                    <span class="project-picker-item-icon" aria-hidden="true">📂</span>
                    <span class="project-picker-item-path">{shortenPath(p)}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Actions */}
          <div class="project-picker-actions">
            <button
              type="button"
              class="project-picker-item project-picker-browse"
              disabled={state.isLoading}
              onClick={() => props.onBrowse()}
            >
              <span class="project-picker-item-icon" aria-hidden="true">📂</span>
              <span>浏览...</span>
            </button>
            {proj && (
              <button
                type="button"
                class="project-picker-item project-picker-clear"
                disabled={state.isLoading}
                onClick={() => props.onClear()}
              >
                <span class="project-picker-item-icon" aria-hidden="true">🚫</span>
                <span>清除项目关联</span>
              </button>
            )}
          </div>

          {/* Loading overlay */}
          {state.isLoading && (
            <div class="project-picker-loading">
              <span class="project-picker-spinner" aria-hidden="true" />
              扫描中...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Shorten a full path to "~/<last-2-segments>" for compact display. */
function shortenPath(full: string): string {
  const parts = full.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return full;
  return "~/" + parts.slice(-2).join("/");
}
