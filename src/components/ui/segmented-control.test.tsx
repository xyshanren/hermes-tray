// v0.2-alpha-5 — SegmentedControl smoke tests.
//
// Uses preact's render to mount into the test document (happy-dom env,
// see vitest.config.ts) so onClick handlers actually fire. Each test
// mounts into a fresh container so cases stay isolated.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "preact";
import { SegmentedControl, type SegmentedOption } from "./segmented-control";

type Mode = "light" | "dark" | "system";
const OPTIONS: ReadonlyArray<SegmentedOption<Mode>> = [
  { value: "light", label: "☀️ 浅色" },
  { value: "dark", label: "🌙 深色" },
  { value: "system", label: "💻 跟随系统" },
];

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

function mount(element: Parameters<typeof render>[0]): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(element, container);
  return container;
}

function clickButton(value: string): void {
  if (!container) throw new Error("not mounted");
  const btn = container.querySelector<HTMLButtonElement>(
    `button[data-value="${value}"]`,
  );
  if (!btn) throw new Error(`button[data-value="${value}"] not found`);
  btn.click();
}

describe("SegmentedControl", () => {
  it("renders a radiogroup with the given aria-label", () => {
    const root = mount(
      <SegmentedControl
        value="system"
        onChange={() => {}}
        options={OPTIONS}
        aria-label="主题"
      />,
    );
    const group = root.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("主题");
  });

  it("renders one button per option with role=radio", () => {
    const root = mount(
      <SegmentedControl
        value="light"
        onChange={() => {}}
        options={OPTIONS}
        aria-label="主题"
      />,
    );
    const radios = root.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
    expect(radios[0].textContent).toBe("☀️ 浅色");
    expect(radios[1].textContent).toBe("🌙 深色");
    expect(radios[2].textContent).toBe("💻 跟随系统");
  });

  it("marks the active option with aria-checked=true and .active class", () => {
    const root = mount(
      <SegmentedControl
        value="dark"
        onChange={() => {}}
        options={OPTIONS}
        aria-label="主题"
      />,
    );
    const radios = root.querySelectorAll('[role="radio"]');
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
    expect((radios[0] as HTMLElement).className).not.toContain("active");
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect((radios[1] as HTMLElement).className).toContain("active");
    expect(radios[2].getAttribute("aria-checked")).toBe("false");
    expect((radios[2] as HTMLElement).className).not.toContain("active");
  });

  it("calls onChange with the clicked option's value", () => {
    const onChange = vi.fn();
    mount(
      <SegmentedControl
        value="light"
        onChange={onChange}
        options={OPTIONS}
        aria-label="主题"
      />,
    );
    clickButton("dark");
    clickButton("system");
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(onChange).toHaveBeenCalledWith("system");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does not call onChange when the active option is clicked again", () => {
    const onChange = vi.fn();
    mount(
      <SegmentedControl
        value="dark"
        onChange={onChange}
        options={OPTIONS}
        aria-label="主题"
      />,
    );
    clickButton("dark"); // already active
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables all buttons when disabled prop is set", () => {
    const onChange = vi.fn();
    mount(
      <SegmentedControl
        value="light"
        onChange={onChange}
        options={OPTIONS}
        aria-label="主题"
        disabled
      />,
    );
    if (!container) throw new Error("not mounted");
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios.forEach((r) => expect(r.disabled).toBe(true));
    clickButton("dark");
    expect(onChange).not.toHaveBeenCalled();
  });
});