// v0.2 — Byte size formatter. Pure function, no DOM dependencies.
// Mirrors formatBytes from main.ts; tests at formatBytes.test.ts now import this directly.

/**
 * Format a byte count as human-readable B / KB / MB.
 * - < 1024           → "N B"
 * - < 1024 * 1024    → "N.N KB"
 * - else             → "N.NN MB"
 *
 * Examples:
 *   formatBytes(0)        === "0 B"
 *   formatBytes(1024)     === "1.0 KB"
 *   formatBytes(1024*1024) === "1.00 MB"
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}