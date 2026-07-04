// v0.2 — Theme system (T-Q-S9 follow-up / design brief §三 / §8.7).
// Toggles .dark class on <html> based on user preference + system media query.
// Persists choice to localStorage so it survives restarts.
//
// Three modes:
//   - 'light'  → always light
//   - 'dark'   → always dark
//   - 'system' → follow OS prefers-color-scheme (default)
//
// Reads:
//   - localStorage[THEME_STORAGE_KEY] (from config.ts)
//   - window.matchMedia('(prefers-color-scheme: dark)')
//
// Writes:
//   - <html> .dark class (consumed by Tailwind dark: variants)
//   - localStorage[THEME_STORAGE_KEY]

import { THEME_STORAGE_KEY } from "../config";

export type ThemeMode = "light" | "dark" | "system";

/** Reads the stored theme, defaulting to 'system'. */
export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode, restricted env)
  }
  return "system";
}

/**
 * Apply the theme: sets .dark class on <html> when needed.
 * - 'light'  → never .dark
 * - 'dark'   → always .dark
 * - 'system' → .dark iff OS prefers dark
 *
 * Idempotent; safe to call repeatedly.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const effectiveDark =
    mode === "dark" ||
    (mode === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.classList.toggle("dark", effectiveDark);
  // Tag for any a11y / debug scripts
  root.dataset.theme = mode;
}

/** Persist + apply in one call. */
export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(mode);
}

/**
 * Boot-time init: applies the stored theme before any paint,
 * preventing the "flash of wrong theme" on dark-mode users.
 *
 * Call this from index.html as an inline script BEFORE main.ts loads.
 */
export function initThemeAtBoot(): void {
  const mode = getStoredTheme();
  applyTheme(mode);

  // If user is on 'system', react to OS theme changes live.
  if (mode === "system" && typeof window !== "undefined") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    // addEventListener is the modern API; older Safari uses addListener
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
    } else {
      // Legacy MediaQueryList.addListener — present in TS lib.dom but not always picked up.
      const legacy = mql as MediaQueryList & {
        addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener(handler);
    }
  }
}