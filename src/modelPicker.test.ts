import { describe, it, expect } from "vitest";
import { pickModelForRequest } from "./lib/modelPicker";

describe("pickModelForRequest (T-Q-S12-light)", () => {
  it("persona.model wins over everything", () => {
    expect(
      pickModelForRequest(
        { model: "gpt-4o-mini" },
        "claude-3-5-sonnet",
        "deepseek-chat",
        "hermes-agent",
      ),
    ).toBe("gpt-4o-mini");
  });

  it("persona.model null falls through to currentModel", () => {
    expect(
      pickModelForRequest(
        { model: null },
        "claude-3-5-sonnet",
        "deepseek-chat",
        "hermes-agent",
      ),
    ).toBe("claude-3-5-sonnet");
  });

  it("currentModel sentinel '-' falls through to defaultModel", () => {
    expect(
      pickModelForRequest(null, "-", "deepseek-chat", "hermes-agent"),
    ).toBe("deepseek-chat");
  });

  it("defaultModel null falls through to legacyDefault", () => {
    expect(
      pickModelForRequest(null, "-", null, "hermes-agent"),
    ).toBe("hermes-agent");
  });

  it("no persona, currentModel set, defaultModel set: currentModel wins", () => {
    expect(
      pickModelForRequest(null, "claude-3-haiku", "deepseek-chat", "hermes-agent"),
    ).toBe("claude-3-haiku");
  });

  it("no persona, no currentModel, no defaultModel: legacyDefault", () => {
    expect(pickModelForRequest(null, "-", null, "hermes-agent")).toBe("hermes-agent");
  });

  it("persona with empty string model falls through", () => {
    // Empty string is falsy in JS — treated as "no override".
    expect(
      pickModelForRequest({ model: "" }, "gpt-4o", null, "hermes-agent"),
    ).toBe("gpt-4o");
  });

  it("whitespace-only defaultModel is passed through (caller trims)", () => {
    // The contract: pickModelForRequest takes the already-trimmed
    // value. main.ts calls .trim() before persisting / passing in,
    // so the function only checks for null/empty, not whitespace.
    // Whitespace would only show up if a future caller forgets to
    // trim — a programming error, not a runtime condition.
    expect(
      pickModelForRequest(null, "-", "   ", "hermes-agent"),
    ).toBe("   ");
  });
});
