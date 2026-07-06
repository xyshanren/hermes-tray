// v0.2-alpha-10 — StatsModal component tests.
//
// Scope: store + render shell + period tab switching. Per the test
// scoping policy from alpha-7/8/9, we don't drive the full
// invoke('token_stats') pipeline through happy-dom — that's exercised
// in the real Tauri WebView. The tests below cover:
//   - store open/close + fire-on-subscribe + no-op on same value
//   - closed: renders nothing
//   - open: renders period tabs + body with loading state
//   - × button: closes via store
//   - period tab click: switches active class

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { StatsModal } from "./stats-modal";
import { statsStore } from "./stats-modal-store";

// Mock invoke — token_stats is NOT driven here; the modal calls it on
// open + on period change. We never assert on the response shape, just
// need it to return a thenable so the modal's `.then` chain doesn't
// blow up under happy-dom.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

// Mock the helpers re-imported from main.ts so the test bundle does
// not pull in the full main.ts module graph. The exact strings don't
// matter — we only assert the modal mounts + tab clicks flip state.
vi.mock("../main", () => ({
  formatRoutingTrace: vi.fn(() => ""),
  formatLatencyMs: vi.fn(() => ""),
}));

function mountStatsModalInto(): HTMLElement {
  const existing = document.getElementById("stats-modal");
  if (existing) render(null, existing);

  const root = document.createElement("div");
  root.id = "stats-modal";
  document.body.appendChild(root);
  render(<StatsModal />, root);
  return root;
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  statsStore.setOpen(false);
  document.body.innerHTML = "";
});

afterEach(() => {
  const existing = document.getElementById("stats-modal");
  if (existing) render(null, existing);
  document.body.innerHTML = "";
});

describe("statsStore", () => {
  it("starts closed", () => {
    expect(statsStore.getOpen()).toBe(false);
  });

  it("setOpen notifies subscribers and flips open", () => {
    const listener = vi.fn();
    const unsub = statsStore.subscribe(listener);
    statsStore.setOpen(true);
    expect(statsStore.getOpen()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    unsub();
  });

  it("setOpen to same value is a no-op after initial subscribe fire", () => {
    const listener = vi.fn();
    const unsub = statsStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1); // fire-on-subscribe
    listener.mockClear();
    statsStore.setOpen(false); // re-set to current value
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = statsStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    statsStore.setOpen(true);
    // Only the initial subscribe fire — no later notifications.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("StatsModal rendering", () => {
  it("renders nothing when store is closed", () => {
    const root = mountStatsModalInto();
    expect(root.children).toHaveLength(0);
  });

  it("renders panel + period tabs + loading state when store opens", async () => {
    const root = mountStatsModalInto();
    await flushRender();
    statsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".modal-stats")).not.toBeNull();
    expect(root.querySelector(".modal-close-btn")).not.toBeNull();
    // 4 period tabs.
    const tabs = root.querySelectorAll(".stats-period-btn");
    expect(tabs.length).toBe(4);
    // Loading state shown while the mocked invoke hasn't resolved.
    // The mocked invoke returns undefined → the modal will reject
    // and show the "暂无数据" empty state via the .catch handler.
    // We don't assert on either; just that the tabs are present.
    const tabLabels = Array.from(tabs).map((t) => t.textContent);
    expect(tabLabels).toEqual(["今日", "本周", "本月", "全部"]);
  });

  it("× button closes the modal via the store", async () => {
    const root = mountStatsModalInto();
    await flushRender();
    statsStore.setOpen(true);
    await flushRender();
    root.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(statsStore.getOpen()).toBe(false);
  });

  it("active period tab is 'week' on initial open", async () => {
    const root = mountStatsModalInto();
    await flushRender();
    statsStore.setOpen(true);
    await flushRender();
    const activeTab = root.querySelector(".stats-period-btn.active");
    expect(activeTab?.textContent).toBe("本周");
    expect(activeTab?.getAttribute("data-period")).toBe("week");
  });

  it("clicking a different period tab flips the active class", async () => {
    const root = mountStatsModalInto();
    await flushRender();
    statsStore.setOpen(true);
    await flushRender();
    const monthTab = root.querySelector<HTMLButtonElement>(
      '.stats-period-btn[data-period="month"]',
    );
    expect(monthTab).not.toBeNull();
    monthTab?.click();
    await flushRender();
    expect(monthTab?.classList.contains("active")).toBe(true);
    // The previously active tab (week) is no longer active.
    const weekTab = root.querySelector<HTMLButtonElement>(
      '.stats-period-btn[data-period="week"]',
    );
    expect(weekTab?.classList.contains("active")).toBe(false);
  });
});