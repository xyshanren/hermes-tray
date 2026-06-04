/**
 * 聊天消息 state ↔ API 请求体转换纯函数.
 *
 * 镜像 src/main.ts 中 sendMessage() 内的内联逻辑 (line 414-420):
 *
 *   const apiMessages = state.messages
 *     .filter(m => m.role !== 'system')
 *     .slice(-10)
 *     .map(m => ({ role: m.role, content: m.content }));
 *
 *   const model = state.currentModel !== UNKNOWN_MODEL
 *     ? state.currentModel
 *     : CONFIG.defaultModel;
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface APIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** 未识别模型的占位符, 镜像 main.ts 的 UNKNOWN_MODEL = '-' */
export const UNKNOWN_MODEL = "-";

/**
 * 构造发给 OpenAI-compatible /v1/chat/completions 的 messages 数组.
 * - 过滤掉 system 角色（main.ts 中用其他方式注入 system prompt）
 * - 只保留最近 maxHistory 条（默认 10，与 main.ts 一致）
 * - 剥离 timestamp 字段（API 不需要）
 */
export function buildAPIMessages(
  messages: ChatMessage[],
  maxHistory: number = 10,
): APIMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .slice(-maxHistory)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * 选出实际请求用的 model: 已识别则用 currentModel, 否则用 defaultModel.
 * 镜像 main.ts sendMessage() 内的三元判断.
 */
export function getEffectiveModel(
  currentModel: string,
  defaultModel: string,
  unknownSentinel: string = UNKNOWN_MODEL,
): string {
  return currentModel !== unknownSentinel ? currentModel : defaultModel;
}
