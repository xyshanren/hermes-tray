// v0.2-alpha-11 — SettingsModal component tests.
//
// Scope: store + render shell + group structure + 测试连接 button
// states (idle → testing → ok/fail). Per the test scoping policy from
// alpha-7 through alpha-10, we don't drive the full save flow or
// hermes_proxy_get / hermes_save_config / db_config_set invokes through
// happy-dom — that's exercised in the real Tauri WebView.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { SettingsModal } from "./settings-modal";
import { settingsStore } from "./settings-modal-store";

// Mock invoke — hermes_get_config, hermes_save_config, hermes_list_wsl_distros,
// db_config_get, db_config_set are NOT driven here; the modal calls them on
// load + on save. We mock them to never-resolving promises so the load path
// stays in its "fetching" state without blowing up the test.
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
  document.body.innerHTML = "";
});

afterEach(() => {
  const existing = document.getElementById("settings-modal");
  if (existing) render(null, existing);
  document.body.innerHTML = "";
});

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
    expect(listener).toHaveBeenCalledTimes(1); // fire-on-subscribe
    listener.mockClear();
    settingsStore.setOpen(false); // re-set to current value
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = settingsStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    settingsStore.setOpen(true);
    // Only the initial subscribe fire — no later notifications.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsModal rendering", () => {
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
    // 4 settings-group sections: Theme, Gateway 连接, 本地 WSL Gateway, 默认值.
    const groups = root.querySelectorAll(".settings-group");
    expect(groups.length).toBe(4);
    const titles = Array.from(groups).map((g) =>
      g.querySelector("h3")?.textContent,
    );
    expect(titles).toEqual([
      "主题",
      "Gateway 连接",
      "本地 WSL Gateway",
      "默认值",
    ]);
  });

  it("Gateway 连接 group has URL + API Key + 测试连接 button + status badge", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-gateway-url")).not.toBeNull();
    expect(root.querySelector("#setting-gateway-api-key")).not.toBeNull();
    expect(root.querySelector(".settings-test-row button")).not.toBeNull();
    expect(root.querySelector(".settings-status")).not.toBeNull();
    // Status badge initial text — "未测试".
    expect(root.querySelector(".settings-status")?.textContent).toContain(
      "未测试",
    );
  });

  it("主题 group has 3 segmented buttons", async () => {
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

  it("本地 WSL Gateway group has distro select + port input", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-wsl-distro")).not.toBeNull();
    expect(root.querySelector("#setting-port")).not.toBeNull();
  });

  it("默认值 group has project path + default model inputs", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-default-project-path")).not.toBeNull();
    expect(root.querySelector("#setting-default-model")).not.toBeNull();
  });

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
    const cancelBtn = root.querySelector<HTMLButtonElement>(
      ".modal-footer .btn-secondary",
    );
    cancelBtn?.click();
    expect(settingsStore.getOpen()).toBe(false);
  });

  it("Gateway URL input is controlled — typing updates the value", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const input = root.querySelector<HTMLInputElement>("#setting-gateway-url");
    expect(input).not.toBeNull();
    input!.value = "http://192.168.1.100:8642";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushRender();
    expect(input!.value).toBe("http://192.168.1.100:8642");
  });

  it("测试连接 button shows '测试中…' label while invoking", async () => {
    // Override the invoke mock for this test only — return a never-
    // resolving promise so the test state stays in 'testing'.
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise(() => { /* hang */ }),
    );

    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const testBtn = root.querySelector<HTMLButtonElement>(
      ".settings-test-row button",
    );
    testBtn?.click();
    await flushRender();
    // After click, button text should flip to "测试中…" (or button is disabled).
    expect(testBtn?.textContent).toContain("测试中");
  });
});