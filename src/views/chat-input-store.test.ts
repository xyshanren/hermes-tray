// v0.2-alpha-18 — ChatInput store tests.

import { describe, it, expect, beforeEach } from "vitest";
import { chatInputStore } from "./chat-input-store";
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

describe("chatInputStore", () => {
  beforeEach(() => {
    chatInputStore.__resetForTests();
  });

  it("starts with no attachments, not recording, default maxInputLength", () => {
    const s = chatInputStore.get();
    expect(s.pendingAttachments).toEqual([]);
    expect(s.isRecording).toBe(false);
    expect(s.maxInputLength).toBe(4000);
  });

  it("addAttachment appends to the pending list", () => {
    chatInputStore.addAttachment(att({ id: "a1" }));
    chatInputStore.addAttachment(att({ id: "a2" }));
    expect(chatInputStore.get().pendingAttachments.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("removeAttachment drops the matching index", () => {
    chatInputStore.addAttachment(att({ id: "a1" }));
    chatInputStore.addAttachment(att({ id: "a2" }));
    chatInputStore.addAttachment(att({ id: "a3" }));
    chatInputStore.removeAttachment(1);
    expect(chatInputStore.get().pendingAttachments.map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("removeAttachment is a no-op for out-of-bounds indices", () => {
    chatInputStore.addAttachment(att({ id: "a1" }));
    chatInputStore.removeAttachment(99);
    chatInputStore.removeAttachment(-1);
    expect(chatInputStore.get().pendingAttachments).toHaveLength(1);
  });

  it("clearAttachments empties the list", () => {
    chatInputStore.addAttachment(att());
    chatInputStore.addAttachment(att());
    chatInputStore.clearAttachments();
    expect(chatInputStore.get().pendingAttachments).toEqual([]);
  });

  it("clearAttachments is a no-op when the list is empty (no spurious notify)", () => {
    let calls = 0;
    const unsub = chatInputStore.subscribe(() => calls++);
    chatInputStore.clearAttachments();
    expect(calls).toBe(1); // initial fire only
    unsub();
  });

  it("setRecording flips isRecording + notifies subscribers", () => {
    let seen = false;
    const unsub = chatInputStore.subscribe((s) => (seen = s.isRecording));
    expect(seen).toBe(false);
    chatInputStore.setRecording(true);
    expect(seen).toBe(true);
    expect(chatInputStore.get().isRecording).toBe(true);
    unsub();
  });

  it("setRecording with the same value is a no-op (no notify)", () => {
    let calls = 0;
    const unsub = chatInputStore.subscribe(() => calls++);
    chatInputStore.setRecording(false);
    expect(calls).toBe(1); // initial fire only
    unsub();
  });

  it("reset wipes everything", () => {
    chatInputStore.addAttachment(att());
    chatInputStore.setRecording(true);
    chatInputStore.reset();
    const s = chatInputStore.get();
    expect(s.pendingAttachments).toEqual([]);
    expect(s.isRecording).toBe(false);
  });

  it("subscribe fires immediately with the current state", () => {
    chatInputStore.addAttachment(att());
    let seen = 0;
    const unsub = chatInputStore.subscribe((s) => (seen = s.pendingAttachments.length));
    expect(seen).toBe(1);
    unsub();
  });
});