// v0.3.0 P1-14 — tests for src/lib/humanizeError.ts.
//
// The humanizer is a defensive last-mile: backend Rust commands should
// already be returning category-only errors per the P14 plan, but if one
// slips a verbatim path / WSL path / Authorization header into the IPC
// payload, this strips it before the user sees it.

import { describe, it, expect } from "vitest";
import { humanizeError, sanitizeErrorMessage } from "./humanizeError";

describe("sanitizeErrorMessage", () => {
  it("passes plain text untouched", () => {
    expect(sanitizeErrorMessage("操作失败: 网络断开")).toBe(
      "操作失败: 网络断开",
    );
    expect(sanitizeErrorMessage("HTTP 500")).toBe("HTTP 500");
  });

  it("masks Windows verbatim-path prefixes", () => {
    // The exact shape from Path::canonicalize on Windows.
    const input = "读取失败: \\\\.\\?\\D:\\Users\\me\\AppData\\Local\\hermes-tray\\sessions.db";
    expect(sanitizeErrorMessage(input)).not.toContain("Users");
    expect(sanitizeErrorMessage(input)).toContain("<path>");
  });

  it("masks Windows drive paths without verbatim prefix", () => {
    const input = "打开 D:\\Program Files\\hermes-tray\\config.json 失败";
    expect(sanitizeErrorMessage(input)).toContain("<path>");
    expect(sanitizeErrorMessage(input)).not.toContain("Program Files");
  });

  it("masks WSL-mounted paths", () => {
    const input = "WSL 调用失败: /mnt/c/Users/admin/hermes-agent/.env not found";
    expect(sanitizeErrorMessage(input)).toContain("<path>");
    expect(sanitizeErrorMessage(input)).not.toContain("/mnt/c/");
  });

  it("masks POSIX absolute paths under home / root / Users", () => {
    expect(
      sanitizeErrorMessage("permission denied: /home/me/.config/hermes-tray/config.json"),
    ).toContain("<path>");
    expect(sanitizeErrorMessage("EACCES: /root/.ssh/id_rsa")).toContain(
      "<path>",
    );
    expect(sanitizeErrorMessage("not found: /Users/admin/Library/secrets")).toContain(
      "<path>",
    );
  });

  it("masks Authorization / API key / token / password / secret headers", () => {
    // 'Authorization: Bearer X' collapses to a single REDACTED marker
    // — the bearer token tail doesn't leak past the regex.
    expect(
      sanitizeErrorMessage(
        "401 Unauthorized: Authorization: Bearer eyJhbGc.eyJzdWI.signature",
      ),
    ).toContain("authorization=REDACTED");
    expect(
      sanitizeErrorMessage(
        "401 Unauthorized: Authorization: Bearer eyJhbGc.eyJzdWI.signature",
      ),
    ).not.toContain("eyJhbGc");
    expect(
      sanitizeErrorMessage("请求失败: api_key=sk-abc123def456 状态 401"),
    ).toContain("api_key=REDACTED");
    expect(sanitizeErrorMessage("auth failed: token=ghp_abc123def456")).toContain(
      "token=REDACTED",
    );
    expect(
      sanitizeErrorMessage("database: password=hunter2 in connection string"),
    ).toContain("password=REDACTED");
    expect(
      sanitizeErrorMessage("AWS secret_access_key=AKIAEXAMPLE was leaked"),
    ).toContain("secret_access_key=REDACTED");
    expect(
      sanitizeErrorMessage("AWS secret_access_key=AKIAEXAMPLE was leaked"),
    ).not.toContain("AKIAEXAMPLE");
  });

  it("replaces Tauri IPC envelope prefix", () => {
    const input = "Error invoking remote method 'hermes_proxy_post_stream': 连接失败";
    const out = sanitizeErrorMessage(input);
    expect(out).toContain("IPC 调用失败");
    expect(out).not.toContain("Error invoking remote method");
  });

  it("does not break on benign strings containing colons or equals", () => {
    // No path / no header — should pass through clean.
    expect(sanitizeErrorMessage("HTTP 404: not found")).toBe(
      "HTTP 404: not found",
    );
    expect(sanitizeErrorMessage("status=ok, retry=false")).toBe(
      "status=ok, retry=false",
    );
  });

  it("handles multiple sensitive substrings in one message", () => {
    const input =
      "failed to open \\\\.\\?\\C:\\Users\\me\\app.db (password=hunter2, api_key=sk-xxx)";
    const out = sanitizeErrorMessage(input);
    expect(out).not.toContain("Users");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk-xxx");
    expect(out).toContain("<path>");
    expect(out).toContain("password=REDACTED");
    expect(out).toContain("api_key=REDACTED");
  });

  it("leaves an empty string empty", () => {
    expect(sanitizeErrorMessage("")).toBe("");
  });
});

describe("humanizeError", () => {
  it("returns '未知错误' for null / undefined", () => {
    expect(humanizeError(null)).toBe("未知错误");
    expect(humanizeError(undefined)).toBe("未知错误");
  });

  it("returns the string itself when given a string", () => {
    expect(humanizeError("failed: oops")).toBe("failed: oops");
  });

  it("extracts .message from an Error instance", () => {
    const e = new Error("打开 \\\\.\\?\\D:\\secret.db 失败");
    const out = humanizeError(e);
    expect(out).toContain("<path>");
    expect(out).not.toContain("secret.db");
  });

  it("extracts .message from a Tauri-shaped IPC error object", () => {
    // Real Tauri IPC rejections look like `{ code: 'INVOKE_ERROR', message: '...' }`
    const errLike = { code: "X", message: "读取 /mnt/c/data.json 失败" };
    expect(humanizeError(errLike)).toContain("<path>");
  });

  it("falls back to String() for unrecognized shapes", () => {
    expect(humanizeError(42)).toBe("42");
    expect(humanizeError({ foo: "bar" })).toContain("[object Object]");
  });

  it("sanitizes the extracted message", () => {
    const err = new Error(
      "Error invoking remote method 'session_create': \\\\.\\?\\D:\\Users\\me\\app.db is locked",
    );
    const out = humanizeError(err);
    expect(out).toContain("IPC 调用失败");
    expect(out).toContain("<path>");
    expect(out).not.toContain("Users");
  });
});