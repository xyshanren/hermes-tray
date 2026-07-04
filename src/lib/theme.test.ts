// v0.2 — Theme system tests (light/dark/system mode application).
// Verifies .dark class is toggled on <html> based on the chosen mode.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyTheme, getStoredTheme, setTheme, type ThemeMode } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  describe("applyTheme", () => {
    it.each<[ThemeMode, boolean]>([
      ["light", false],
      ["dark", true],
    ])('mode "%s" → .dark = %s', (mode, expected) => {
      applyTheme(mode);
      expect(document.documentElement.classList.contains("dark")).toBe(expected);
      expect(document.documentElement.dataset.theme).toBe(mode);
    });

    it("mode 'system' follows OS preference (light)", () => {
      // Default happy-dom: prefers-color-scheme = light
      applyTheme("system");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.dataset.theme).toBe("system");
    });
  });

  describe("getStoredTheme", () => {
    it("defaults to 'system' when nothing stored", () => {
      expect(getStoredTheme()).toBe("system");
    });

    it("returns 'light' when stored", () => {
      localStorage.setItem("hermes-theme", "light");
      expect(getStoredTheme()).toBe("light");
    });

    it("returns 'dark' when stored", () => {
      localStorage.setItem("hermes-theme", "dark");
      expect(getStoredTheme()).toBe("dark");
    });

    it("falls back to 'system' on garbage value", () => {
      localStorage.setItem("hermes-theme", "garbage");
      expect(getStoredTheme()).toBe("system");
    });
  });

  describe("setTheme", () => {
    it("persists to localStorage and applies", () => {
      setTheme("dark");
      expect(localStorage.getItem("hermes-theme")).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });
});