// v0.2-alpha-12 — SettingsModal component tests (unified Gateway group).
//
// Scope: store + 3-group render shell + radio toggle (auto/remote) +
// autoUrlPreview + 测试连接 button states. Per the test scoping policy
// from alpha-7 through alpha-11, we don't drive the full save flow or
// invoke pipeline through happy-dom — that's exercised in the real
// Tauri WebView.

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

describe("SettingsModal rendering (3-group structure)", () => {
  it("renders nothing when store is closed", () => {
    const root = mountSettingsModalInto();
    expect(root.children).toHaveLength(0);
  });

  it("renders panel + 3 form groups when store opens", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".modal-close-btn")).not.toBeNull();
    // 3 settings-group sections: 主题, Gateway 连接, 默认值.
    const groups = root.querySelectorAll(".settings-group");
    expect(groups.length).toBe(3);
    const titles = Array.from(groups).map((g) =>
      g.querySelector("h3")?.textContent,
    );
    expect(titles).toEqual(["主题", "Gateway 连接", "默认值"]);
  });

  it("Gateway 连接 group has mode toggle + API Key + 测试连接 button + status badge", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    // Radio toggle for mode (auto / remote).
    const radios = root.querySelectorAll(
      '.settings-mode-toggle input[type="radio"]',
    );
    expect(radios.length).toBe(2);
    // API Key field — always visible.
    expect(root.querySelector("#setting-gateway-api-key")).not.toBeNull();
    // Test button + status badge.
    expect(root.querySelector(".settings-test-row button")).not.toBeNull();
    expect(root.querySelector(".settings-status")).not.toBeNull();
  });
});

describe("Gateway 连接 auto mode (default)", () => {
  it("默认进入 auto 模式", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const radios = root.querySelectorAll<HTMLInputElement>(
      '.settings-mode-toggle input[type="radio"]',
    );
    expect(radios[0].value).toBe("auto");
    expect(radios[0].checked).toBe(true);
    expect(radios[1].value).toBe("remote");
    expect(radios[1].checked).toBe(false);
  });

  it("auto 模式显示 WSL 发行版 + 端口 + URL 预览，隐藏 URL 输入框", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-wsl-distro")).not.toBeNull();
    expect(root.querySelector("#setting-port")).not.toBeNull();
    expect(root.querySelector(".settings-url-preview")).not.toBeNull();
    // URL input only renders in remote mode.
    expect(root.querySelector("#setting-gateway-url")).toBeNull();
  });

  it("auto 模式的 URL 预览显示当前 tray 解析的 URL", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const preview = root.querySelector(".settings-url-preview code");
    expect(preview).not.toBeNull();
    // default state.ts gatewayUrl is empty, so preview falls back to
    // "(未解析)" — verifies the preview surfaces real state.
    expect(preview?.textContent).toBe("(未解析)");
  });
});

describe("Gateway 连接 remote mode", () => {
  it("点击 remote radio 切换到 remote 模式，显示 URL 输入框", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const remoteRadio = root.querySelector<HTMLInputElement>(
      '.settings-mode-toggle input[value="remote"]',
    );
    remoteRadio?.click();
    await flushRender();
    // URL input appears.
    expect(root.querySelector("#setting-gateway-url")).not.toBeNull();
    // WSL distro + port hidden in remote mode.
    expect(root.querySelector("#setting-wsl-distro")).toBeNull();
    expect(root.querySelector("#setting-port")).toBeNull();
    // URL preview hidden in remote mode (only auto mode shows it).
    expect(root.querySelector(".settings-url-preview")).toBeNull();
  });

  it("remote 模式 URL 输入框可输入", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    const remoteRadio = root.querySelector<HTMLInputElement>(
      '.settings-mode-toggle input[value="remote"]',
    );
    remoteRadio?.click();
    await flushRender();
    const input = root.querySelector<HTMLInputElement>("#setting-gateway-url");
    expect(input).not.toBeNull();
    input!.value = "http://192.168.1.100:8642";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushRender();
    expect(input!.value).toBe("http://192.168.1.100:8642");
  });

  it("切回 auto 模式再次显示 WSL distro + port + URL preview", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    // Switch to remote.
    root
      .querySelector<HTMLInputElement>(
        '.settings-mode-toggle input[value="remote"]',
      )
      ?.click();
    await flushRender();
    // Switch back to auto.
    root
      .querySelector<HTMLInputElement>(
        '.settings-mode-toggle input[value="auto"]',
      )
      ?.click();
    await flushRender();
    expect(root.querySelector("#setting-wsl-distro")).not.toBeNull();
    expect(root.querySelector("#setting-port")).not.toBeNull();
    expect(root.querySelector(".settings-url-preview")).not.toBeNull();
    expect(root.querySelector("#setting-gateway-url")).toBeNull();
  });
});

describe("主题 group", () => {
  it("has 3 segmented buttons", async () => {
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
});

describe("默认值 group", () => {
  it("has project path + default model inputs", async () => {
    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    expect(root.querySelector("#setting-default-project-path")).not.toBeNull();
    expect(root.querySelector("#setting-default-model")).not.toBeNull();
  });
});

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
    const cancelBtn = root.querySelector<HTMLButtonElement>(
      ".modal-footer .btn-secondary",
    );
    cancelBtn?.click();
    expect(settingsStore.getOpen()).toBe(false);
  });
});

describe("测试连接 button", () => {
  it("shows '测试中…' label while invoking (remote mode)", async () => {
    // Override the invoke mock for this test only — return a never-
    // resolving promise so the test state stays in 'testing'.
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(
      () => new Promise(() => { /* hang */ }),
    );

    const root = mountSettingsModalInto();
    await flushRender();
    settingsStore.setOpen(true);
    await flushRender();
    // Switch to remote mode and fill in a URL so handleTestConnection
    // skips the resolveGatewayUrl() call (which would also hit invoke).
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
    // After click, button text should flip to "测试中…".
    expect(testBtn?.textContent).toContain("测试中");
  });
});