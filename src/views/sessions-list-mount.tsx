// v0.2-alpha-17 — Mount the SessionList Preact component into the
// existing `<div id="session-list">` shell defined in index.html.
//
// The shell stays static (no need to touch index.html); this module
// wipes the v0.1.5 inline list and renders the Preact view into the
// same element.
//
// main.ts wires the cross-cutting actions (onSelect / onDelete /
// onRename / onLoadMore / onExport) via the mount props. The view
// itself only consumes the store + emits callbacks — all Tauri invokes
// live in main.ts.

import { render } from "preact";
import { SessionList } from "./sessions-list-view";
import type { SessionListProps } from "./sessions-list-view";
import { sessionListStore, PAGE_SIZE } from "./sessions-list-store";

export interface MountSessionListOptions extends SessionListProps {
  /** Container element id (defaults to "session-list"). Override for
   *  tests so we can render into an isolated host. */
  targetId?: string;
}

/**
 * Mount the SessionList Preact component. Returns the host element so
 * tests can query its children. Idempotent — calling twice replaces
 * the previous render with a fresh one (no leaked listeners because
 * the SessionList subscribes via useEffect, which Preact cleans up on
 * re-render).
 */
export function mountSessionList(opts: MountSessionListOptions): HTMLElement {
  const root = document.getElementById(opts.targetId ?? "session-list");
  if (!root) {
    console.warn(`[Hermes] #${opts.targetId ?? "session-list"} mount point missing`);
    throw new Error(`mount point #${opts.targetId ?? "session-list"} not found`);
  }
  render(
    <SessionList
      personas={opts.personas}
      onSelect={opts.onSelect}
      onDelete={opts.onDelete}
      onRename={opts.onRename}
      onLoadMore={opts.onLoadMore}
      onExport={opts.onExport}
    />,
    root,
  );
  return root;
}

/**
 * Test-only helper: re-renders the SessionList with the latest store
 * state. Useful after a mutator call when the test wants to assert
 * that the view reflects the change without waiting for the
 * useEffect subscription to fire.
 */
export function reRenderSessionList(opts: MountSessionListOptions): void {
  mountSessionList(opts);
}

export { sessionListStore, PAGE_SIZE };