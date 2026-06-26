import { describe, it, expect } from "vitest";

/**
 * Mirror of `base64UrlEncode` / `base64UrlDecode` from main.ts. The
 * Tauri app uses the same algorithm to share a session as a URL
 * fragment. The encode must be:
 *   - URL-safe (uses `-_` instead of `+/`)
 *   - No padding (strips `=`)
 *   - UTF-8 safe (multi-byte chars like emoji round-trip)
 */

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

describe("base64UrlEncode", () => {
  it("encodes ASCII correctly", () => {
    expect(base64UrlEncode("hello")).toBe("aGVsbG8");
  });

  it("encodes empty string to empty string", () => {
    expect(base64UrlEncode("")).toBe("");
  });

  it("replaces + and / with - and _ (output is URL-safe)", () => {
    // We use a JSON payload (more realistic) and just verify the
    // output alphabet is URL-safe. Direct round-trip tests are below.
    const out = base64UrlEncode("a?b/c+d=e");
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
    // And decoding the same gives us back the input.
    expect(base64UrlDecode(out)).toBe("a?b/c+d=e");
  });

  it("output contains only URL-safe chars", () => {
    const out = base64UrlEncode(JSON.stringify({ a: 1, b: "中文 + / = ?" }));
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("strips = padding", () => {
    // 'a' is a single byte — base64 with padding is 'YQ==', stripped to 'YQ'.
    expect(base64UrlEncode("a")).toBe("YQ");
  });
});

describe("base64UrlDecode", () => {
  it("decodes ASCII correctly", () => {
    expect(base64UrlDecode("aGVsbG8")).toBe("hello");
  });

  it("decodes empty string to empty string", () => {
    expect(base64UrlDecode("")).toBe("");
  });

  it("accepts - and _ characters in input", () => {
    // Encode "a?b/c+d=e" -> "YT9iL2MrZD1l" (or similar).
    // The encoder replaces + -> - and / -> _ and strips =.
    // We just round-trip and check we get back the original.
    const input = "a?b/c+d=e";
    const encoded = base64UrlEncode(input);
    expect(encoded).not.toMatch(/[+/=]/); // no url-unsafe chars or padding
    expect(base64UrlDecode(encoded)).toBe(input);
  });

  it("handles missing padding by re-adding it", () => {
    // 'YQ' (no padding) should decode to 'a' after we add '=='
    expect(base64UrlDecode("YQ")).toBe("a");
  });
});

describe("base64Url round-trip", () => {
  it("encodes then decodes returns the original", () => {
    const samples = [
      "",
      "hello",
      "{\"a\":1,\"b\":\"中文\"}",
      "emoji 🎉 test",
      "x".repeat(100),
      "x".repeat(1023),
      "multi\nline\nstring with\ttabs",
    ];
    for (const s of samples) {
      const encoded = base64UrlEncode(s);
      const decoded = base64UrlDecode(encoded);
      expect(decoded).toBe(s);
    }
  });

  it("JSON document round-trips intact", () => {
    const doc = {
      version: 1,
      exported_at: 1716800000000,
      session: { id: "s1", title: "T", created_at: 1, updated_at: 2, model: null },
      messages: [
        { id: "m1", session_id: "s1", role: "user", content: "hi 🎉", tokens: 1, created_at: 1, tool_calls: null, metadata: null },
        { id: "m2", session_id: "s1", role: "assistant", content: "hello\nworld", tokens: 2, created_at: 2, tool_calls: null, metadata: null },
      ],
    };
    const encoded = base64UrlEncode(JSON.stringify(doc));
    const decoded = base64UrlDecode(encoded);
    expect(JSON.parse(decoded)).toEqual(doc);
  });
});

describe("URL fragment parsing", () => {
  it("matches #share= prefix", () => {
    const re = /^#share=(.+)$/;
    expect("#share=abc".match(re)?.[1]).toBe("abc");
    expect("#share=".match(re)).toBeNull();
    expect("share=abc".match(re)).toBeNull();
  });
});
