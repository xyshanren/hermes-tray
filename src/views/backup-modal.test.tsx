// v0.2-alpha-9 — BackupModal component tests.
//
// Scope: store + render shell + 2-step restore confirmation flow.
//
// Per the test scoping policy from alpha-7/8 (search-modal.test.tsx + persona-modal.test.tsx),
// we deliberately avoid driving the full CRUD pipeline (backup_create /
// backup_verify / backup_restore invokes + toast chains) through Preact +
// happy-dom. The form fields and command calls are exercised in the real
// Tauri WebView; what we cover here is the contract the rest of the app
// depends on: store notifications, render shell, × button, 2-step
// confirmation gating.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { BackupModal, passwordStrength } from "./backup-modal";
import { backupStore } from "./backup-modal-store";

// Mock invoke — backup_create / backup_verify / backup_restore are NOT
// driven here; the modal calls them in response to user actions that we
// don't simulate in this test set.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

function mountBackupModalInto(): HTMLElement {
  // Remove any leftover root from a previous test.
  const existing = document.getElementById("backup-modal");
  if (existing) render(null, existing);

  const root = document.createElement("div");
  root.id = "backup-modal";
  document.body.appendChild(root);
  render(<BackupModal />, root);
  return root;
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  backupStore.setOpen(false); // reset to closed
  document.body.innerHTML = "";
});

afterEach(() => {
  const existing = document.getElementById("backup-modal");
  if (existing) render(null, existing);
  document.body.innerHTML = "";
});

describe("backupStore", () => {
  it("starts closed", () => {
    expect(backupStore.getOpen()).toBe(false);
  });

  it("setOpen notifies subscribers and flips open", () => {
    const listener = vi.fn();
    const unsub = backupStore.subscribe(listener);
    backupStore.setOpen(true);
    expect(backupStore.getOpen()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    unsub();
  });

  it("setOpen to same value is a no-op after initial subscribe fire", () => {
    const listener = vi.fn();
    const unsub = backupStore.subscribe(listener);
    // subscribe fires once immediately (fire-on-subscribe)
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    // Re-set to current value → no notification
    backupStore.setOpen(false);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = backupStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    backupStore.setOpen(true);
    // Still just the initial subscribe fire — no later notifications.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("passwordStrength", () => {
  it("returns 0 for empty / short input", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("1234567")).toBe(0);
  });

  it("returns 1 for length>=8 but no character-class diversity", () => {
    expect(passwordStrength("aaaaaaaa")).toBe(1);
  });

  it("returns 2 for mixed case + length", () => {
    expect(passwordStrength("AaAaAaAa")).toBe(2);
  });

  it("returns 3 when digits are added", () => {
    expect(passwordStrength("AaAaAa1a")).toBe(3);
  });

  it("returns 4 when a special character is added", () => {
    expect(passwordStrength("AaAaAa1!")).toBe(4);
  });

  it("caps at 4 even with extra character classes", () => {
    expect(passwordStrength("Aa1!Bb2@")).toBeLessThanOrEqual(4);
  });
});

describe("BackupModal rendering", () => {
  it("renders nothing when store is closed", () => {
    const root = mountBackupModalInto();
    expect(root.children).toHaveLength(0);
  });

  it("renders both create + restore cards when store opens", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    // Two cards stacked (separation cards, NOT tabs).
    const cards = root.querySelectorAll(".backup-card");
    expect(cards.length).toBe(2);
    // The first card is the create card.
    expect(cards[0].classList.contains("backup-card-danger")).toBe(false);
    // The second card has the danger outline.
    expect(cards[1].classList.contains("backup-card-danger")).toBe(true);
  });

  it("create card has path input + 2 password inputs + strength meter", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#backup-create-path")).not.toBeNull();
    expect(root.querySelector("#backup-create-password")).not.toBeNull();
    expect(root.querySelector("#backup-create-password-confirm")).not.toBeNull();
    // Strength meter only appears for the create password (showStrength).
    expect(root.querySelector(".password-strength")).not.toBeNull();
  });

  it("restore card has path + password + verify button + countdown button + checkbox", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#backup-restore-path")).not.toBeNull();
    expect(root.querySelector("#backup-restore-password")).not.toBeNull();
    expect(root.querySelector(".btn-secondary")).not.toBeNull(); // verify btn
    expect(root.querySelector(".backup-confirm")).not.toBeNull(); // countdown btn
    expect(root.querySelector(".backup-confirm-row input[type=checkbox]")).not.toBeNull();
  });

  it("× button closes the modal via the store", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    root.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(backupStore.getOpen()).toBe(false);
  });

  it("countdown button starts disabled with a waiting label", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    const btn = root.querySelector<HTMLButtonElement>(".backup-confirm");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toMatch(/请等待\s*5\s*s/);
  });
});