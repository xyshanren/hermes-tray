// v0.2-alpha-17 — Sidebar visibility store tests.

import { describe, it, expect, beforeEach } from "vitest";
import { sidebarStore } from "./sidebar-store";

describe("sidebarStore", () => {
  beforeEach(() => {
    sidebarStore.__resetForTests();
  });

  it("starts hidden (matches v0.1.5 default: <aside id=\"sidebar\" class=\"hidden\">)", () => {
    expect(sidebarStore.get()).toBe(false);
  });

  it("setVisible(true) flips and notifies subscribers", () => {
    let seen: boolean = false;
    const unsub = sidebarStore.subscribe((v) => (seen = v));
    expect(seen).toBe(false);
    sidebarStore.setVisible(true);
    expect(seen).toBe(true);
    expect(sidebarStore.get()).toBe(true);
    unsub();
  });

  it("setVisible with the same value is a no-op (no notify)", () => {
    let calls = 0;
    const unsub = sidebarStore.subscribe(() => calls++);
    sidebarStore.setVisible(false);
    expect(calls).toBe(1); // initial fire only
    unsub();
  });

  it("toggle flips the value and returns the new one", () => {
    const after1 = sidebarStore.toggle();
    expect(after1).toBe(true);
    expect(sidebarStore.get()).toBe(true);
    const after2 = sidebarStore.toggle();
    expect(after2).toBe(false);
  });

  it("subscribe fires immediately with the current value", () => {
    sidebarStore.setVisible(true);
    let seen: boolean = false;
    const unsub = sidebarStore.subscribe((v) => (seen = v));
    expect(seen).toBe(true);
    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    let calls = 0;
    const unsub = sidebarStore.subscribe(() => calls++);
    sidebarStore.setVisible(true);
    expect(calls).toBe(2); // initial + setVisible
    unsub();
    sidebarStore.setVisible(false);
    expect(calls).toBe(2); // no further calls
  });
});