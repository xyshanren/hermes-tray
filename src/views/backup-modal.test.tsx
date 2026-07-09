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
import { act } from "preact/test-utils";
import { BackupModal, PasswordInput, passwordStrength } from "./backup-modal";
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

// v0.2-alpha-32 — mock the new Tauri dialog plugin so file-picker
// button clicks don't try to actually open a native dialog in
// happy-dom (which has no NSWindow).
const mockSaveDialog = vi.fn();
const mockOpenDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => mockSaveDialog(...args),
  open: (...args: unknown[]) => mockOpenDialog(...args),
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
    expect(root.querySelector(".countdown-confirm")).not.toBeNull(); // countdown btn
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
    const btn = root.querySelector<HTMLButtonElement>(".countdown-confirm");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toMatch(/请等待\s*5\s*s/);
  });
});

// v0.2-alpha-32 — the create + restore cards now have a "browse"
// button next to the path input that calls the Tauri dialog plugin
// (saveDialog for create, openDialog for restore). Tests verify:
//   1) the buttons exist in the rendered output
//   2) clicking them invokes the correct dialog function
//   3) a returned path populates the input + (for restore) clears
//      the verified state
describe("file-picker browse buttons (alpha-32)", () => {
  beforeEach(() => {
    mockSaveDialog.mockReset();
    mockOpenDialog.mockReset();
  });

  it("create card has a browse button that opens saveDialog", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    const browseButtons = root.querySelectorAll<HTMLButtonElement>(
      ".backup-path-browse",
    );
    expect(browseButtons.length).toBe(2); // one for create, one for restore
    // First button is the create card's browse.
    const createBrowse = browseButtons[0];
    expect(createBrowse.textContent).toMatch(/浏览/);
    mockSaveDialog.mockResolvedValueOnce("/tmp/hermes-2026-07-09.htbk");
    createBrowse.click();
    expect(mockSaveDialog).toHaveBeenCalledTimes(1);
    expect(mockSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "选择备份输出路径",
        filters: expect.arrayContaining([
          expect.objectContaining({ name: "Hermes Backup", extensions: ["htbk"] }),
        ]),
      }),
    );
    // After the resolved promise microtask, the input is populated.
    await flushRender();
    const createInput = root.querySelector<HTMLInputElement>(
      "#backup-create-path",
    );
    expect(createInput?.value).toBe("/tmp/hermes-2026-07-09.htbk");
  });

  it("restore card has a browse button that opens openDialog", async () => {
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    const browseButtons = root.querySelectorAll<HTMLButtonElement>(
      ".backup-path-browse",
    );
    const restoreBrowse = browseButtons[1];
    expect(restoreBrowse.textContent).toMatch(/打开/);
    mockOpenDialog.mockResolvedValueOnce("/backup/old.htbk");
    restoreBrowse.click();
    expect(mockOpenDialog).toHaveBeenCalledTimes(1);
    expect(mockOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "选择要恢复的备份",
        multiple: false,
        directory: false,
        filters: expect.arrayContaining([
          expect.objectContaining({ name: "Hermes Backup", extensions: ["htbk"] }),
        ]),
      }),
    );
    await flushRender();
    const restoreInput = root.querySelector<HTMLInputElement>(
      "#backup-restore-path",
    );
    expect(restoreInput?.value).toBe("/backup/old.htbk");
  });

  it("browse buttons are keyboard-accessible (type=button)", async () => {
    // They must NOT submit the form by accident. native <button>
    // defaults to type="submit" inside a <form>, which would
    // navigate. The JSX explicitly sets type="button" on both —
    // verify that the DOM preserves it.
    const root = mountBackupModalInto();
    await flushRender();
    backupStore.setOpen(true);
    await flushRender();
    const browseButtons = root.querySelectorAll<HTMLButtonElement>(
      ".backup-path-browse",
    );
    expect(browseButtons.length).toBeGreaterThan(0);
    for (const btn of browseButtons) {
      expect(btn.getAttribute("type")).toBe("button");
    }
  });
});

// v0.2-alpha-32.2 — 3 issues found during manual Tauri verification
// of alpha-32:
//   1) WebView2/Edge ships a built-in password reveal icon
//      (`::-ms-reveal`) that shows to the right of our custom eye
//      button, producing two stacked icons. The CSS fix lives in
//      styles.css (cannot be unit-tested in happy-dom — visual
//      regression lives with manual verification + the design SVG
//      page 03/04 in hermes-tray-notes).
//   2) "两次密码不一致" fired on the first password input the moment
//      value reached any non-empty length, even if the confirm field
//      was untouched. Fix: only flag mismatch when BOTH sides are
//      >= 8 chars (same floor as the strength meter).
//   3) Opening the backup modal from settings closed settings first,
//      so closing backup dropped the user back on chat. Fix: keep
//      settings open and layer the backup modal above (z-index
//      bumped in styles.css); settings-modal.tsx no longer calls
//      settingsStore.setOpen(false) in handleBackupCreate/Restore.
describe("alpha-32.2 hotfix", () => {
  function mountPasswordInput(
    props: Partial<{
      value: string;
      confirmValue?: string;
      showStrength?: boolean;
      onInput: (v: string) => void;
    }> = {},
  ): { root: HTMLElement; last: string } {
    const last = { current: props.value ?? "" };
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(
      <PasswordInput
        id="test-pw"
        label="密码"
        value={props.value ?? ""}
        placeholder=""
        showStrength={props.showStrength ?? true}
        confirmValue={props.confirmValue}
        onInput={(v) => {
          last.current = v;
        }}
      />,
      root,
    );
    return { root, get last() { return last.current; } } as { root: HTMLElement; last: string };
  }

  it("mismatch stays hidden when first input is 8 chars and confirm is empty", async () => {
    // v0.2-alpha-32 bug: typing 8 chars in the first box would
    // immediately show "两次密码不一致" before the user touched the
    // confirm box. The fix is to require BOTH sides to have >= 8
    // chars before comparing.
    const { root } = mountPasswordInput({
      value: "12345678",
      confirmValue: "",
      showStrength: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const strength = root.querySelector(".password-strength");
    expect(strength).not.toBeNull();
    expect(strength?.getAttribute("data-mismatch")).toBe("false");
    expect(root.querySelector(".password-strength-label")?.textContent)
      .not.toMatch(/两次密码不一致/);
  });

  it("mismatch shows when both inputs are >= 8 chars and differ", async () => {
    const { root } = mountPasswordInput({
      value: "12345678",
      confirmValue: "87654321",
      showStrength: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const strength = root.querySelector(".password-strength");
    expect(strength?.getAttribute("data-mismatch")).toBe("true");
    expect(root.querySelector(".password-strength-label")?.textContent)
      .toMatch(/两次密码不一致/);
  });

  it("mismatch stays hidden when both inputs are >= 8 chars and equal", async () => {
    const { root } = mountPasswordInput({
      value: "12345678",
      confirmValue: "12345678",
      showStrength: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const strength = root.querySelector(".password-strength");
    expect(strength?.getAttribute("data-mismatch")).toBe("false");
    expect(root.querySelector(".password-strength-label")?.textContent)
      .not.toMatch(/两次密码不一致/);
  });

  it("PasswordInput renders exactly one .password-eye button (no double icon)", async () => {
    // The double-icon issue is the native ::-ms-reveal pseudo from
    // WebView2 — it can't be tested in happy-dom (no native chrome).
    // What we CAN verify is that the JSX produces exactly one custom
    // eye button per input, so once the CSS fix lands the user sees
    // one icon total. (settings-modal also uses PasswordInput.)
    const { root } = mountPasswordInput({ value: "abc" });
    await act(async () => {
      await Promise.resolve();
    });
    const eyes = root.querySelectorAll(".password-eye");
    expect(eyes.length).toBe(1);
    // And the eye button is type=button so it won't submit a form.
    expect(eyes[0]?.getAttribute("type")).toBe("button");
  });
});