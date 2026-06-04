/**
 * SSE (Server-Sent Events) 解析纯函数.
 *
 * 镜像 src/main.ts 中 handleStreamChunk() 的内联解析逻辑 (line 368-387):
 *
 *   for (const line of payload.split('\n')) {
 *     if (!line.startsWith('data: ')) continue;
 *     const data = line.slice(6);
 *     if (data === '[DONE]') continue;
 *     try {
 *       const json = JSON.parse(data);
 *       const delta = json.choices?.[0]?.delta?.content;
 *       if (delta) { ... }
 *     } catch { /* skip invalid JSON *\/ }
 *   }
 *
 * 本模块把这段逻辑拆成 3 个可独立测试的纯函数.
 * handleStreamChunk() 后续可重构为调用本模块，但本任务保持 main.ts 不变.
 */

/**
 * 从 SSE payload 提取所有 data: 行（去掉前缀 "data: "）.
 * 跳过 [DONE] 哨兵字符串.
 */
export function parseSSEDataLines(payload: string): string[] {
  return payload
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .filter((data) => data !== "[DONE]");
}

/**
 * 从单条 SSE data 行（OpenAI-style JSON）抽取 content delta.
 * - JSON 解析失败返回 null（不抛异常，与 main.ts 行为一致）
 * - 没有 content 字段或类型非 string 返回 null
 */
export function extractDeltaContent(dataLine: string): string | null {
  try {
    const json = JSON.parse(dataLine);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

/**
 * 完整流水线: 把 SSE payload 解析成拼接后的 content delta 字符串.
 * 镜像 main.ts handleStreamChunk() 中 state.streamContent += delta 的累积语义.
 */
export function parseSSEChunk(payload: string): string {
  const dataLines = parseSSEDataLines(payload);
  const deltas: string[] = [];
  for (const line of dataLines) {
    const delta = extractDeltaContent(line);
    if (delta !== null) deltas.push(delta);
  }
  return deltas.join("");
}
