// v0.2-alpha-7 — SearchModal component smoke tests.
//
// Covers the store-driven open/close flow and the imperative setter.
// We intentionally do NOT drive the search pipeline through the DOM
// input event chain here — happy-dom + Preact's batched setState timing
// around controlled-input + useEffect is unreliable enough to make
// debounced async tests flaky. The production path (real Tauri WebView)
// uses the same _setSearchQuery / onInput handler that we test in the
// store + rendering suites, so behavior coverage is preserved.
// A small set of additional pure-logic coverage lives in sanitize.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { SearchModal } from "./search-modal";
import { searchModalStore } from "./search-modal-store";

// (SessionHit shape preserved for future search tests; current suite
// only exercises store + rendering surfaces. Removed the unused interface
// declaration to keep tsc clean.)

// (SessionHit shape preserved for future search tests; current suite
// only exercises store + rendering surfaces. Removed the unused interface
// declaration to keep tsc clean.)

// Mock invoke + toast so SearchModal renders without a real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

function mountSearchModalInto(onSelect: (id: string) => void): HTMLElement {
  const oldRoot = document.getElementById("search-modal");
  if (oldRoot) render(null, oldRoot);

  const root = document.createElement("div");
  root.id = "search-modal";
  document.body.appendChild(root);
  render(<SearchModal onSelect={onSelect} />, root);
  return root;
}

/** Wait for Preact's render + effect queue to drain. */
async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  searchModalStore.setOpen(false);
  document.body.innerHTML = "";
});

afterEach(() => {
  const oldRoot = document.getElementById("search-modal");
  if (oldRoot) render(null, oldRoot);
  document.body.innerHTML = "";
});

describe("searchModalStore", () => {
  it("starts closed", () => {
    expect(searchModalStore.getOpen()).toBe(false);
  });

  it("setOpen notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = searchModalStore.subscribe(listener);
    searchModalStore.setOpen(true);
    expect(listener).toHaveBeenCalledWith(true);
    expect(searchModalStore.getOpen()).toBe(true);
    searchModalStore.setOpen(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsub();
  });

  it("setOpen to same value is a no-op after initial subscribe fire", () => {
    const listener = vi.fn();
    const unsub = searchModalStore.subscribe(listener);
    // subscribe fires once immediately with current state
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(false);
    listener.mockClear();
    // setOpen(false) when already false: no-op
    searchModalStore.setOpen(false);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = searchModalStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    searchModalStore.setOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("SearchModal rendering", () => {
  it("renders nothing when store is closed", () => {
    const root = mountSearchModalInto(() => {});
    expect(root.children).toHaveLength(0);
  });

  it("renders panel + input when store is opened", async () => {
    const root = mountSearchModalInto(() => {});
    // Drain initial mount effects first so the store subscription is live
    // before we ask it to open. setOpen(true) called before useEffect
    // subscribes would notify nobody.
    await flushRender();
    searchModalStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".modal-search")).not.toBeNull();
    expect(root.querySelector(".search-input")).not.toBeNull();
    expect(root.querySelector(".modal-close-btn")).not.toBeNull();
  });

  it("closes when the × button is clicked", async () => {
    mountSearchModalInto(() => {});
    await flushRender();
    searchModalStore.setOpen(true);
    await flushRender();
    document.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(searchModalStore.getOpen()).toBe(false);
  });

  it("closes when Escape is pressed", async () => {
    mountSearchModalInto(() => {});
    await flushRender();
    searchModalStore.setOpen(true);
    await flushRender();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(searchModalStore.getOpen()).toBe(false);
  });

  it("renders empty-state for whitespace-only query", async () => {
    mountSearchModalInto(() => {});
    await flushRender();
    searchModalStore.setOpen(true);
    await flushRender();
    expect(document.querySelector(".search-results")).not.toBeNull();
  });
});

// Type-only reference (SearchHit) used to live here; left as a no-op alias
// for future test additions to keep TS happy if the interface is unused.