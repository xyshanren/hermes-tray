// v0.2-alpha-3 — tests for src/lib/state.ts.
//
// State is module-private; tests rely on the public getters/setters and
// __resetForTests to keep cases isolated.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Tauri invoke so resolveGatewayUrl() can be exercised without
// a real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  getGatewayUrl,
  setGatewayUrl,
  getApiKey,
  setApiKey,
  resolveGatewayUrl,
  applyPortOverride,
  __resetForTests,
} from "./state";

const mockInvoke = vi.mocked(invoke);

describe("state", () => {
  beforeEach(() => {
    __resetForTests();
    mockInvoke.mockReset();
  });

  describe("getters/setters", () => {
    it("getGatewayUrl returns '' by default", () => {
      expect(getGatewayUrl()).toBe("");
    });

    it("setGatewayUrl then getGatewayUrl returns the set value", () => {
      setGatewayUrl("http://10.0.0.1:8642");
      expect(getGatewayUrl()).toBe("http://10.0.0.1:8642");
    });

    it("getApiKey returns the local dev default by default", () => {
      expect(getApiKey()).toBe("hermes-local-dev-key");
    });

    it("setApiKey then getApiKey returns the set value", () => {
      setApiKey("sk-custom-123");
      expect(getApiKey()).toBe("sk-custom-123");
    });
  });

  describe("applyPortOverride", () => {
    it("replaces the trailing :port in the URL", () => {
      setGatewayUrl("http://172.31.98.230:8642");
      applyPortOverride("9000");
      expect(getGatewayUrl()).toBe("http://172.31.98.230:9000");
    });

    it("is a no-op when the URL is empty", () => {
      setGatewayUrl("");
      applyPortOverride("9000");
      expect(getGatewayUrl()).toBe("");
    });

    it("is a no-op when port is falsy", () => {
      setGatewayUrl("http://172.31.98.230:8642");
      applyPortOverride(null);
      expect(getGatewayUrl()).toBe("http://172.31.98.230:8642");
      applyPortOverride(undefined);
      expect(getGatewayUrl()).toBe("http://172.31.98.230:8642");
      applyPortOverride("");
      expect(getGatewayUrl()).toBe("http://172.31.98.230:8642");
    });

    it("accepts a numeric port", () => {
      setGatewayUrl("http://172.31.98.230:8642");
      applyPortOverride(7777);
      expect(getGatewayUrl()).toBe("http://172.31.98.230:7777");
    });
  });

  describe("resolveGatewayUrl", () => {
    it("writes the invoke-returned URL on success", async () => {
      mockInvoke.mockResolvedValueOnce({
        ip: "172.31.98.230",
        port: "8642",
        url: "http://172.31.98.230:8642",
        distro: "Ubuntu",
      });
      const url = await resolveGatewayUrl();
      expect(url).toBe("http://172.31.98.230:8642");
      expect(getGatewayUrl()).toBe("http://172.31.98.230:8642");
      expect(mockInvoke).toHaveBeenCalledWith("hermes_resolve_gateway_ip");
    });

    it("falls back to the dev default on invoke failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("IPC down"));
      const url = await resolveGatewayUrl();
      expect(url).toBe("http://172.31.98.230:8642");
      expect(getGatewayUrl()).toBe("http://172.31.98.230:8642");
    });
  });
});