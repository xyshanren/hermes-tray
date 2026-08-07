// v0.2-alpha-19 — ShortcutsModal store + view tests.
//
// We cover the pub-sub mutators + the Preact render shell + the
// escape-to-close + click-to-close behaviours. The Ctrl+/ global
// trigger is wired in main.ts (DOMContentLoaded); we don't test
// that here because it's a window-level keyboard listener outside
// the modal's responsibility.

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { shortcutsModalStore, SHORTCUT_GROUPS } from "./shortcuts-modal-store";
import type { ShortcutRow } from "./shortcuts-modal-store";
import { ShortcutsModal } from "./shortcuts-modal-view";

function mountView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(<ShortcutsModal />, host);
  return host;
}

// ── store ──────────────────────────────────────────────────────────────────

describe("shortcutsModalStore", () => {
  beforeEach(() => {
    shortcutsModalStore.__resetForTests();
  });

  it("starts closed", () => {
    expect(shortcutsModalStore.get().open).toBe(false);
  });

  it("setOpen flips + notifies", () => {
    let seen = false;
    const unsub = shortcutsModalStore.subscribe((s) => (seen = s.open));
    expect(seen).toBe(false);
    shortcutsModalStore.setOpen(true);
    expect(seen).toBe(true);
    expect(shortcutsModalStore.get().open).toBe(true);
    unsub();
  });

  it("setOpen with same value is a no-op (no notify)", () => {
    let calls = 0;
    const unsub = shortcutsModalStore.subscribe(() => calls++);
    shortcutsModalStore.setOpen(false);
    expect(calls).toBe(1); // initial fire only
    unsub();
  });

  it("toggle flips and returns the new value", () => {
    expect(shortcutsModalStore.toggle()).toBe(true);
    expect(shortcutsModalStore.toggle()).toBe(false);
  });

  it("subscribe fires immediately with the current value", () => {
    shortcutsModalStore.setOpen(true);
    let seen = false;
    const unsub = shortcutsModalStore.subscribe((s) => (seen = s.open));
    expect(seen).toBe(true);
    unsub();
  });
});

describe("SHORTCUT_GROUPS data", () => {
  it("has exactly 3 groups (全局 / 输入区 / 通用)", () => {
    expect(SHORTCUT_GROUPS.map((g) => g.name)).toEqual(["全局", "输入区", "通用"]);
  });

  it("has exactly 7 shortcuts + 1 note total (alpha-35a added Ctrl+/ IME hint)", () => {
    const isShortcutRow = (r: ShortcutRow) => !("text" in r);
    let shortcuts = 0;
    let notes = 0;
    for (const group of SHORTCUT_GROUPS) {
      for (const row of group.shortcuts) {
        if (isShortcutRow(row)) shortcuts++;
        else notes++;
      }
    }
    expect(shortcuts).toBe(7);
    expect(notes).toBe(1);
  });

  it("every shortcut row has at least one key + a non-empty description", () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const row of group.shortcuts) {
        if ("text" in row) continue; // skip note rows
        expect(row.keys.length).toBeGreaterThan(0);
        expect(row.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("the global group carries an IME doc-gap note under Ctrl+/", () => {
    const global = SHORTCUT_GROUPS.find((g) => g.name === "全局");
    expect(global).toBeDefined();
    const notes = global!.shortcuts.filter((r) => "text" in r);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/IME/);
  });
});

// ── render shell ──────────────────────────────────────────────────────────

describe("<ShortcutsModal /> (render shell)", () => {
  beforeEach(() => {
    shortcutsModalStore.__resetForTests();
    document.body.innerHTML = "";
  });

  it("renders nothing when closed", () => {
    const host = mountView();
    expect(host.querySelector(".modal-shortcuts")).toBeNull();
  });

  it("renders 3 group sections + 7 shortcut rows + 1 IME note when open", async () => {
    const host = mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    const modal = host.querySelector(".modal-shortcuts");
    expect(modal).not.toBeNull();
    const groups = modal!.querySelectorAll(".shortcuts-group");
    expect(groups).toHaveLength(3);
    const rows = modal!.querySelectorAll(".shortcuts-row");
    expect(rows).toHaveLength(7);
    const notes = modal!.querySelectorAll(".shortcuts-note");
    expect(notes).toHaveLength(1);
  });

  it("renders the IME note text inside the global group", async () => {
    const host = mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    const note = host.querySelector(".shortcuts-note");
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/IME/);
  });

  it("renders the group name labels from SHORTCUT_GROUPS", async () => {
    const host = mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    const names = Array.from(host.querySelectorAll(".shortcuts-group-name")).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(["全局", "输入区", "通用"]);
  });

  it("renders the × close button + Esc hint footer", async () => {
    const host = mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.querySelector(".modal-close-btn")).not.toBeNull();
    expect(host.querySelector(".shortcuts-footer-hint")).not.toBeNull();
  });

  it("clicking × closes the modal via the store", async () => {
    const host = mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    const closeBtn = host.querySelector(".modal-close-btn") as HTMLButtonElement;
    closeBtn.click();
    expect(shortcutsModalStore.get().open).toBe(false);
    // The Preact view unsubscribes after open=false; verify a second
    // open + close works (no leaked listener).
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.querySelector(".modal-shortcuts")).not.toBeNull();
  });

  it("Escape key closes the modal", async () => {
    mountView();
    shortcutsModalStore.setOpen(true);
    await new Promise((r) => setTimeout(r, 10));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shortcutsModalStore.get().open).toBe(false);
  });
});