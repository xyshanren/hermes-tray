// v0.2-alpha-32.4 — tests for the typed db_config accessors.
//
// Scope: pure logic, no Tauri invokes. We mock @tauri-apps/api/core
// so the load* functions can be exercised without a Rust runtime.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockGet(...args),
}));

// Import after the mock is set up so the module picks up the
// stubbed `invoke`.
import { loadAutoConnect, loadAutoRename } from "./db-config";

beforeEach(() => {
  mockGet.mockReset();
});

describe("loadAutoConnect", () => {
  it("returns true when the key is unset (matches defaultValue)", async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await loadAutoConnect()).toBe(true);
  });

  it("returns true when the stored value is 'true'", async () => {
    mockGet.mockResolvedValueOnce({ key: "auto_connect", value: "true" });
    expect(await loadAutoConnect()).toBe(true);
  });

  it("returns false when the stored value is 'false' (the alpha-32.4 fix)", async () => {
    // Pre-alpha-32.4 the toggle was a dead switch — saving
    // 'false' here had no effect. Now it disables the initial
    // connect + 30s poll in main.ts.
    mockGet.mockResolvedValueOnce({ key: "auto_connect", value: "false" });
    expect(await loadAutoConnect()).toBe(false);
  });

  it("is case-insensitive on the stored value", async () => {
    mockGet.mockResolvedValueOnce({ key: "auto_connect", value: "FALSE" });
    expect(await loadAutoConnect()).toBe(false);
  });
});

describe("loadAutoRename", () => {
  it("returns true when the key is unset (matches defaultValue)", async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await loadAutoRename()).toBe(true);
  });

  it("returns true when the stored value is 'true'", async () => {
    mockGet.mockResolvedValueOnce({ key: "auto_rename", value: "true" });
    expect(await loadAutoRename()).toBe(true);
  });

  it("returns false when the stored value is 'false' (the alpha-32.4 fix)", async () => {
    // Pre-alpha-32.4 the toggle was a dead switch — main.ts
    // unconditionally renamed sessions on the first user
    // message regardless of this config. Now OFF preserves
    // the default '新会话' title.
    mockGet.mockResolvedValueOnce({ key: "auto_rename", value: "false" });
    expect(await loadAutoRename()).toBe(false);
  });
});
