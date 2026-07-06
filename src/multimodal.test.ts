import { describe, it, expect } from "vitest";
import { buildMultimodalContent } from "./lib/multimodal";

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

// ─── S14 v0.1.4: image count scenarios for pre-flight + native fast path ────
//
// S14 multi-image limit (hermes-agent phase 3): the agent enforces a
// per-model max_images. For GPT-5 it's 16. These tests pin the tray-side
// contract: whatever N the user attaches, the request body must be
// structurally correct OpenAI multimodal (text first, then N image_url
// parts). The actual pre-flight check that decides whether to refuse
// happens on the agent side; the tray just needs to send the right
// shape and warn the user before they hit the limit.

function makeImages(n: number): Array<{ dataUrl: string; name: string; type: string; size: number }> {
  return Array.from({ length: n }, (_, i) => ({
    dataUrl: `data:image/png;base64,IMG${i}`,
    name: `${i}.png`,
    type: "image/png",
    size: 4,
  }));
}

describe("buildMultimodalContent image-count scenarios (S14 v0.1.4)", () => {
  it("1 image: native fast path candidate", () => {
    const out = buildMultimodalContent("describe", makeImages(1));
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(2); // text + 1 image
      const imageParts = out.filter(p => p.type === "image_url");
      expect(imageParts).toHaveLength(1);
    }
  });

  it("4 images: still under typical 16-image limit", () => {
    const out = buildMultimodalContent("compare these", makeImages(4));
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(5); // text + 4 images
      const imageParts = out.filter(p => p.type === "image_url");
      expect(imageParts).toHaveLength(4);
    }
  });

  it("16 images: at the GPT-5 limit, must still build correctly", () => {
    const out = buildMultimodalContent("", makeImages(16));
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(16); // no text + 16 images
      const imageParts = out.filter(p => p.type === "image_url");
      expect(imageParts).toHaveLength(16);
    }
  });

  it("50 images: over the GPT-5 limit — agent will reject with 422 TooManyImagesError", () => {
    // The tray still builds the request shape correctly. The agent
    // enforces the limit server-side (TooManyImagesError). This is
    // exactly the path the user would hit in production with a 50-image
    // drop — verifying the tray doesn't crash / silently drop images.
    const out = buildMultimodalContent("all of these", makeImages(50));
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out).toHaveLength(51); // text + 50 images
      const imageParts = out.filter(p => p.type === "image_url");
      expect(imageParts).toHaveLength(50);
    }
  });
});
