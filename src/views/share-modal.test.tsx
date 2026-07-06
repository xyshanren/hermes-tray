// v0.2-alpha-15 — share-flow pure helpers + share-modal Preact tests.
//
// Scope:
//   - validateShareHash pure function (no DOM, no Tauri, no clipboard).
//   - shareStore pub-sub (fire-on-subscribe, no-op on same value).
//   - ShareImportModal render shell (open/close via store).
//
// Per the test scoping policy from alpha-7 onwards, the full import
// pipeline (executeShareImport + invoke + clipboard) is exercised in
// the real Tauri WebView, not through happy-dom.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { ShareImportModal } from "./share-modal";
import { shareStore } from "./share-modal-store";
import { validateShareHash } from "./share-flow";
import {
  encodeShareDoc,
  buildShareUrl,
} from "../shareLink";

// Mock invoke + showToast — executeShareImport is NOT driven here.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

function mountShareImportModalInto(): HTMLElement {
  const existing = document.getElementById("share-import-modal");
  if (existing) render(null, existing);

  const root = document.createElement("div");
  root.id = "share-import-modal";
  document.body.appendChild(root);
  render(<ShareImportModal />, root);
  return root;
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  shareStore.setPending(null);
  document.body.innerHTML = "";
});

afterEach(() => {
  const existing = document.getElementById("share-import-modal");
  if (existing) render(null, existing);
  document.body.innerHTML = "";
});

// ── validateShareHash pure function tests ──────────────────────────────

describe("validateShareHash", () => {
  it("returns decode-failed for non-share hash", () => {
    const result = validateShareHash("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decode-failed");
  });

  it("returns decode-failed for malformed base64url payload", () => {
    // #share= prefix but invalid payload.
    const result = validateShareHash("#share=@@@not-base64@@@");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decode-failed");
  });

  it("returns unsupported-version for doc.version !== 1", () => {
    const doc = { version: 2, session: { id: "s1", title: "t" }, messages: [] };
    // Extract just the hash from the full URL — validateShareHash
    // expects window.location.hash format (`#share=...`), not a full URL.
    const url = buildShareUrl(encodeShareDoc(doc), "https://x.com", "/");
    const hash = url.substring(url.indexOf("#"));
    const result = validateShareHash(hash);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unsupported-version");
      expect(result.version).toBe(2);
    }
  });

  it("returns ok=true for valid version-1 ShareDoc", () => {
    const doc = {
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [{ role: "user", content: "hi" }],
    };
    const url = buildShareUrl(encodeShareDoc(doc), "https://x.com", "/");
    const hash = url.substring(url.indexOf("#"));
    const result = validateShareHash(hash);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.version).toBe(1);
      expect(result.doc.session.title).toBe("Test");
      expect(result.doc.messages.length).toBe(1);
    }
  });

  it("returns decode-failed for valid base64 but invalid JSON", () => {
    // Encode non-JSON string as a share fragment.
    const hash = "#share=" + "bm90LWpzb24="; // base64url("not-json")
    const result = validateShareHash(hash);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decode-failed");
  });
});

// ── shareStore pub-sub tests ────────────────────────────────────────────

describe("shareStore", () => {
  it("starts with pending=null", () => {
    expect(shareStore.get().pending).toBe(null);
    expect(shareStore.get().isImporting).toBe(false);
  });

  it("setPending notifies subscribers and stores the doc", () => {
    const listener = vi.fn();
    const unsub = shareStore.subscribe(listener);
    const doc = { version: 1, session: { id: "x", title: "t" }, messages: [] };
    shareStore.setPending(doc);
    expect(shareStore.get().pending).toBe(doc);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ pending: doc, isImporting: false }),
    );
    unsub();
  });

  it("setPending(null) clears pending", () => {
    shareStore.setPending({
      version: 1,
      session: { id: "x", title: "t" },
      messages: [],
    });
    shareStore.setPending(null);
    expect(shareStore.get().pending).toBe(null);
  });

  it("setImporting toggles the in-flight flag without touching pending", () => {
    const doc = { version: 1, session: { id: "x", title: "t" }, messages: [] };
    shareStore.setPending(doc);
    shareStore.setImporting(true);
    expect(shareStore.get().isImporting).toBe(true);
    expect(shareStore.get().pending).toBe(doc);
    shareStore.setImporting(false);
    expect(shareStore.get().isImporting).toBe(false);
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = shareStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    shareStore.setPending({
      version: 1,
      session: { id: "x", title: "t" },
      messages: [],
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── ShareImportModal rendering tests ────────────────────────────────────

describe("ShareImportModal rendering", () => {
  it("renders nothing when pending is null", () => {
    const root = mountShareImportModalInto();
    expect(root.children).toHaveLength(0);
  });

  it("renders modal with title + message count when pending is set", async () => {
    mountShareImportModalInto();
    // Drain initial mount effects first so the store subscription is live
    // before we ask it to open. setPending called before useEffect would
    // notify nobody (matches the search-modal.test.tsx pattern).
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Imported Session" },
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "how are you?" },
      ],
    });
    await flushRender();
    const root = document.getElementById("share-import-modal")!;
    expect(root.querySelector(".modal-share-import")).not.toBeNull();
    // Two .share-import-value elements: title + message count.
    const values = root.querySelectorAll(".share-import-value");
    expect(values.length).toBe(2);
    const allText = Array.from(values).map((v) => v.textContent).join("|");
    expect(allText).toContain("Imported Session");
    expect(allText).toContain("3");
  });

  it("modal footer has 取消 + 导入 buttons", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [{ role: "user", content: "hi" }],
    });
    await flushRender();
    const root = document.getElementById("share-import-modal")!;
    const footerButtons = root.querySelectorAll(".modal-footer button");
    expect(footerButtons.length).toBe(2);
    expect(footerButtons[0].textContent).toBe("取消");
    expect(footerButtons[1].textContent).toContain("导入");
  });

  it("clicking 取消 clears pending via the store", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [],
    });
    await flushRender();
    expect(shareStore.get().pending).not.toBeNull();
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      ".modal-footer .btn-secondary",
    );
    cancelBtn?.click();
    expect(shareStore.get().pending).toBeNull();
  });

  it("× button also clears pending via the store", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [],
    });
    await flushRender();
    document.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(shareStore.get().pending).toBeNull();
  });

  it("shows first 2 messages as preview (truncated to 120 chars)", async () => {
    mountShareImportModalInto();
    await flushRender();
    const longContent = "x".repeat(200);
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [
        { role: "user", content: longContent },
        { role: "assistant", content: "short reply" },
        { role: "user", content: "third message NOT shown" },
      ],
    });
    await flushRender();
    const root = document.getElementById("share-import-modal")!;
    const messages = root.querySelectorAll(".share-import-msg");
    // Only first 2 messages shown.
    expect(messages.length).toBe(2);
    // First message truncated to 120 chars + ellipsis.
    expect(messages[0].textContent).toContain("x".repeat(120));
    expect(messages[0].textContent).toContain("…");
    expect(messages[0].textContent).not.toContain("x".repeat(121));
    // Second message not truncated.
    expect(messages[1].textContent).toContain("short reply");
    expect(messages[1].textContent).not.toContain("…");
  });

  it("shows warning text about [分享] prefix + dropped persona/project", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [],
    });
    await flushRender();
    const warning = document.querySelector(".share-import-warning");
    expect(warning?.textContent).toContain("[分享]");
    expect(warning?.textContent).toContain("persona");
  });

  it("import button label includes message count", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    });
    await flushRender();
    const importBtn = document.querySelector<HTMLButtonElement>(
      ".modal-footer .btn-primary",
    );
    expect(importBtn?.textContent).toContain("2 条消息");
  });

  it("import button shows '导入中…' while isImporting=true", async () => {
    mountShareImportModalInto();
    await flushRender();
    shareStore.setPending({
      version: 1,
      session: { id: "s1", title: "Test" },
      messages: [{ role: "user", content: "a" }],
    });
    await flushRender();
    shareStore.setImporting(true);
    await flushRender();
    const importBtn = document.querySelector<HTMLButtonElement>(
      ".modal-footer .btn-primary",
    );
    expect(importBtn?.textContent).toContain("导入中");
    expect(importBtn?.disabled).toBe(true);
  });
});