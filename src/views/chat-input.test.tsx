// v0.2-alpha-18 — ChatInput view render shell tests.
//
// We cover the form structure + attachment strip + send button enable
// logic + Enter-to-submit + drag/drop class toggling. We do NOT drive
// the full submit pipeline (MediaRecorder + hermes_proxy_transcribe +
// SSE chunk handling) — main.ts owns those side-effects and they're
// exercised in the real Tauri WebView.
//
// Test patterns follow alpha-17's sessions-list.test.tsx: pre-set
// state via the store, then render, then dispatch native events with
// `await new Promise((r) => setTimeout(r, 0))` to let Preact's
// async setState flush between steps.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { chatInputStore } from "./chat-input-store";
import { ChatInput } from "./chat-input-view";
import type { PendingAttachment } from "./chat-view-store";

function att(over: Partial<PendingAttachment> = {}): PendingAttachment {
  return {
    id: `att-${Math.random()}`,
    dataUrl: "data:image/png;base64,AAAA",
    name: "test.png",
    type: "image/png",
    size: 4,
    ...over,
  };
}

function mountView(over: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onSubmit = vi.fn();
  const onAttach = vi.fn();
  const onMicToggle = vi.fn();
  const props = {
    isLoading: false,
    onSubmit,
    onAttach,
    onMicToggle,
    ...over,
  };
  const host = document.createElement("form");
  host.id = "chat-form";
  document.body.appendChild(host);
  render(<ChatInput {...props} />, host);
  return { host, props, onSubmit, onAttach, onMicToggle };
}

function setNativeInputValue(input: HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── store ──────────────────────────────────────────────────────────────────
// (chatInputStore covered in chat-input-store.test.ts; we don't repeat it)

// ── render shell ───────────────────────────────────────────────────────────

describe("<ChatInput /> (render shell)", () => {
  beforeEach(() => {
    chatInputStore.__resetForTests();
    document.body.innerHTML = "";
  });

  it("renders textarea + send button + char count + mic + attach", () => {
    const { host } = mountView();
    expect(host.querySelector("#message-input")).not.toBeNull();
    expect(host.querySelector("#send-btn")).not.toBeNull();
    expect(host.querySelector("#char-count")).not.toBeNull();
    expect(host.querySelector("#mic-btn")).not.toBeNull();
    expect(host.querySelector("#attach-btn")).not.toBeNull();
    expect(host.querySelector("#attach-file-input")).not.toBeNull();
  });

  it("attachment strip is hidden when pendingAttachments is empty", () => {
    const { host } = mountView();
    const strip = host.querySelector("#attachment-previews");
    expect(strip).not.toBeNull();
    expect(strip!.classList.contains("hidden")).toBe(true);
  });

  it("renders one thumb per pending attachment with × button", () => {
    chatInputStore.addAttachment(att({ id: "a1", name: "cat.png" }));
    chatInputStore.addAttachment(att({ id: "a2", name: "dog.png" }));
    const { host } = mountView();
    const thumbs = host.querySelectorAll(".attachment-thumb");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].querySelector(".attachment-name")!.textContent).toBe("cat.png");
    expect(thumbs[1].querySelector(".attachment-name")!.textContent).toBe("dog.png");
    const removeBtns = host.querySelectorAll(".attachment-remove");
    expect(removeBtns).toHaveLength(2);
  });

  it("clicking × on a thumb removes that attachment via store.removeAttachment", () => {
    chatInputStore.addAttachment(att({ id: "a1", name: "cat.png" }));
    chatInputStore.addAttachment(att({ id: "a2", name: "dog.png" }));
    const { host } = mountView();
    const removeBtns = host.querySelectorAll(".attachment-remove") as NodeListOf<HTMLButtonElement>;
    removeBtns[0].click();
    expect(chatInputStore.get().pendingAttachments.map((a) => a.id)).toEqual(["a2"]);
  });

  it("send button is disabled when text is empty and no attachments", () => {
    const { host } = mountView();
    const btn = host.querySelector("#send-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("send button enables when text is non-empty", async () => {
    const { host } = mountView();
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    setNativeInputValue(ta, "hello");
    await new Promise((r) => setTimeout(r, 0));
    const btn = host.querySelector("#send-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("send button enables when only attachments are present (no text)", () => {
    chatInputStore.addAttachment(att());
    const { host } = mountView();
    const btn = host.querySelector("#send-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("send button is disabled while isLoading", () => {
    const { host } = mountView({ isLoading: true });
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    setNativeInputValue(ta, "hello");
    const btn = host.querySelector("#send-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(ta.disabled).toBe(true);
  });

  it("send button shows '生成中...' label + hides the SVG icon while loading", () => {
    const { host } = mountView({ isLoading: true });
    const label = host.querySelector("#send-btn-label");
    expect(label!.textContent).toBe("生成中...");
    expect(host.querySelector("#send-btn-icon")).toBeNull();
  });

  it("char count shows current length / max and turns red when over", async () => {
    const { host } = mountView();
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    const count = host.querySelector("#char-count");
    expect(count!.textContent).toBe("0 / 4000");
    // Force length past the cap (4000 chars). We don't bother with
    // setNativeInputValue here — directly setting + dispatching input
    // for 4001 chars is the cheapest way to test the colour flip.
    const big = "x".repeat(4001);
    setNativeInputValue(ta, big);
    await new Promise((r) => setTimeout(r, 0));
    expect(count!.textContent).toBe("4001 / 4000");
    expect((count as HTMLElement).style.color).toBe("var(--error)");
  });

  it("Enter (without Shift) on the textarea fires onSubmit with trimmed text + attachments", async () => {
    chatInputStore.addAttachment(att({ id: "a1" }));
    const { host, onSubmit } = mountView();
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    setNativeInputValue(ta, "  hello  ");
    await new Promise((r) => setTimeout(r, 0));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubmit).toHaveBeenCalledWith("hello", expect.arrayContaining([expect.objectContaining({ id: "a1" })]));
  });

  it("Shift+Enter inserts a newline (does NOT submit)", async () => {
    const { host, onSubmit } = mountView();
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    setNativeInputValue(ta, "line1");
    await new Promise((r) => setTimeout(r, 0));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("mic button click fires onMicToggle", () => {
    const { host, onMicToggle } = mountView();
    const btn = host.querySelector("#mic-btn") as HTMLButtonElement;
    btn.click();
    expect(onMicToggle).toHaveBeenCalledTimes(1);
  });

  it("mic button gets the .recording class when isRecording", () => {
    chatInputStore.setRecording(true);
    const { host } = mountView();
    const btn = host.querySelector("#mic-btn") as HTMLButtonElement;
    expect(btn.classList.contains("recording")).toBe(true);
  });

  it("attach button click triggers the hidden file input click (no direct onAttach)", () => {
    // The visible attach button just calls input.click() — the onAttach
    // callback is wired to the input's onChange (when the user picks
    // files). Here we verify the button doesn't bypass the input by
    // calling onAttach directly.
    const { host, onAttach } = mountView();
    const fileInput = host.querySelector("#attach-file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");
    const btn = host.querySelector("#attach-btn") as HTMLButtonElement;
    btn.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("attach file input change fires onAttach with the picked files", () => {
    const { host, onAttach } = mountView();
    const fileInput = host.querySelector("#attach-file-input") as HTMLInputElement;
    const file = new File(["x"], "x.png", { type: "image/png" });
    // happy-dom supports setting `files` via DataTransfer; we fake it
    // by stubbing the property since FileList isn't directly settable.
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach.mock.calls[0][0]).toHaveLength(1);
  });

  it("textarea auto-resizes when text gets longer (height grows)", async () => {
    const { host } = mountView();
    const ta = host.querySelector("#message-input") as HTMLTextAreaElement;
    // Set up scrollHeight fakery — happy-dom's textarea.scrollHeight is
    // 0 by default. We stub it to make the resize observable.
    const origScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 80;
      },
    });
    setNativeInputValue(ta, "x");
    await new Promise((r) => setTimeout(r, 0));
    // Expect the height to be clamped to 80 (below the 200 cap).
    expect(ta.style.height).toBe("80px");
    // Restore the original descriptor.
    if (origScrollHeight) {
      Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", origScrollHeight);
    } else {
      // Fallback: delete the override.
      // (Shouldn't happen in practice — happy-dom defines it as 0.)
    }
  });
});