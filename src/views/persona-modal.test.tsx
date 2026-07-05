// v0.2-alpha-8 — PersonaModal component tests.
//
// We intentionally scope these tests to the store + the rendered shell
// (open/close, mode switching, list rendering). Driving the full CRUD +
// form fields through Preact + happy-dom is fragile for the same reasons
// noted in search-modal.test.tsx (timing-sensitive useEffect chains,
// controlled-input event delegation differences). The store tests below
// cover the contract that callers depend on; the form/list rendering
// coverage ensures the panel mounts and switches modes correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { PersonaModal } from "./persona-modal";
import { personaStore } from "./persona-modal-store";

// Mock invoke + toast — PersonaModal CRUD calls invoke; we don't drive it here.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

function mountPersonaModalInto(onPersonasChanged: () => void): HTMLElement {
  const oldRoot = document.getElementById("persona-modal");
  if (oldRoot) render(null, oldRoot);

  const root = document.createElement("div");
  root.id = "persona-modal";
  document.body.appendChild(root);
  render(<PersonaModal onPersonasChanged={onPersonasChanged} />, root);
  return root;
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  personaStore.close(); // resets to closed + list + editingId=null
  document.body.innerHTML = "";
});

afterEach(() => {
  const oldRoot = document.getElementById("persona-modal");
  if (oldRoot) render(null, oldRoot);
  document.body.innerHTML = "";
});

describe("personaStore", () => {
  it("starts closed in list mode with no editing id", () => {
    const s = personaStore.get();
    expect(s.open).toBe(false);
    expect(s.mode).toBe("list");
    expect(s.editingId).toBe(null);
  });

  it("setOpen notifies subscribers and flips open", () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);
    personaStore.setOpen(true);
    expect(personaStore.get().open).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true }),
    );
    unsub();
  });

  it("setMode and setEditingId update the slice they touch", () => {
    personaStore.setOpen(true);
    personaStore.setMode("create");
    expect(personaStore.get().mode).toBe("create");
    personaStore.setMode("edit");
    personaStore.setEditingId("persona:abc");
    const s = personaStore.get();
    expect(s.mode).toBe("edit");
    expect(s.editingId).toBe("persona:abc");
  });

  it("setOpen to same value is a no-op after initial subscribe fire", () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    personaStore.setOpen(false);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("close resets open + mode + editingId", () => {
    personaStore.setOpen(true);
    personaStore.setMode("edit");
    personaStore.setEditingId("persona:abc");
    personaStore.close();
    const s = personaStore.get();
    expect(s.open).toBe(false);
    expect(s.mode).toBe("list");
    expect(s.editingId).toBe(null);
  });

  it("close to default state is a no-op", () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    personaStore.close();
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops future notifications", () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    personaStore.setOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("PersonaModal rendering", () => {
  it("renders nothing when store is closed", () => {
    const root = mountPersonaModalInto(() => {});
    expect(root.children).toHaveLength(0);
  });

  it("renders panel + new button when store opens in list mode", async () => {
    const root = mountPersonaModalInto(() => {});
    await flushRender();
    personaStore.setOpen(true);
    await flushRender();
    expect(root.querySelector(".modal-persona")).not.toBeNull();
    expect(root.querySelector(".modal-close-btn")).not.toBeNull();
    // Empty state — no personas loaded.
    expect(root.querySelector(".persona-empty")?.textContent).toContain("暂无");
  });

  it("switches to create form when setMode('create') is called", async () => {
    const root = mountPersonaModalInto(() => {});
    await flushRender();
    personaStore.setOpen(true);
    await flushRender();
    personaStore.setMode("create");
    await flushRender();
    // PersonaForm renders an avatar + name + prompt textarea
    expect(root.querySelector(".persona-form")).not.toBeNull();
    expect(
      root.querySelector("input[maxlength='4']") /* avatar */,
    ).not.toBeNull();
    expect(
      root.querySelector("input[maxlength='60']") /* name */,
    ).not.toBeNull();
    expect(root.querySelector("textarea")).not.toBeNull();
  });

  it("switches back to list view when × button is clicked", async () => {
    const root = mountPersonaModalInto(() => {});
    await flushRender();
    personaStore.setOpen(true);
    await flushRender();
    // Click × inside the rendered panel.
    root.querySelector<HTMLButtonElement>(".modal-close-btn")?.click();
    expect(personaStore.get().open).toBe(false);
  });

  it("invokes onPersonasChanged when open effect fires", async () => {
    // First open triggers loadPersonas inside the component, which calls
    // onPersonasChanged after the invoke resolves. We mock invoke to
    // resolve immediately so the callback fires within the test window.
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const cb = vi.fn();
    mountPersonaModalInto(cb);
    await flushRender();
    personaStore.setOpen(true);
    await flushRender();
    // The component's open effect calls invoke("persona_list") and then
    // onPersonasChanged. We've mocked invoke to resolve; give the chain
    // a few more microtasks to drain.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(cb).toHaveBeenCalled();
  });
});