// v0.4.0 — Protected files approval tests (跟 plan §1.4 "3 test: AGENTS.md
// 弹审批 / skills 弹审批 / memory 弹审批" 1:1 配对, 跟 mavis MEMORY 30-34
// 行 1:1 配对).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import {
  isProtectedPath,
  PROTECTED_CATEGORY_DISPLAY,
  PROTECTED_APPROVAL_MESSAGE,
} from "../lib/protectedFiles";
import { ProtectedFilesApproval } from "./ProtectedFilesApproval";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("protectedFiles (helper)", () => {
  it("AGENTS.md 任何位置 → agents category (跟 v0.21 protocol 1:1)", () => {
    const m = isProtectedPath("/home/user/project/AGENTS.md");
    expect(m).not.toBeNull();
    expect(m!.category).toBe("agents");
    expect(m!.path).toBe("/home/user/project/AGENTS.md");
  });

  it("~/.hermes/skills/ 任何文件 → skills category (跟 v0.21 1:1)", () => {
    const m = isProtectedPath("/home/user/.hermes/skills/foo/SKILL.md");
    expect(m).not.toBeNull();
    expect(m!.category).toBe("skills");
  });

  it("~/.hermes/memories/ 任何文件 → memories category (跟 v0.21 1:1)", () => {
    const m = isProtectedPath("/home/user/.hermes/memories/x/y.md");
    expect(m).not.toBeNull();
    expect(m!.category).toBe("memories");
  });

  it("非受保护文件 → null (跟 mavis UX 倒退审计 1:1 配对 0 改 happy path)", () => {
    expect(isProtectedPath("/home/user/main.py")).toBeNull();
    expect(isProtectedPath("/repo/README.md")).toBeNull();
    expect(isProtectedPath("/tmp/foo.txt")).toBeNull();
    expect(isProtectedPath("")).toBeNull();
  });

  it("PROTECTED_CATEGORY_DISPLAY 3 类都有 label (跟 plan §1.4 1:1 配对)", () => {
    expect(PROTECTED_CATEGORY_DISPLAY.agents).toContain("AGENTS.md");
    expect(PROTECTED_CATEGORY_DISPLAY.skills).toContain("skills");
    expect(PROTECTED_CATEGORY_DISPLAY.memories).toContain("memories");
  });

  it("PROTECTED_APPROVAL_MESSAGE 包含关键警告 (跟 upstream 1:1 配对结构)", () => {
    expect(PROTECTED_APPROVAL_MESSAGE).toContain("protected");
    expect(PROTECTED_APPROVAL_MESSAGE).toContain("agent");
  });
});

describe("<ProtectedFilesApproval /> (UI modal)", () => {
  function mountProtected(path: string): HTMLElement {
    const host = document.createElement("div");
    host.id = "test-host";
    document.body.appendChild(host);
    render(
      <ProtectedFilesApproval
        filePath={path}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      host,
    );
    return host;
  }

  it("AGENTS.md → 弹 modal (跟 plan §1.4 AGENTS.md 弹审批 1:1)", () => {
    const host = mountProtected("/home/user/project/AGENTS.md");
    expect(
      host.querySelector('[data-testid="protected-files-approval"]'),
    ).not.toBeNull();
  });

  it("skills → 弹 modal (跟 plan §1.4 skills 弹审批 1:1)", () => {
    const host = mountProtected("/home/user/.hermes/skills/foo/SKILL.md");
    expect(
      host.querySelector('[data-testid="protected-files-approval"]'),
    ).not.toBeNull();
  });

  it("memories → 弹 modal (跟 plan §1.4 memory 弹审批 1:1)", () => {
    const host = mountProtected("/home/user/.hermes/memories/x/y.md");
    expect(
      host.querySelector('[data-testid="protected-files-approval"]'),
    ).not.toBeNull();
  });

  it("非受保护文件 → 0 弹 modal (跟 mavis UX 倒退审计 1:1 配对 0 改 happy path)", () => {
    const host = mountProtected("/home/user/main.py");
    expect(
      host.querySelector('[data-testid="protected-files-approval"]'),
    ).toBeNull();
  });
});
