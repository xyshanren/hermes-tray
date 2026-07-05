// v0.2-alpha-6 — Mount the sonner <Toaster /> once at app startup.
//
// Idempotent: skips if the mount point already exists (e.g. hot reload).
// Place the Toaster inside <body> so sonner's portal renders without
// fighting our app layout.

import { render } from "preact";
import { Toaster } from "@/components/ui/toaster";

export function mountAppToaster(): void {
  if (document.getElementById("toaster-root")) return;
  const root = document.createElement("div");
  root.id = "toaster-root";
  document.body.appendChild(root);
  render(<Toaster />, root);
}