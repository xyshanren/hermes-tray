// v0.2-alpha-19 — ConfirmModal store + render shell tests.
//
// We cover the store mutators + the Preact render shell + the
// Promise-based requestConfirm API. We do NOT drive the danger-zone
// confirm in settings (it's still a stub toast — alpha-19 only
// migrates the session-delete call site).

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import {
  confirmStore,
  requestConfirm,
} from "./confirm-modal-store";
import { ConfirmModal } from "./confirm-modal-view";

function mountView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(<ConfirmModal />, host);
  return host;
}

// ── store ──────────────────────────────────────────────────────────────────

describe("confirmStore", () => {
  beforeEach(() => {
    confirmStore.__resetForTests();
  });

  it("starts with no pending request", () => {
    expect(confirmStore.get().pending).toBeNull();
  });

  it("subscribe fires immediately with the current state", () => {
    let seen = confirmStore.get();
    const unsub = confirmStore.subscribe((s) => (seen = s));
    expect(seen.pending).toBeNull();
    unsub();
  });

  it("resolve is a no-op when no request is pending", () => {
    confirmStore.resolve(true);
    expect(confirmStore.get().pending).toBeNull();
  });
});

describe("requestConfirm (Promise-based API)", () => {
  beforeEach(() => {
    confirmStore.__resetForTests();
  });

  it("resolves true when the user confirms", async () => {
    const promise = requestConfirm({
      title: "删除会话",
      message: "确定删除此会话？",
      danger: true,
    });
    // The store now has a pending request.
    expect(confirmStore.get().pending).not.toBeNull();
    expect(confirmStore.get().pending?.title).toBe("删除会话");
    expect(confirmStore.get().pending?.danger).toBe(true);
    // Simulate the user clicking Confirm.
    confirmStore.resolve(true);
    await expect(promise).resolves.toBe(true);
    expect(confirmStore.get().pending).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    const promise = requestConfirm({
      title: "Test",
      message: "Proceed?",
    });
    confirmStore.resolve(false);
    await expect(promise).resolves.toBe(false);
  });

  it("resolves false on × close (which calls resolve(false))", async () => {
    const promise = requestConfirm({ title: "T", message: "M" });
    confirmStore.resolve(false);
    await expect(promise).resolves.toBe(false);
  });

  it("a second requestConfirm cancels the first (resolves false) before opening the new one", async () => {
    const first = requestConfirm({ title: "first", message: "1" });
    const second = requestConfirm({ title: "second", message: "2" });
    await expect(first).resolves.toBe(false);
    // The second is still pending; resolve it cleanly.
    confirmStore.resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it("passes through custom confirm + cancel labels", () => {
    void requestConfirm({
      title: "T",
      message: "M",
      confirmLabel: "立即删除",
      cancelLabel: "再想想",
    });
    const p = confirmStore.get().pending;
    expect(p?.confirmLabel).toBe("立即删除");
    expect(p?.cancelLabel).toBe("再想想");
  });
});

// ── render shell ──────────────────────────────────────────────────────────

describe("<ConfirmModal /> (render shell)", () => {
  beforeEach(() => {
    confirmStore.__resetForTests();
    document.body.innerHTML = "";
  });

  it("renders nothing when no request is pending", () => {
    const host = mountView();
    expect(host.querySelector(".modal-confirm")).toBeNull();
  });

  it("renders the modal with title + message + buttons when pending", async () => {
    const host = mountView();
    void requestConfirm({ title: "删除会话", message: "确定删除？", danger: true });
    // Preact re-render — let the subscription flush.
    await new Promise((r) => setTimeout(r, 10));
    const modal = host.querySelector(".modal-confirm");
    expect(modal).not.toBeNull();
    expect(modal!.querySelector("h2")!.textContent).toBe("删除会话");
    expect(modal!.querySelector(".confirm-message")!.textContent).toContain("确定删除");
    // danger button class for the AGENTS.md §4 destructive style.
    const confirmBtn = modal!.querySelector(".btn-danger") as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn.textContent).toBe("确认");
    const cancelBtn = modal!.querySelector(".btn-secondary") as HTMLButtonElement;
    expect(cancelBtn.textContent).toBe("取消");
  });

  it("clicking the Confirm button resolves true via the store", async () => {
    const host = mountView();
    const promise = requestConfirm({ title: "T", message: "M" });
    await new Promise((r) => setTimeout(r, 10));
    const confirmBtn = host.querySelector(".btn-primary") as HTMLButtonElement;
    confirmBtn.click();
    await expect(promise).resolves.toBe(true);
    expect(confirmStore.get().pending).toBeNull();
  });

  it("clicking the Cancel button resolves false via the store", async () => {
    const host = mountView();
    const promise = requestConfirm({ title: "T", message: "M" });
    await new Promise((r) => setTimeout(r, 10));
    const cancelBtn = host.querySelector(".btn-secondary") as HTMLButtonElement;
    cancelBtn.click();
    await expect(promise).resolves.toBe(false);
  });

  it("clicking × resolves false", async () => {
    const host = mountView();
    const promise = requestConfirm({ title: "T", message: "M" });
    await new Promise((r) => setTimeout(r, 10));
    const closeBtn = host.querySelector(".modal-close-btn") as HTMLButtonElement;
    closeBtn.click();
    await expect(promise).resolves.toBe(false);
  });

  it("Escape key resolves false", async () => {
    mountView();
    const promise = requestConfirm({ title: "T", message: "M" });
    await new Promise((r) => setTimeout(r, 10));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(promise).resolves.toBe(false);
  });

  it("non-danger confirm uses btn-primary class (not btn-danger)", async () => {
    const host = mountView();
    void requestConfirm({ title: "T", message: "M", danger: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(host.querySelector(".btn-primary")).not.toBeNull();
    expect(host.querySelector(".btn-danger")).toBeNull();
  });
});