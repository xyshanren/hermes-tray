import { describe, it, expect } from "vitest";
import { buildMultimodalContent } from "./main";

describe("buildMultimodalContent (T-Q-S14)", () => {
  it("text-only with no attachments returns the string", () => {
    expect(buildMultimodalContent("hello", [])).toBe("hello");
  });

  it("empty text + 1 image returns just the image part", () => {
    const out = buildMultimodalContent("", [
      { dataUrl: "data:image/png;base64,abc", name: "x.png", type: "image/png", size: 3 },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,abc" } });
    }
  });

  it("text + 1 image: text first, then image", () => {
    const out = buildMultimodalContent("describe this", [
      { dataUrl: "data:image/jpeg;base64,xyz", name: "a.jpg", type: "image/jpeg", size: 3 },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ type: "text", text: "describe this" });
      expect(out[1].type).toBe("image_url");
      if (out[1].type === "image_url") {
        expect(out[1].image_url?.url).toBe("data:image/jpeg;base64,xyz");
      }
    }
  });

  it("text + 3 images: 1 text + 3 image_url", () => {
    const out = buildMultimodalContent("compare", [
      { dataUrl: "data:image/png;base64,1", name: "a.png", type: "image/png", size: 1 },
      { dataUrl: "data:image/png;base64,2", name: "b.png", type: "image/png", size: 1 },
      { dataUrl: "data:image/png;base64,3", name: "c.png", type: "image/png", size: 1 },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(4);
      expect(out[0].type).toBe("text");
      expect(out.slice(1).map(p => p.type)).toEqual(["image_url", "image_url", "image_url"]);
    }
  });

  it("preserves attachment order (first selected appears first)", () => {
    const out = buildMultimodalContent("see", [
      { dataUrl: "data:image/png;base64,FIRST", name: "1.png", type: "image/png", size: 5 },
      { dataUrl: "data:image/png;base64,SECOND", name: "2.png", type: "image/png", size: 6 },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out[1].type).toBe("image_url");
      if (out[1].type === "image_url") {
        expect(out[1].image_url?.url).toContain("FIRST");
      }
      expect(out[2].type).toBe("image_url");
      if (out[2].type === "image_url") {
        expect(out[2].image_url?.url).toContain("SECOND");
      }
    }
  });
});
