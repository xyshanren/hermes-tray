import { describe, it, expect } from "vitest";
import { parseSSEDataLines, extractDeltaContent, parseSSEChunk } from "./sseParser";

describe("parseSSEDataLines", () => {
  it("空字符串应返回空数组", () => {
    expect(parseSSEDataLines("")).toEqual([]);
  });

  it("应只保留以 'data: ' 开头的行, 并去掉前缀", () => {
    const payload = "data: hello\nevent: foo\ndata: world\n:comment\n";
    expect(parseSSEDataLines(payload)).toEqual(["hello", "world"]);
  });

  it("应跳过 [DONE] 哨兵行", () => {
    const payload = "data: hello\ndata: [DONE]\ndata: world";
    expect(parseSSEDataLines(payload)).toEqual(["hello", "world"]);
  });

  it("无 data: 行的 payload 应返回空", () => {
    expect(parseSSEDataLines("event: ping\nid: 123\n")).toEqual([]);
  });
});

describe("extractDeltaContent", () => {
  it("标准 OpenAI-style chunk 应返回 content", () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: "你好" } }],
    });
    expect(extractDeltaContent(data)).toBe("你好");
  });

  it("无 content 字段应返回 null", () => {
    const data = JSON.stringify({ choices: [{ delta: { role: "assistant" } }] });
    expect(extractDeltaContent(data)).toBeNull();
  });

  it("无效 JSON 应返回 null 不抛异常", () => {
    expect(extractDeltaContent("not json at all")).toBeNull();
  });

  it("content 非字符串应返回 null", () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 123 } }] });
    expect(extractDeltaContent(data)).toBeNull();
  });

  it("choices 为空数组应返回 null", () => {
    const data = JSON.stringify({ choices: [] });
    expect(extractDeltaContent(data)).toBeNull();
  });
});

describe("parseSSEChunk (端到端)", () => {
  it("多 chunk SSE payload 应拼接 delta 顺序", () => {
    const payload = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "你" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "好" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "世界" } }] })}`,
    ].join("\n");
    expect(parseSSEChunk(payload)).toBe("你好世界");
  });

  it("遇到 [DONE] 后, 后续 data 行不再处理 (本实现 [DONE] 仅过滤, 不中断; 文档化行为)", () => {
    const payload = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "前" } }] })}`,
      `data: [DONE]`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "后" } }] })}`,
    ].join("\n");
    // 当前实现: [DONE] 只是在 data lines 提取时被过滤, 不影响后续 data 行解析
    expect(parseSSEChunk(payload)).toBe("前后");
  });
});
