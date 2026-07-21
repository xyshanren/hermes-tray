// v0.2-alpha-32.5 — Tests for the per-session project override picker.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { ProjectPicker } from "./project-picker";
import { projectPickerStore } from "./project-picker-store";

// Mock tauri invoke (not used directly by the view, but the store
// pattern means main.ts handles invokes — view is pure render).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

/** Wait for Preact's render + effect queue to drain. */
async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

function mount(props?: Partial<Parameters<typeof ProjectPicker>[0]>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const defaultProps = {
    onPick: vi.fn(),
    onClear: vi.fn(),
    onBrowse: vi.fn(),
  };
  render(<ProjectPicker {...defaultProps} {...props} />, host);
  return { host, ...defaultProps, ...props };
}

beforeEach(() => {
  // Reset store to initial state.
  projectPickerStore.setSession(null, null);
  projectPickerStore.setRecentPaths([]);
  projectPickerStore.setLoading(false);
  document.body.innerHTML = "";
});

describe("ProjectPicker (alpha-32.5)", () => {
  it("renders nothing when no active session", () => {
    const { host } = mount();
    expect(host.querySelector(".project-picker")).toBeNull();
  });

  it("renders chip with project name when session has project", () => {
    projectPickerStore.setSession("s1", { name: "hermes-tray", project_dir: "D:\\work\\hermes-tray" });
    const { host } = mount();
    const chip = host.querySelector(".project-picker-chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("hermes-tray");
  });

  it("renders empty chip when session has no project", () => {
    projectPickerStore.setSession("s1", null);
    const { host } = mount();
    const chip = host.querySelector(".project-picker-chip--empty");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("未关联项目");
  });

  it("opens dropdown on chip click", async () => {
    projectPickerStore.setSession("s1", { name: "proj", project_dir: "/a/b" });
    const { host } = mount();
    await flushRender();
    const chip = host.querySelector(".project-picker-chip") as HTMLButtonElement;
    chip.click();
    await flushRender();
    expect(host.querySelector(".project-picker-dropdown")).not.toBeNull();
  });

  it("shows current project indicator in dropdown", () => {
    projectPickerStore.setSession("s1", { name: "my-proj", project_dir: "/x/y/my-proj" });
    projectPickerStore.setOpen(true);
    const { host } = mount();
    const current = host.querySelector(".project-picker-current");
    expect(current).not.toBeNull();
    expect(current!.textContent).toContain("my-proj");
  });

  it("shows MRU paths excluding current project", () => {
    projectPickerStore.setSession("s1", { name: "proj-a", project_dir: "/a" });
    projectPickerStore.setRecentPaths(["/a", "/b", "/c"]);
    projectPickerStore.setOpen(true);
    const { host } = mount();
    // /a excluded (current), /b and /c shown. Filter by the
    // .project-picker-item-path class so we don't pick up the
    // browse button which also matches the outer container.
    const paths = host.querySelectorAll(".project-picker-item-path");
    expect(paths.length).toBe(2); // /b and /c
  });

  it("calls onPick when MRU path clicked", () => {
    const onPick = vi.fn();
    projectPickerStore.setSession("s1", null);
    projectPickerStore.setRecentPaths(["/some/path"]);
    projectPickerStore.setOpen(true);
    const { host } = mount({ onPick });
    const item = host.querySelector(".project-picker-item") as HTMLButtonElement;
    item.click();
    expect(onPick).toHaveBeenCalledWith("/some/path");
  });

  it("calls onBrowse when browse button clicked", () => {
    const onBrowse = vi.fn();
    projectPickerStore.setSession("s1", null);
    projectPickerStore.setOpen(true);
    const { host } = mount({ onBrowse });
    const browse = host.querySelector(".project-picker-browse") as HTMLButtonElement;
    browse.click();
    expect(onBrowse).toHaveBeenCalled();
  });

  it("shows clear button only when project is set", () => {
    projectPickerStore.setSession("s1", { name: "x", project_dir: "/x" });
    projectPickerStore.setOpen(true);
    const { host } = mount();
    expect(host.querySelector(".project-picker-clear")).not.toBeNull();
  });

  it("hides clear button when no project", () => {
    projectPickerStore.setSession("s1", null);
    projectPickerStore.setOpen(true);
    const { host } = mount();
    expect(host.querySelector(".project-picker-clear")).toBeNull();
  });

  it("calls onClear when clear button clicked", () => {
    const onClear = vi.fn();
    projectPickerStore.setSession("s1", { name: "x", project_dir: "/x" });
    projectPickerStore.setOpen(true);
    const { host } = mount({ onClear });
    const clear = host.querySelector(".project-picker-clear") as HTMLButtonElement;
    clear.click();
    expect(onClear).toHaveBeenCalled();
  });

  it("shows loading state", () => {
    projectPickerStore.setSession("s1", { name: "x", project_dir: "/x" });
    projectPickerStore.setOpen(true);
    projectPickerStore.setLoading(true);
    const { host } = mount();
    expect(host.querySelector(".project-picker-loading")).not.toBeNull();
  });

  it("closes dropdown on Escape key", async () => {
    projectPickerStore.setSession("s1", { name: "x", project_dir: "/x" });
    projectPickerStore.setOpen(true);
    mount();
    await flushRender();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(projectPickerStore.get().isOpen).toBe(false);
  });
});
