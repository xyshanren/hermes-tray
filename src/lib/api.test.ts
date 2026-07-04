// v0.2-alpha-3 — tests for src/lib/api.ts.
//
// The two proxy helpers read gateway URL + API key from ./state; tests
// assert that the right values flow through to invoke() without us having
// to spin up a Tauri runtime.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { hermesGet, hermesPostStream, authHeaders } from "./api";
import { setGatewayUrl, setApiKey, __resetForTests } from "./state";

const mockInvoke = vi.mocked(invoke);

describe("api", () => {
  beforeEach(() => {
    __resetForTests();
    setGatewayUrl("http://172.31.98.230:8642");
    setApiKey("test-key");
    mockInvoke.mockReset();
  });

  describe("authHeaders", () => {
    it("returns Bearer <apiKey>", () => {
      expect(authHeaders()).toEqual({ Authorization: "Bearer test-key" });
    });

    it("reflects the latest apiKey from state", () => {
      setApiKey("sk-rotated");
      expect(authHeaders()).toEqual({ Authorization: "Bearer sk-rotated" });
    });
  });

  describe("hermesGet", () => {
    it("invokes hermes_proxy_get with gateway+path URL and Bearer headers", async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: "{}",
      });
      const result = await hermesGet("/health");
      expect(result.ok).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith("hermes_proxy_get", {
        url: "http://172.31.98.230:8642/health",
        headers: { Authorization: "Bearer test-key" },
      });
    });

    it("supports arbitrary paths and updates URL when gateway URL changes", async () => {
      mockInvoke.mockResolvedValueOnce({ ok: true, status: 200, body: "" });
      await hermesGet("/v1/models");
      expect(mockInvoke).toHaveBeenCalledWith(
        "hermes_proxy_get",
        expect.objectContaining({
          url: "http://172.31.98.230:8642/v1/models",
        }),
      );

      mockInvoke.mockResolvedValueOnce({ ok: true, status: 200, body: "" });
      setGatewayUrl("http://10.0.0.5:1234");
      await hermesGet("/v1/models");
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "hermes_proxy_get",
        expect.objectContaining({
          url: "http://10.0.0.5:1234/v1/models",
        }),
      );
    });
  });

  describe("hermesPostStream", () => {
    it("invokes hermes_proxy_post_stream with URL, headers, JSON-stringified body", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      const body = { model: "gpt-4o", stream: true };
      await hermesPostStream("/v1/chat/completions", body);
      expect(mockInvoke).toHaveBeenCalledWith("hermes_proxy_post_stream", {
        url: "http://172.31.98.230:8642/v1/chat/completions",
        headers: { Authorization: "Bearer test-key" },
        body: JSON.stringify(body),
      });
    });

    it("re-stringifies body on each call (no caching of stringified value)", async () => {
      mockInvoke.mockResolvedValue(undefined);
      const body1 = { n: 1 };
      const body2 = { n: 2 };
      await hermesPostStream("/x", body1);
      await hermesPostStream("/x", body2);
      const call1 = mockInvoke.mock.calls[0]?.[1] as { body: string };
      const call2 = mockInvoke.mock.calls[1]?.[1] as { body: string };
      expect(call1.body).toBe(JSON.stringify(body1));
      expect(call2.body).toBe(JSON.stringify(body2));
    });
  });
});