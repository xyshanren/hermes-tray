import { describe, it, expect } from "vitest";
import {
  base64UrlEncode,
  base64UrlDecode,
  SHARE_FRAGMENT_RE,
  encodeShareDoc,
  decodeShareDoc,
  buildShareUrl,
  parseShareHash,
} from "./shareLink";

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
    expect("#share=abc".match(SHARE_FRAGMENT_RE)?.[1]).toBe("abc");
    expect("#share=".match(SHARE_FRAGMENT_RE)).toBeNull();
    expect("share=abc".match(SHARE_FRAGMENT_RE)).toBeNull();
  });
});

describe("encodeShareDoc", () => {
  it("JSON-stringifies then base64url-encodes a value", () => {
    const doc = { version: 1, title: "测试" };
    const encoded = encodeShareDoc(doc);
    // Should be a valid base64url string (no +, /, or padding)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    // And should decode back to the same JSON
    expect(decodeShareDoc(encoded)).toEqual(doc);
  });

  it("handles primitives", () => {
    expect(decodeShareDoc(encodeShareDoc("hello"))).toBe("hello");
    expect(decodeShareDoc(encodeShareDoc(42))).toBe(42);
    expect(decodeShareDoc(encodeShareDoc(null))).toBe(null);
    expect(decodeShareDoc(encodeShareDoc([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe("decodeShareDoc", () => {
  it("decodes a real share payload back to its document", () => {
    const doc = { version: 1, session: { id: "s1", title: "T" }, messages: [] };
    const encoded = encodeShareDoc(doc);
    expect(decodeShareDoc(encoded)).toEqual(doc);
  });

  it("throws on garbage base64", () => {
    // '!!!' is not valid base64 (atob throws on non-alphabet chars in some impls;
    // for atob specifically the chars are all rejected). Either way, JSON.parse
    // would also fail downstream.
    expect(() => decodeShareDoc("!!!")).toThrow();
  });

  it("throws when base64 decodes to non-JSON", () => {
    // base64url("hello") -> "aGVsbG8"; JSON.parse("hello") throws
    expect(() => decodeShareDoc(base64UrlEncode("not json {"))).toThrow();
  });
});

describe("buildShareUrl", () => {
  it("assembles ${origin}${pathname}#share=${encoded}", () => {
    expect(buildShareUrl("YWJj", "https://example.com", "/app/")).toBe(
      "https://example.com/app/#share=YWJj",
    );
  });

  it("preserves trailing slash on pathname", () => {
    expect(buildShareUrl("x", "https://example.com", "/")).toBe(
      "https://example.com/#share=x",
    );
  });

  it("works with file:// origin (Tauri dev)", () => {
    expect(buildShareUrl("x", "tauri://localhost", "/")).toBe(
      "tauri://localhost/#share=x",
    );
  });
});

describe("parseShareHash", () => {
  it("decodes a valid share hash back to the document", () => {
    const doc = { version: 1, session: { id: "s1", title: "T" } };
    const hash = `#share=${encodeShareDoc(doc)}`;
    expect(parseShareHash(hash)).toEqual(doc);
  });

  it("returns null for an empty hash", () => {
    expect(parseShareHash("")).toBeNull();
  });

  it("returns null for a non-share hash", () => {
    expect(parseShareHash("#section-1")).toBeNull();
    expect(parseShareHash("plain-string")).toBeNull();
  });

  it("returns null when the encoded payload is garbage (no throw)", () => {
    expect(parseShareHash("#share=!!!not-base64!!!")).toBeNull();
    expect(parseShareHash("#share=" + base64UrlEncode("not json"))).toBeNull();
  });
});
