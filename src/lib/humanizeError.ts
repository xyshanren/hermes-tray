// v0.3.0 P1-14 — error-message humanizer.
//
// Audit §5.1 P14 finding: backend commands routinely return errors that
// embed full reqwest / rusqlite / std::io error strings — which leak
// internal paths like `\\?\D:\Users\…`, WSL `/mnt/c/…`, or even HTTP
// URLs with API keys in query strings. Those strings ride straight into
// `showToast("...", String(e), "error")` and end up on the user's face.
//
// The long-term fix is two-sided:
//
//   1. Rust side — change `format!("...: {}", e)` to `format!("{}: <ctx>", ctx)`
//      and `log::error!("original: {e}")` for forensics, never surface the
//      raw error to the IPC boundary. (Out of scope for this PR — gated on
//      alpha-33b PR#2 merge + careful audit of every error site.)
//
//   2. Frontend side (THIS FILE) — defensive last-mile: even if a slipped
//      error string gets here, `humanizeError` masks Windows verbatim
//      prefixes, WSL paths, Authorization Bearer tokens, and a few other
//      tell-tale formats before they hit a toast.
//
// Keep the humanizer conservative — when in doubt, keep the message
// intact. Aggressive redaction frustrates debugging more than it protects.

/**
 * Coerce an unknown error value into a sanitized string suitable for
 * surfacing to the user via a toast. Falls back to a generic message
 * for unrecognized shapes.
 */
export function humanizeError(err: unknown): string {
  if (err == null) return "未知错误";
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return sanitizeErrorMessage(raw);
}

/**
 * Mask well-known sensitive substrings out of an error message string.
 * Pure function — no I/O, no globals — so it's straightforwardly testable.
 */
export function sanitizeErrorMessage(s: string): string {
  let out = s;
  // 1. Windows verbatim-path prefix (`\\?\D:\Users\...`, `\\?\D:\Program Files\...`).
  //    Audit found this exact shape leaking from Path::canonicalize.
  out = out.replace(/\\\\\?\\[A-Za-z]:\\[^\s)'"`]+/g, "<path>");

  // 2. WSL-mounted paths (`/mnt/c/Users/...`). When the Rust side
  //    forwards a WSL command error verbatim, the path survives.
  out = out.replace(/\/mnt\/[a-z]\/[^\s)'"`]+/gi, "<path>");

  // 3. C:/... Windows drive paths (without the verbatim prefix).
  out = out.replace(/\b[A-Za-z]:\\[^\s)'"`]+/g, "<path>");

  // 4. POSIX absolute paths under the user's home (best-effort).
  //    `/home/me/.config/hermes-tray/...` style.
  out = out.replace(/\/(?:home|root|Users)\/[^\s)'"`]+/gi, "<path>");

  // 5. Authorization-style headers in error text.
  //    The "Authorization: Bearer X" pattern needs a slightly more
  //    careful regex so the whole `Bearer <token>` collapses to a
  //    single REDACTED marker instead of leaving the token tail
  //    dangling.
  out = out.replace(
    /\bauthorization\s*:\s*bearer\s+[^\s,;'"`]+/gi,
    "authorization=REDACTED",
  );
  // 5b. Other credential-shaped `key=value` pairs:
  //    `api_key=xxx`, `token=xxx`, `password=xxx`, `secret=xxx`,
  //    `secret_key=xxx`, `secret_access_key=xxx`.
  //    The `secret(?:[_a-zA-Z]+)?` pattern catches the common AWS / GCP
  //    compound key names without enumerating every variant.
  out = out.replace(
    /\b(api[_-]?key|token|password|secret(?:[_a-zA-Z]+)?)\s*[:=]\s*[^\s,;'"`]+/gi,
    (_m, key: string) => `${key}=REDACTED`,
  );

  // 6. Tauri IPC envelope prefix that often precedes the real message.
  //    "Error invoking remote method 'hermes_xxx': ..." — keep the
  //    "IPC 调用失败" prefix so the user still knows what failed.
  out = out.replace(/Error invoking remote method '[^']+'/g, "IPC 调用失败");

  return out;
}