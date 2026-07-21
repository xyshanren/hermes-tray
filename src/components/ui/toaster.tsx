// v0.2-alpha-6 — Toast renderer.
//
// Sonner requires exactly one <Toaster /> mounted somewhere in the tree.
// This wrapper reads the active theme from <html class="dark"> (set by
// the inline anti-flash IIFE in index.html + setTheme()), and re-renders
// when the class attribute changes, so toasts match the current theme.
//
// We don't use the shadcn-generated sonner.tsx because it pulls in
// next-themes (a separate theme provider that would conflict with our
// own ./lib/theme system). Keeping the wrappers small avoids fighting
// two theme sources.

import { Toaster as Sonner } from "sonner";
import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "preact/hooks";

type SonnerTheme = "light" | "dark" | "system";

function currentTheme(): SonnerTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function Toaster() {
  const [theme, setTheme] = useState<SonnerTheme>(currentTheme);

  useEffect(() => {
    // Observe <html> class attribute mutations so toasts re-render
    // when the user toggles theme via setTheme().
    const obs = new MutationObserver(() => {
      setTheme(currentTheme());
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="top-right"
      offset="24px"
      duration={4000}
      pauseWhenPageIsHidden
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}