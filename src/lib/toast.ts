// v0.2-alpha-6 — Toast notifications (sonner wrapper).
//
// Replaces the vanilla `showToast(title, message, type)` implementation
// that lived in main.ts since v0.1.5. The public signature is identical,
// so the 50+ call sites in main.ts don't need to change — only the
// import path does.
//
// Sonner is the toast primitive the shadcn CLI installed (see
// src/components/ui/sonner.tsx). Mount <Toaster /> once at app startup
// (in main.ts's DOMContentLoaded handler); showToast() then pushes
// notifications into it from anywhere.

import { toast, type ExternalToast } from "sonner";

export type ToastType = "success" | "error" | "info" | "warning";

/**
 * Show a toast notification.
 *
 * @param title   The main line of the toast (rendered larger / bolder).
 * @param message Optional smaller line below the title. Empty / undefined
 *                strings are skipped so the toast stays compact.
 * @param type    Visual variant. Defaults to 'info'.
 *
 * @returns the sonner toast id, in case the caller wants to dismiss it
 *          programmatically (matches sonner's signature).
 */
export function showToast(
  title: string,
  message: string = "",
  type: ToastType = "info",
): string | number {
  const opts: ExternalToast = {};
  if (message) opts.description = message;

  switch (type) {
    case "success":
      return toast.success(title, opts);
    case "error":
      // design spec: error requires manual close (no auto-dismiss)
      return toast.error(title, { ...opts, duration: Infinity });
    case "warning":
      return toast.warning(title, opts);
    case "info":
    default:
      return toast.info(title, opts);
  }
}

/** Convenience: dismiss all visible toasts. (Pass-through to sonner.) */
export function dismissAllToasts(): void {
  toast.dismiss();
}