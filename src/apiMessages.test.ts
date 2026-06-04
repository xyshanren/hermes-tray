import { describe, it, expect } from "vitest";
import { buildAPIMessages, getEffectiveModel, UNKNOWN_MODEL, type ChatMessage } from "./apiMessages";

const mkMsg = (role: ChatMessage["role"], content: string): ChatMessage => ({
  role,
  content,
  timestamp: new Date("2026-01-01"),
});

describe("buildAPIMessages", () => {
  it("空数组应返回空", () => {
    expect(buildAPIMessages([])).toEqual([]);
  });

  it("应过滤掉 system 消息", () => {
    const msgs = [
      mkMsg("system", "你是一个助手"),
      mkMsg("user", "你好"),
      mkMsg("assistant", "你好"),
    ];
    const result = buildAPIMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.role)).toEqual(["user", "assistant"]);
  });

  it("应只保留最近 maxHistory 条", () => {
    const msgs = Array.from({ length: 15 }, (_, i) => mkMsg("user", `m${i}`));
    const result = buildAPIMessages(msgs, 10);
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("m5");
    expect(result[9].content).toBe("m14");
  });

  it("应剥离 timestamp 字段", () => {
    const msgs = [mkMsg("user", "hi")];
    const result = buildAPIMessages(msgs);
    expect(result[0]).toEqual({ role: "user", content: "hi" });
    expect(result[0]).not.toHaveProperty("timestamp");
  });

  it("maxHistory=1 应只保留最后 1 条", () => {
    const msgs = [mkMsg("user", "a"), mkMsg("user", "b"), mkMsg("user", "c")];
    const result = buildAPIMessages(msgs, 1);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("c");
  });

  it("maxHistory 超过消息数应返回全部", () => {
    const msgs = [mkMsg("user", "a"), mkMsg("user", "b")];
    const result = buildAPIMessages(msgs, 100);
    expect(result).toHaveLength(2);
  });
});

describe("getEffectiveModel", () => {
  it("currentModel=UNKNOWN_MODEL 应回退到 defaultModel", () => {
    expect(getEffectiveModel(UNKNOWN_MODEL, "hermes-agent")).toBe("hermes-agent");
  });

  it("currentModel 已识别应原样使用", () => {
    expect(getEffectiveModel("gpt-4", "hermes-agent")).toBe("gpt-4");
  });

  it("defaultModel 为空字符串也允许", () => {
    expect(getEffectiveModel(UNKNOWN_MODEL, "")).toBe("");
  });

  it("custom unknownSentinel 应生效", () => {
    expect(getEffectiveModel("???", "fallback", "???")).toBe("fallback");
    expect(getEffectiveModel("real", "fallback", "???")).toBe("real");
  });
});
