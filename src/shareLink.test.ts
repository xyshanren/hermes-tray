import { describe, it, expect } from "vitest";
import {
  base64UrlEncode,
  base64UrlDecode,
  SHARE_FRAGMENT_RE,
  encodeShareDoc,
  decodeShareDoc,
  buildShareUrl,
  parseShareHash,
  bytesToHex,
  sha256Hex,
  canonicalChecksumInput,
  encodeShareDocV2,
  verifyShareDocChecksum,
  SHARE_DOC_VERSION_V2,
  SHARE_CHECKSUM_HEX_LEN,
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

// ── v0.3.0 P1-13 — v2 share-link checksum (SHA-256) ──────────────────────────

describe("bytesToHex", () => {
  it("converts a byte buffer to lowercase hex", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("returns an empty string for an empty buffer", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });

  it("pads single hex digits with a leading zero", () => {
    expect(bytesToHex(new Uint8Array([0xab, 0x0c]))).toBe("ab0c");
  });
});

describe("sha256Hex", () => {
  it("produces a 64-char hex digest", async () => {
    const hex = await sha256Hex("hello");
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it("matches a known SHA-256 vector (NIST FIPS 180-4 test)", async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("handles UTF-8 input (emoji + CJK)", async () => {
    // SHA-256 of "中文 🎉" is stable; we just assert length + hex shape
    const hex = await sha256Hex("中文 🎉");
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

describe("canonicalChecksumInput", () => {
  it("JSON-stringifies session + messages in a stable order", () => {
    const a = canonicalChecksumInput({
      session: { id: "s1", title: "T" },
      messages: [{ role: "user", content: "hi" }],
    });
    const b = canonicalChecksumInput({
      session: { id: "s1", title: "T" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(a).toBe(b);
  });

  it("changes when any byte of session or messages changes", () => {
    const baseline = canonicalChecksumInput({
      session: { id: "s1", title: "T" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(canonicalChecksumInput({
      session: { id: "s1", title: "T-diff" },
      messages: [{ role: "user", content: "hi" }],
    })).not.toBe(baseline);
    expect(canonicalChecksumInput({
      session: { id: "s1", title: "T" },
      messages: [{ role: "user", content: "hi-diff" }],
    })).not.toBe(baseline);
  });
});

describe("encodeShareDocV2 + verifyShareDocChecksum", () => {
  const sampleSession = { id: "s1", title: "测试会话" };
  const sampleMessages = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "hello 🎉" },
  ];

  it("produces a v2 base64url payload with the embedded checksum", async () => {
    const encoded = await encodeShareDocV2(sampleSession, sampleMessages);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const doc = JSON.parse(base64UrlDecode(encoded));
    expect(doc.version).toBe(SHARE_DOC_VERSION_V2);
    expect(doc.session).toEqual(sampleSession);
    expect(doc.messages).toEqual(sampleMessages);
    expect(doc.sha256).toHaveLength(SHARE_CHECKSUM_HEX_LEN);
  });

  it("round-trips through parseShareHash and verifyShareDocChecksum", async () => {
    const encoded = await encodeShareDocV2(sampleSession, sampleMessages);
    const decoded = parseShareHash(`#share=${encoded}`);
    expect(decoded).not.toBeNull();
    const ok = await verifyShareDocChecksum(decoded as never);
    expect(ok).toBe(true);
  });

  it("rejects when a single message byte is tampered", async () => {
    const encoded = await encodeShareDocV2(sampleSession, sampleMessages);
    const decoded = parseShareHash(`#share=${encoded}`) as {
      version: number; session: unknown; messages: unknown; sha256: string;
    };
    decoded.messages = [{ role: "user", content: "你坏" }]; // 1 byte changed
    const ok = await verifyShareDocChecksum(decoded);
    expect(ok).toBe(false);
  });

  it("rejects when the session title is tampered", async () => {
    const encoded = await encodeShareDocV2(sampleSession, sampleMessages);
    const decoded = parseShareHash(`#share=${encoded}`) as {
      version: number; session: { id: string; title: string }; messages: unknown; sha256: string;
    };
    decoded.session.title = "测试会话-mod";
    const ok = await verifyShareDocChecksum(decoded);
    expect(ok).toBe(false);
  });

  it("rejects when the checksum field itself is mangled", async () => {
    const encoded = await encodeShareDocV2(sampleSession, sampleMessages);
    const decoded = parseShareHash(`#share=${encoded}`) as {
      version: number; session: unknown; messages: unknown; sha256: string;
    };
    decoded.sha256 = "0000000000000000";
    const ok = await verifyShareDocChecksum(decoded);
    expect(ok).toBe(false);
  });

  it("rejects docs that claim v2 but lack a checksum field", async () => {
    const ok = await verifyShareDocChecksum({
      version: 2, session: sampleSession, messages: sampleMessages,
    });
    expect(ok).toBe(false);
  });

  it("rejects docs with the wrong version number", async () => {
    const ok = await verifyShareDocChecksum({
      version: 3, session: sampleSession, messages: sampleMessages, sha256: "abc",
    });
    expect(ok).toBe(false);
  });

  it("encodes the same session+messages to the same checksum", async () => {
    const enc1 = await encodeShareDocV2(sampleSession, sampleMessages);
    const enc2 = await encodeShareDocV2(sampleSession, sampleMessages);
    const d1 = JSON.parse(base64UrlDecode(enc1));
    const d2 = JSON.parse(base64UrlDecode(enc2));
    expect(d1.sha256).toBe(d2.sha256);
  });
});
