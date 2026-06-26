import { describe, it, expect } from "vitest";
import {
  composeSystemPrompt,
  buildAPIMessagesWithSystem,
  type PersonaLike,
  type ProjectContextLike,
} from "./systemPrompt";

const persona: PersonaLike = {
  system_prompt: "You are a senior Rust developer.",
  name: "engineer",
};

const project: ProjectContextLike = {
  name: "hermes-tray",
  version: "0.2.0",
  description: "Local-first Hermes chat tray",
  summary_markdown: "# hermes-tray\n\n**Version**: 0.2.0",
  project_dir: "/home/user/hermes-tray",
};

describe("composeSystemPrompt", () => {
  it("returns null when both persona and project are absent", () => {
    expect(composeSystemPrompt(null, null)).toBeNull();
  });

  it("returns null when persona is empty AND project is null", () => {
    expect(composeSystemPrompt({ system_prompt: "" }, null)).toBeNull();
    expect(composeSystemPrompt({ system_prompt: "   " }, null)).toBeNull();
  });

  it("returns persona alone when project is null", () => {
    const out = composeSystemPrompt(persona, null);
    expect(out).toBe("You are a senior Rust developer.");
  });

  it("returns project alone when persona is empty", () => {
    const out = composeSystemPrompt({ system_prompt: "" }, project);
    expect(out).toContain("## Project Context");
    expect(out).toContain("hermes-tray");
    expect(out).toContain("v0.2.0");
  });

  it("joins persona and project with --- divider", () => {
    const out = composeSystemPrompt(persona, project);
    expect(out).not.toBeNull();
    expect(out!.startsWith("You are a senior Rust developer.")).toBe(true);
    expect(out!.includes("\n\n---\n\n")).toBe(true);
    expect(out!.endsWith("# hermes-tray\n\n**Version**: 0.2.0")).toBe(true);
  });

  it("trims whitespace from persona.system_prompt", () => {
    const out = composeSystemPrompt({ system_prompt: "  \n  Hello  \n  " }, null);
    expect(out).toBe("Hello");
  });

  it("renders project block with all optional fields", () => {
    const out = composeSystemPrompt(null, project)!;
    expect(out).toContain("**Project**: hermes-tray v0.2.0");
    expect(out).toContain("Local-first Hermes chat tray");
    expect(out).toContain("**Path**: `/home/user/hermes-tray`");
  });

  it("renders project block without optional fields", () => {
    const minimal: ProjectContextLike = {
      name: "x",
      summary_markdown: "summary here",
      project_dir: "/x",
    };
    const out = composeSystemPrompt(null, minimal)!;
    expect(out).toContain("**Project**: x");
    expect(out).not.toContain("**Version**");
    expect(out).toContain("summary here");
  });

  it("returns null when project has no name and no summary", () => {
    const empty: ProjectContextLike = {
      name: "",
      summary_markdown: "",
      project_dir: "/x",
    };
    expect(composeSystemPrompt(persona, empty)).toBe(persona.system_prompt);
    expect(composeSystemPrompt(null, empty)).toBeNull();
  });
});

describe("buildAPIMessagesWithSystem", () => {
  const msgs = [
    { role: "user" as const, content: "m1" },
    { role: "assistant" as const, content: "m2" },
    { role: "user" as const, content: "m3" },
  ];

  it("returns just user messages when system is null", () => {
    const out = buildAPIMessagesWithSystem(msgs, null);
    expect(out).toEqual(msgs);
  });

  it("prepends system message when provided", () => {
    const out = buildAPIMessagesWithSystem(msgs, "you are x");
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ role: "system", content: "you are x" });
    expect(out[1]).toEqual(msgs[0]);
  });

  it("respects maxHistory for the user portion", () => {
    const out = buildAPIMessagesWithSystem(msgs, "sys", 2);
    expect(out).toHaveLength(3);
    expect(out[0].role).toBe("system");
    // last 2 user messages: m2 + m3
    expect((out[1] as { content: string }).content).toBe("m2");
    expect((out[2] as { content: string }).content).toBe("m3");
  });
});
