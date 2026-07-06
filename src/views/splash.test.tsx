// v0.2-alpha-19 — Splash store + view tests.
//
// We cover the progress clamping + status + hide mutators + the
// Preact render shell (visible vs hidden). The boot-time progress
// sequencing is wired in main.ts (DOMContentLoaded) and is exercised
// in the real Tauri WebView.

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { splashStore } from "./splash-store";
import { SplashScreen } from "./splash-view";

// ── store ──────────────────────────────────────────────────────────────────

describe("splashStore", () => {
  beforeEach(() => {
    splashStore.__resetForTests();
  });

  it("starts with progress=0 + status='连接 Hermes Gateway...' + visible=true", () => {
    const s = splashStore.get();
    expect(s.progress).toBe(0);
    expect(s.status).toBe("连接 Hermes Gateway...");
    expect(s.visible).toBe(true);
  });

  it("setProgress clamps to 0..100 and notifies", () => {
    let seen = 0;
    const unsub = splashStore.subscribe((s) => (seen = s.progress));
    splashStore.setProgress(50);
    expect(seen).toBe(50);
    splashStore.setProgress(150);
    expect(seen).toBe(100);
    splashStore.setProgress(-10);
    expect(seen).toBe(0);
    unsub();
  });

  it("setProgress is a no-op on the same value", () => {
    let calls = 0;
    const unsub = splashStore.subscribe(() => calls++);
    splashStore.setProgress(50); // 0 → 50, notifies once
    expect(calls).toBe(2); // initial subscribe fire + change
    splashStore.setProgress(50); // same value, NO fire
    expect(calls).toBe(2);
    unsub();
  });

  it("setStatus updates the status string", () => {
    let seen = "";
    const unsub = splashStore.subscribe((s) => (seen = s.status));
    splashStore.setStatus("正在加载会话...");
    expect(seen).toBe("正在加载会话...");
    unsub();
  });

  it("hide snaps progress to 100 + sets visible=false", () => {
    splashStore.setProgress(80);
    splashStore.hide();
    const s = splashStore.get();
    expect(s.progress).toBe(100);
    expect(s.visible).toBe(false);
  });

  it("hide is a no-op when already hidden", () => {
    splashStore.hide();
    let calls = 0;
    const unsub = splashStore.subscribe(() => calls++);
    splashStore.hide();
    expect(calls).toBe(1); // initial fire only (already hidden)
    unsub();
  });

  it("subscribe fires immediately with the current value", () => {
    splashStore.setProgress(42);
    let seen = 0;
    const unsub = splashStore.subscribe((s) => (seen = s.progress));
    expect(seen).toBe(42);
    unsub();
  });
});

// ── render shell ──────────────────────────────────────────────────────────

describe("<SplashScreen /> (render shell)", () => {
  let host: HTMLElement;

  beforeEach(async () => {
    splashStore.__resetForTests();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    // First act: mount the component. This runs the synchronous
    // render() AND flushes the useEffect that subscribes to the
    // store. Without this, the next act's notify() iterates an
    // empty listeners Set and the DOM never updates.
    await act(async () => {
      render(<SplashScreen />, host);
    });
  });

  it("renders the splash with logo + brand + progress when visible", () => {
    expect(host.querySelector(".splash-screen")).not.toBeNull();
    expect(host.querySelector(".splash-logo")!.textContent).toBe("👔");
    expect(host.querySelector(".splash-brand-name")!.textContent).toBe("Hermes Chat");
    expect(host.querySelector(".splash-brand-version")!.textContent).toContain("v");
    expect(host.querySelector(".splash-progress-fill")).not.toBeNull();
    expect(host.querySelector(".splash-status")!.textContent).toContain("连接 Hermes Gateway");
    expect(host.querySelector(".splash-copyright")!.textContent).toContain("Hermes");
  });

  it("renders nothing when visible=false (after hide)", async () => {
    await act(async () => {
      splashStore.hide();
    });
    expect(host.querySelector(".splash-screen")).toBeNull();
  });

  it("progress fill width reflects the current store value", async () => {
    await act(async () => {
      splashStore.setProgress(75);
    });
    const fill = host.querySelector(".splash-progress-fill") as HTMLElement;
    expect(fill.style.width).toBe("75%");
  });

  it("status text updates after setStatus", async () => {
    await act(async () => {
      splashStore.setStatus("正在加载会话...");
    });
    expect(host.querySelector(".splash-status")!.textContent).toBe("正在加载会话...");
  });
});