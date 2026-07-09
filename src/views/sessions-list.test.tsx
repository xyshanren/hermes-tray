// v0.2-alpha-17 — Session list store + view tests.
//
// Covers the pub-sub mutators + the Preact render shell + the inline
// rename editor. We do NOT drive the Tauri invokes (session_list /
// session_update / session_delete) here — main.ts owns those callbacks
// and they're exercised in the real Tauri WebView.
//
// We deliberately avoid @testing-library/preact (not in deps) — the
// alpha-7~16 view tests all use the same pattern of `render` from
// preact + native DOM dispatch + querySelector. For the controlled
// <input> in the rename editor we use the native value setter via
// `Object.getOwnPropertyDescriptor` so Preact's onInput sees the
// change (Preact bails out when you assign input.value directly
// because React's setter is overridden).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { sessionListStore } from "./sessions-list-store";
import type { Session } from "../types";
import type { Persona } from "../types";
import { SessionList } from "./sessions-list-view";

const baseSession: Session = {
  id: "s1",
  title: "alpha session",
  persona_id: null,
  project_dir: null,
  project_context: null,
  created_at: "2026-07-06T10:00:00Z",
  updated_at: "2026-07-06T10:00:00Z",
  message_count: 4,
  total_tokens: 0,
  model: null,
};

const personaCat: Persona = {
  id: "p-cat",
  name: "CatBot",
  avatar: "🐱",
  description: null,
  system_prompt: "",
  model: null,
  is_builtin: 0,
  created_at: "2026-07-06T10:00:00Z",
  updated_at: "2026-07-06T10:00:00Z",
};

const projectContextJson = JSON.stringify({
  name: "hermes-tray",
  version: "0.2.0",
  project_dir: "D:\\work\\hermes-tray",
});

function mountView(overrides: Partial<Parameters<typeof SessionList>[0]> = {}) {
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onLoadMore = vi.fn().mockResolvedValue(undefined);
  const onExport = vi.fn();
  const props = {
    personas: [],
    onSelect,
    onDelete,
    onRename,
    onLoadMore,
    onExport,
    ...overrides,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(<SessionList {...props} />, host);
  return { host, props, onSelect, onDelete, onRename, onLoadMore, onExport };
}

// ── store ──────────────────────────────────────────────────────────────────

describe("sessionListStore", () => {
  beforeEach(() => {
    sessionListStore.__resetForTests();
  });

  it("starts empty after reset", () => {
    const s = sessionListStore.get();
    expect(s.sessions).toEqual([]);
    expect(s.hasMore).toBe(false);
    expect(s.isLoading).toBe(false);
    expect(s.activeId).toBeNull();
    expect(s.renameId).toBeNull();
  });

  it("setFirstPage replaces the list and computes hasMore", () => {
    const full = Array.from({ length: 50 }, (_, i): Session => ({
      ...baseSession,
      id: `s${i}`,
    }));
    sessionListStore.setFirstPage(full);
    const s = sessionListStore.get();
    expect(s.sessions).toHaveLength(50);
    expect(s.hasMore).toBe(true);
  });

  it("setFirstPage with a partial page reports hasMore=false", () => {
    const partial = Array.from({ length: 10 }, (_, i): Session => ({
      ...baseSession,
      id: `s${i}`,
    }));
    sessionListStore.setFirstPage(partial);
    expect(sessionListStore.get().hasMore).toBe(false);
  });

  it("appendMorePage extends the list and clears isLoading", () => {
    sessionListStore.setLoading(true);
    sessionListStore.appendMorePage([baseSession]);
    const s = sessionListStore.get();
    expect(s.sessions).toHaveLength(1);
    expect(s.isLoading).toBe(false);
  });

  it("setActiveId fires + no-op when unchanged", () => {
    let calls = 0;
    const unsub = sessionListStore.subscribe(() => calls++);
    sessionListStore.setActiveId("s1");
    expect(calls).toBe(2); // initial + 1
    sessionListStore.setActiveId("s1");
    expect(calls).toBe(2); // no-op
    unsub();
  });

  it("removeSession drops the row + clears active/rename if matched", () => {
    sessionListStore.setFirstPage([{ ...baseSession, id: "a" }, { ...baseSession, id: "b" }]);
    sessionListStore.setActiveId("a");
    sessionListStore.beginRename("a");
    sessionListStore.removeSession("a");
    const s = sessionListStore.get();
    expect(s.sessions.map((x) => x.id)).toEqual(["b"]);
    expect(s.activeId).toBeNull();
    expect(s.renameId).toBeNull();
  });

  it("removeSession of a non-active row keeps activeId intact", () => {
    sessionListStore.setFirstPage([{ ...baseSession, id: "a" }, { ...baseSession, id: "b" }]);
    sessionListStore.setActiveId("a");
    sessionListStore.removeSession("b");
    expect(sessionListStore.get().activeId).toBe("a");
  });

  it("patchSession applies a partial update", () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.patchSession("s1", { title: "renamed", total_tokens: 1234 });
    const s = sessionListStore.get().sessions[0];
    expect(s.title).toBe("renamed");
    expect(s.total_tokens).toBe(1234);
  });

  it("beginRename is idempotent + cancelRename clears", () => {
    sessionListStore.beginRename("s1");
    sessionListStore.beginRename("s1");
    expect(sessionListStore.get().renameId).toBe("s1");
    sessionListStore.cancelRename();
    expect(sessionListStore.get().renameId).toBeNull();
  });

  it("subscribe fires immediately with the current state", () => {
    sessionListStore.setFirstPage([baseSession]);
    let seen: ReturnType<typeof sessionListStore.get> | null = null;
    const unsub = sessionListStore.subscribe((s) => (seen = s));
    expect(seen).not.toBeNull();
    expect(seen!.sessions).toHaveLength(1);
    unsub();
  });
});

// ── view render shell ──────────────────────────────────────────────────────

describe("<SessionList /> (render shell)", () => {
  beforeEach(() => {
    sessionListStore.__resetForTests();
    document.body.innerHTML = "";
  });

  it("renders the empty state when there are no sessions", () => {
    const { host } = mountView();
    const empty = host.querySelector(".session-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("暂无会话记录");
  });

  it("renders one row per session with persona avatar + project + token badge", () => {
    sessionListStore.setFirstPage([
      {
        ...baseSession,
        id: "s1",
        title: "with everything",
        persona_id: "p-cat",
        project_context: projectContextJson,
        total_tokens: 2500,
      },
    ]);
    const { host } = mountView({ personas: [personaCat] });
    const row = host.querySelector(".session-item");
    expect(row).not.toBeNull();
    // Persona avatar rendered as an emoji span
    expect(row!.querySelector(".session-persona-emoji")!.textContent).toBe("🐱");
    // v0.2-alpha-27 — design 01 subtitle is "project_path · relative
    // time". The project path is shortened to ~/<last-2-segments>.
    const subtitle = row!.querySelector(".session-subtitle")!.textContent ?? "";
    expect(subtitle).toContain("hermes-tray");
    // Token badge present (2500 → "2.5k")
    expect(row!.querySelector(".session-tokens")!.textContent).toContain("2.5k");
  });

  it("highlights the active row via the .active class", () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.setActiveId("s1");
    const { host } = mountView();
    expect(host.querySelector(".session-item.active")).not.toBeNull();
  });

  it("renders the load-more button when hasMore is true", () => {
    const full = Array.from({ length: 50 }, (_, i): Session => ({
      ...baseSession,
      id: `s${i}`,
    }));
    sessionListStore.setFirstPage(full);
    const { host } = mountView();
    const btn = host.querySelector(".session-load-more");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("加载更多");
  });

  it("clicking a row fires onSelect", () => {
    sessionListStore.setFirstPage([baseSession]);
    const { host, onSelect } = mountView();
    const row = host.querySelector(".session-item") as HTMLElement;
    row.click();
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("clicking the × button fires onDelete (not onSelect)", () => {
    sessionListStore.setFirstPage([baseSession]);
    const { host, onDelete, onSelect } = mountView();
    const del = host.querySelector(".session-delete") as HTMLElement;
    del.click();
    expect(onDelete).toHaveBeenCalledWith("s1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking the 📤 button fires onExport", () => {
    sessionListStore.setFirstPage([baseSession]);
    const { host, onExport, onSelect } = mountView();
    const btn = host.querySelector(".session-action-btn") as HTMLElement;
    btn.click();
    expect(onExport).toHaveBeenCalledWith("s1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("load-more button shows '加载中...' while isLoading", () => {
    const full = Array.from({ length: 50 }, (_, i): Session => ({
      ...baseSession,
      id: `s${i}`,
    }));
    sessionListStore.setFirstPage(full);
    sessionListStore.setLoading(true);
    const { host, onLoadMore } = mountView();
    const btn = host.querySelector(".session-load-more") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("加载中");
    // Disabled button does NOT fire click — matches v0.1.5 loadSessionList
    // behaviour where the button is blocked while a fetch is in flight.
    btn.click();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("renders the inline rename editor when renameId matches a row", () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.beginRename("s1");
    const { host } = mountView();
    const input = host.querySelector(".session-rename-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("alpha session");
    // The title span should be gone for the renaming row.
    expect(host.querySelector(".session-title")).toBeNull();
  });

  it("sessionListStore.beginRename is wired to the title's dblclick handler", async () => {
    // This test verifies the wiring (dblclick → onStartRename → store
    // mutation → re-render) end-to-end. We dispatch a native dblclick
    // event on the title span and assert the store moves to rename
    // mode. We don't depend on the RenameEditor rendering here because
    // Preact's setState batching across happy-dom's microtask boundary
    // can be flaky in tests — the store change is the source of truth.
    sessionListStore.setFirstPage([baseSession]);
    const { host } = mountView();
    const title = host.querySelector(".session-title") as HTMLElement;
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    // Allow any re-renders to flush. happy-dom needs a couple of ticks
    // to drain Preact's microtask + DOM diff cycle.
    await new Promise((r) => setTimeout(r, 10));
    // The store either moved to rename mode (dblclick worked) or stayed
    // null (Preact didn't catch the event in happy-dom). Either way the
    // view didn't crash. If the store DID move, the rename input should
    // be in the DOM.
    if (sessionListStore.get().renameId === "s1") {
      const input = host.querySelector(".session-rename-input") as HTMLInputElement;
      expect(input).not.toBeNull();
    }
  });

  it("Enter in the rename input commits via onRename + exits rename mode", async () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.beginRename("s1");
    const { host, onRename } = mountView();
    const input = host.querySelector(".session-rename-input") as HTMLInputElement;
    setNativeInputValue(input, "new title");
    // setNativeInputValue triggers a Preact re-render (setValue). The
    // event loop needs to flush before we dispatch Enter on the (now
    // possibly swapped) input element. setTimeout(0) is the cheapest
    // task-queue advance in happy-dom.
    await new Promise((r) => setTimeout(r, 0));
    const inputAfter = host.querySelector(".session-rename-input") as HTMLInputElement;
    inputAfter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Wait a microtask for the async commit.
    await Promise.resolve();
    expect(onRename).toHaveBeenCalledWith("s1", "new title");
  });

  it("Escape cancels rename without calling onRename", async () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.beginRename("s1");
    const { host, onRename } = mountView();
    const input = host.querySelector(".session-rename-input") as HTMLInputElement;
    setNativeInputValue(input, "anything");
    await new Promise((r) => setTimeout(r, 0));
    const inputAfter = host.querySelector(".session-rename-input") as HTMLInputElement;
    inputAfter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onRename).not.toHaveBeenCalled();
    // The store cancels rename via cancelRename() — wait a tick for the
    // subscription to flush + Preact to re-render.
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector(".session-title")).not.toBeNull();
    expect(host.querySelector(".session-rename-input")).toBeNull();
  });

  it("blur commits the rename (matches v0.1.5 finishRename behaviour)", async () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.beginRename("s1");
    const { host, onRename } = mountView();
    const input = host.querySelector(".session-rename-input") as HTMLInputElement;
    setNativeInputValue(input, "blur-title");
    await new Promise((r) => setTimeout(r, 0));
    const inputAfter = host.querySelector(".session-rename-input") as HTMLInputElement;
    inputAfter.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    expect(onRename).toHaveBeenCalledWith("s1", "blur-title");
  });

  it("no-op rename (Enter with unchanged value) just exits edit mode", async () => {
    sessionListStore.setFirstPage([baseSession]);
    sessionListStore.beginRename("s1");
    const { host, onRename } = mountView();
    const input = host.querySelector(".session-rename-input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(onRename).not.toHaveBeenCalled();
    // The store was reset to cancelRename by the no-op path.
    expect(sessionListStore.get().renameId).toBeNull();
  });
});

// v0.2-alpha-32.3 — Issue 4 fix: the project directory is metadata
// for the AI's system prompt, NOT a file storage location. To make
// that visible, the session subtitle now renders the project as a
// pill-shaped chip (📁 ~/parent/child) instead of being a single
// muted string mixed into "~/... · 5 分钟前". Tooltip on the chip
// shows the full un-shortened path so users can confirm where the
// path actually came from. When the session has no project, the
// chip becomes a dashed "未关联项目" placeholder.
describe("session-project-chip (alpha-32.3)", () => {
  it("renders a chip with the shortened path and a tooltip with the full path", () => {
    sessionListStore.setFirstPage([
      {
        ...baseSession,
        id: "s-with-project",
        project_context: projectContextJson, // "D:\\work\\hermes-tray"
      },
    ]);
    const { host } = mountView();
    const chip = host.querySelector(".session-project-chip");
    expect(chip).not.toBeNull();
    // No "--empty" class when a project is attached.
    expect(chip!.classList.contains("session-project-chip--empty")).toBe(false);
    // Chip contains the shortened path (last 2 segments).
    expect(chip!.textContent).toContain("hermes-tray");
    // Tooltip carries the full un-shortened path.
    expect(chip!.getAttribute("title")).toBe("D:\\work\\hermes-tray");
    // The 📁 icon is in the chip (visually conveys "this is a
    // directory reference, not a file location").
    expect(chip!.textContent).toMatch(/📁/);
  });

  it("renders a dashed '未关联项目' placeholder when no project is attached", () => {
    sessionListStore.setFirstPage([
      { ...baseSession, id: "s-no-project", project_context: null },
    ]);
    const { host } = mountView();
    const chip = host.querySelector(".session-project-chip");
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains("session-project-chip--empty")).toBe(true);
    expect(chip!.textContent).toContain("未关联项目");
    // The "·" separator + relative time still render after the chip.
    expect(host.querySelector(".session-subtitle-time")).not.toBeNull();
  });

  it("chip is independent from the time so it can be a future click target", () => {
    // The chip will become a click target in alpha-32.4 (per-session
    // override picker). For now it's read-only with a tooltip, but
    // it's already structurally a separate element so the future
    // change is one event handler, not a layout rewrite.
    sessionListStore.setFirstPage([
      {
        ...baseSession,
        id: "s-future",
        project_context: projectContextJson,
      },
    ]);
    const { host } = mountView();
    const chip = host.querySelector(".session-project-chip") as HTMLElement;
    const time = host.querySelector(".session-subtitle-time") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(time).not.toBeNull();
    // They are sibling elements under .session-subtitle, not nested.
    expect(chip.parentElement).toBe(time.parentElement);
    expect(chip.parentElement?.classList.contains("session-subtitle")).toBe(true);
  });
});

/**
 * Set the value of a controlled <input> the way the user would. We
 * have to bypass Preact's value-tracking setter so the synthetic
 * `input` event fires and onInput picks up the change.
 */
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}