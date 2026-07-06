// v0.2-alpha-13 — SettingsModal component tests (4-group SVG 11 layout).
//
// Scope: store + 4-group render shell + connection mode toggle +
// preferences (currency/auto_connect/auto_rename/sort_order) +
// danger zone buttons + 测试连接 button state. Per the test scoping
// policy from alpha-7 through alpha-12, we don't drive the full save
// flow through happy-dom — that's exercised in the real Tauri WebView.
//
// Also tests:
//   - src/lib/config-schema.ts: coerceConfigValue + parseBoolPref +
//     formatBoolPref pure functions.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { SettingsModal } from "./settings-modal";
import { settingsStore } from "./settings-modal-store";
import { backupStore } from "./backup-modal-store";
import {
  CONFIG_SCHEMA,
  coerceConfigValue,
  parseBoolPref,
  formatBoolPref,
} from "../lib/config-schema";

// Mock invoke — the modal hits db_config_get (8 keys) + hermes_get_config +
// hermes_list_wsl_distros + hermes_save_config + db_config_set on load/save.
// We mock to never-resolving promises so the load path stays in its
// "fetching" state without blowing up the test.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => new Promise(() => { /* never resolves */ })),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

function mountSettingsModalInto(): HTMLElement {
  const existing = document.getElementById("settings-modal");
  if (existing) render(null, existing);

  const root = document.createElement("div");
  root.id = "settings-modal";
  document.body.appendChild(root);
  render(
    <SettingsModal onDefaultsChanged={() => { /* no-op for tests */ }} />,
    root,
  );
  return root;
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  settingsStore.setOpen(false);
  backupStore.setOpen(false);
  document.body.innerHTML = "";
});

afterEach(() => {
  const existing = document.getElementById("settings-modal");
  if (existing) render(null, existing);
  document.body.innerHTML = "";
});

// ── Store tests (unchanged from alpha-11/12) ────────────────────────────

describe("settingsStore", () => {
  it("starts closed", () => {
    expect(settingsStore.getOpen()).toBe(false);
  });

  it("setOpen notifies subscribers and flips open", () => {
    const listener = vi.fn();
    const unsub = settingsStore.subscribe(listener);
    settingsStore.setOpen(true);
    expect(settingsStore.getOpen()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    unsub();
  });

  it("setOpen to same value is a no-op after initial subscribe fire", () => {
    const listener = vi.fn();
    const unsub = settingsStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    settingsStore.setOpen(false);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = settingsStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    settingsStore.setOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── config-schema tests (alpha-13 new) ──────────────────────────────────

describe("config-schema", () => {
  it("CONFIG_SCHEMA has all expected keys", () => {
    expect(Object.keys(CONFIG_SCHEMA)).toEqual(
      expect.arrayContaining([
        "theme",
        "default_project_path",
        "default_model",
        "currency",
        "auto_connect",
        "auto_rename",
        "sort_order",
      ]),
    );
  });

  it("coerceConfigValue returns default when raw is null/empty", () => {
    expect(coerceConfigValue("theme", null)).toBe("system");
    expect(coerceConfigValue("theme", "")).toBe("system");
    expect(coerceConfigValue("currency", null)).toBe("CNY");
    expect(coerceConfigValue("sort_order", undefined)).toBe("recent");
  });

  it("coerceConfigValue returns raw when in allowedValues", () => {
    expect(coerceConfigValue("currency", "USD")).toBe("USD");
    expect(coerceConfigValue("currency", "model")).toBe("model");
    expect(coerceConfigValue("sort_order", "created")).toBe("created");
  });

  it("coerceConfigValue falls back to default when raw not in allowedValues", () => {
    expect(coerceConfigValue("currency", "EUR")).toBe("CNY");
    expect(coerceConfigValue("sort_order", "garbage")).toBe("recent");
    expect(coerceConfigValue("theme", "purple")).toBe("system");
  });

  it("coerceConfigValue accepts free-form strings for non-enum keys", () => {
    expect(coerceConfigValue("default_project_path", "/home/x")).toBe(
      "/home/x",
    );
    expect(coerceConfigValue("default_model", "gpt-4o")).toBe("gpt-4o");
  });

  it("parseBoolPref + formatBoolPref round-trip", () => {
    expect(parseBoolPref("true")).toBe(true);
    expect(parseBoolPref("false")).toBe(false);
    expect(parseBoolPref(null)).toBe(false);
    expect(parseBoolPref("garbage")).toBe(false);
    expect(formatBoolPref(true)).toBe("true");
    expect(formatBoolPref(false)).toBe("false");
  });
});

// ── 4-group structure (alpha-13) ────────────────────────────────────────

describe("SettingsModal 4-group structure (SVG 11)", () => {
  it("renders nothing when store is closed", () => {
    const root = mountSettingsModalInto();
    expect(root.children).toHaveLength(0);
  });

  it("renders panel + 4 form groups when store opens", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".modal-close-btn")).not.toBeNull();
    const groups = root.querySelectorAll(".settings-group");
    expect(groups.length).toBe(4);
    const titles = Array.from(groups).map((g) =>
      g.querySelector("h3")?.textContent,
    );
    expect(titles).toEqual([
      "连接",
      "新建会话默认值",
      "偏好",
      expect.stringContaining("危险操作区"),
    ]);
  });

  it("the danger-zone group has .settings-danger-zone class", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".settings-danger-zone")).not.toBeNull();
  });
});

// ── 连接 group ──────────────────────────────────────────────────────────

describe("连接 group", () => {
  it("默认 auto 模式：显示 WSL distro + port + URL preview，隐藏 URL 输入框", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-wsl-distro")).not.toBeNull();
    expect(root.querySelector("#setting-port")).not.toBeNull();
    expect(root.querySelector(".settings-url-preview")).not.toBeNull();
    expect(root.querySelector("#setting-gateway-url")).toBeNull();
  });

  it("切到 remote 模式显示 URL 输入框", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    root
      .querySelector<HTMLInputElement>(
        '.settings-mode-toggle input[value="remote"]',
      )
      ?.click();
    await flushRender();
    expect(root.querySelector("#setting-gateway-url")).not.toBeNull();
    expect(root.querySelector("#setting-wsl-distro")).toBeNull();
    expect(root.querySelector("#setting-port")).toBeNull();
  });

  it("连接 group has API Key + 测试连接 button + status badge", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-gateway-api-key")).not.toBeNull();
    expect(root.querySelector(".settings-test-row button")).not.toBeNull();
    expect(root.querySelector(".settings-status")).not.toBeNull();
  });
});

// ── 新建会话默认值 group ────────────────────────────────────────────────

describe("新建会话默认值 group", () => {
  it("has project path + default model inputs", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-default-project-path")).not.toBeNull();
    expect(root.querySelector("#setting-default-model")).not.toBeNull();
  });
});

// ── 偏好 group (alpha-13 new fields) ────────────────────────────────────

describe("偏好 group", () => {
  it("has 主题 segmented with 3 buttons", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const buttons = root.querySelectorAll(
      '[aria-labelledby="setting-theme-label"] .segmented-btn',
    );
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toEqual(["☀️ 浅色", "🌙 深色", "💻 跟随系统"]);
  });

  it("has 费用货币 segmented with 3 options", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const buttons = root.querySelectorAll(
      '[aria-labelledby="setting-currency-label"] .segmented-btn',
    );
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toEqual(["人民币", "美元", "按模型"]);
  });

  it("has 启动时自动连接 + 自动生成会话名 Switch components", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-auto-connect")).not.toBeNull();
    expect(root.querySelector("#setting-auto-rename")).not.toBeNull();
    const switches = root.querySelectorAll('[role="switch"]');
    expect(switches.length).toBe(2);
  });

  it("has 会话列表排序 select with 3 options", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const select = root.querySelector<HTMLSelectElement>("#setting-sort-order");
    expect(select).not.toBeNull();
    const options = Array.from(select!.options).map((o) => o.textContent);
    expect(options).toEqual(["最近活跃", "创建时间", "按名称"]);
  });

  it("clicking the 启动时自动连接 switch toggles its state", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const sw = root.querySelector<HTMLButtonElement>(
      '#setting-auto-connect',
    );
    expect(sw?.getAttribute("aria-checked")).toBe("true"); // default
    sw?.click();
    await flushRender();
    expect(sw?.getAttribute("aria-checked")).toBe("false");
  });
});

// ── 数据危险操作区 (alpha-13) ───────────────────────────────────────────

describe("数据危险操作区 group", () => {
  it("has 4 destructive-action buttons", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      ".settings-danger-btn",
    );
    expect(buttons.length).toBe(4);
    const labels = Array.from(buttons).map((b) =>
      b.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(labels).toEqual([
      expect.stringContaining("创建加密备份"),
      expect.stringContaining("恢复备份"),
      expect.stringContaining("清除所有会话"),
      expect.stringContaining("重置所有设置"),
    ]);
  });

  it("点击 创建加密备份 关闭 settings 并打开 backup modal", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(backupStore.getOpen()).toBe(false);
    const createBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("创建加密备份"));
    createBtn?.click();
    await flushRender();
    expect(settingsStore.getOpen()).toBe(false);
    expect(backupStore.getOpen()).toBe(true);
  });

  it("点击 恢复备份 关闭 settings 并打开 backup modal", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const restoreBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("恢复备份"));
    restoreBtn?.click();
    await flushRender();
    expect(settingsStore.getOpen()).toBe(false);
    expect(backupStore.getOpen()).toBe(true);
  });

  it("点击 清除所有会话 展开 2-step 确认面板 (checkbox + countdown)", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const btn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("清除所有会话"));
    btn?.click();
    await flushRender();
    // 2-step confirmation panel appears.
    const confirmPanel = root.querySelector(".settings-danger-confirm");
    expect(confirmPanel).not.toBeNull();
    expect(confirmPanel?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(confirmPanel?.querySelector(".countdown-confirm")).not.toBeNull();
    // Settings is still open (user has not confirmed yet).
    expect(settingsStore.getOpen()).toBe(true);
  });

  it("点击 重置所有设置 展开 2-step 确认面板", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const btn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("重置所有设置"));
    btn?.click();
    await flushRender();
    const confirmPanel = root.querySelector(".settings-danger-confirm");
    expect(confirmPanel).not.toBeNull();
  });

  it("展开一个确认面板会自动关闭另一个 (互斥)", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const clearBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("清除所有会话"));
    const resetBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("重置所有设置"));
    clearBtn?.click();
    await flushRender();
    expect(root.querySelectorAll(".settings-danger-confirm").length).toBe(1);
    resetBtn?.click();
    await flushRender();
    // Still only 1 panel — opening reset closed clear.
    expect(root.querySelectorAll(".settings-danger-confirm").length).toBe(1);
  });

  it("countdown button 默认 disabled (block=!understand)", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const clearBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("清除所有会话"));
    clearBtn?.click();
    await flushRender();
    const confirmBtn = root.querySelector<HTMLButtonElement>(
      ".settings-danger-confirm .countdown-confirm",
    );
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn?.disabled).toBe(true);
    // Check the "我已了解" checkbox — but countdown is still active.
    const checkbox = root.querySelector<HTMLInputElement>(
      '.settings-danger-confirm input[type="checkbox"]',
    );
    checkbox?.click();
    await flushRender();
    // Countdown is now finished OR counting down. Either way it should
    // not be enabled IMMEDIATELY because the countdown takes 5s.
    // Test will see enabled=false until ~5s; we just verify it has
    // not flipped to enabled immediately.
    expect(confirmBtn?.disabled).toBe(true);
  });

  it("取消按钮关闭确认面板", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const clearBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("清除所有会话"));
    clearBtn?.click();
    await flushRender();
    expect(root.querySelector(".settings-danger-confirm")).not.toBeNull();
    const cancelBtn = root.querySelector<HTMLButtonElement>(
      ".settings-danger-confirm .btn-secondary",
    );
    cancelBtn?.click();
    await flushRender();
    expect(root.querySelector(".settings-danger-confirm")).toBeNull();
  });

  it("确认面板展示 destructive 警告文案", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const resetBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".settings-danger-btn"),
    ).find((b) => b.textContent?.includes("重置所有设置"));
    resetBtn?.click();
    await flushRender();
    const warning = root.querySelector(".settings-danger-warning");
    expect(warning?.textContent).toContain("清空所有偏好设置");
    expect(warning?.textContent).toContain("主题");
  });
});

// ── Modal footer + close handlers ───────────────────────────────────────

describe("Modal footer + close handlers", () => {
  it("modal footer has 取消 + 保存 buttons", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const footerButtons = root.querySelectorAll(".modal-footer button");
    expect(footerButtons.length).toBe(2);
    expect(footerButtons[0].textContent).toBe("取消");
    expect(footerButtons[1].textContent).toBe("保存");
  });

  it("× button closes the modal via the store", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    root.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(settingsStore.getOpen()).toBe(false);
  });

  it("cancel button closes the modal via the store", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    root
      .querySelector<HTMLButtonElement>(".modal-footer .btn-secondary")
      ?.click();
    expect(settingsStore.getOpen()).toBe(false);
  });
});

// ── 测试连接 button (preserved from alpha-12) ──────────────────────────

describe("测试连接 button", () => {
  it("shows '测试中…' label while invoking (remote mode)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(
      () => new Promise(() => { /* hang */ }),
    );

    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    root
      .querySelector<HTMLInputElement>(
        '.settings-mode-toggle input[value="remote"]',
      )
      ?.click();
    await flushRender();
    const urlInput = root.querySelector<HTMLInputElement>(
      "#setting-gateway-url",
    );
    urlInput!.value = "http://192.168.1.100:8642";
    urlInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushRender();
    const testBtn = root.querySelector<HTMLButtonElement>(
      ".settings-test-row button",
    );
    testBtn?.click();
    await flushRender();
    expect(testBtn?.textContent).toContain("测试中");
  });
});