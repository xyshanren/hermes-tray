import { describe, it, expect } from "vitest";
import { evaluateAttachmentLimit } from "./main";

describe("evaluateAttachmentLimit (S14 v0.1.4)", () => {
  it("under the warn threshold returns ok", () => {
    const d = evaluateAttachmentLimit(0, 1, 4);
    expect(d.level).toBe("ok");
  });

  it("at the warn threshold (max-2) returns warn on first entry", () => {
    // currentCount=1, adding 1 -> next=2, max=4, max-2=2 -> warn
    const d = evaluateAttachmentLimit(1, 1, 4);
    expect(d.level).toBe("warn");
    if (d.level === "warn") {
      expect(d.message).toContain("4");
      expect(d.message).toContain("vision_analyze");
    }
  });

  it("does not re-warn if already in the warn zone", () => {
    // currentCount=2 (already past max-2), adding 1 -> next=3 -> still warn
    // zone but no transition -> returns ok so we don't stack toasts.
    const d = evaluateAttachmentLimit(2, 1, 4);
    expect(d.level).toBe("ok");
  });

  it("warns again on a fresh transition into the warn zone", () => {
    // currentCount=0, adding 3 -> next=3, max=4, max-2=2 -> crosses into
    // the warn zone, should warn.
    const d = evaluateAttachmentLimit(0, 3, 4);
    expect(d.level).toBe("warn");
  });

  it("at the max returns ok (no transition, already at limit)", () => {
    // currentCount=3, adding 1 -> next=4 == max. We are at the cap but
    // didn't *cross* into the warn zone from below, so no new toast.
    // (The warn fired at currentCount=2 on the way up.)
    const d = evaluateAttachmentLimit(3, 1, 4);
    expect(d.level).toBe("ok");
  });

  it("over the max returns block with informative message", () => {
    const d = evaluateAttachmentLimit(3, 2, 4);
    expect(d.level).toBe("block");
    if (d.level === "block") {
      expect(d.message).toContain("4");
      expect(d.message).toContain("3");
      expect(d.message).toContain("2");
    }
  });

  it("at 0 with adding 0 is ok", () => {
    expect(evaluateAttachmentLimit(0, 0, 4).level).toBe("ok");
  });

  it("uses default cap of 4 when no max supplied", () => {
    // Sanity check that the default parameter works.
    const d = evaluateAttachmentLimit(3, 2);
    expect(d.level).toBe("block");
  });

  it("respects a custom max (e.g. higher-tier model allows more)", () => {
    // If we ever raise the cap or have a model-specific override, the
    // helper should follow it.
    const d = evaluateAttachmentLimit(8, 9, 16);
    // next=17 > 16 -> block
    expect(d.level).toBe("block");
  });
});
