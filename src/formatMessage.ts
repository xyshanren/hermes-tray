/**
 * formatMessage — marked.parse 的薄包装.
 *
 * 镜像 src/main.ts 中 formatMessage() 的实现 (line 347-350):
 *
 *   function formatMessage(content: string): string {
 *     return marked.parse(content) as string;
 *   }
 *
 * 复刻同样的 marked 配置（breaks + gfm），用于独立单元测试.
 * 不直接 import main.ts 是因为 main.ts 顶层有 window.addEventListener('DOMContentLoaded', ...)
 * + Tauri invoke import，会拉进 Tauri runtime 依赖并污染测试环境.
 *
 * 真实部署里 main.ts 的 marked 仍然由它自己的 marked.use(markedHighlight) 配置，
 * 测试时只关注 markdown → HTML 的纯转换行为.
 */
import { marked } from "marked";

// 复刻 main.ts 顶层的 marked.setOptions（marked 是单例，setOptions 幂等）
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * 把 markdown 字符串渲染为 HTML 字符串.
 * 与 main.ts 的 formatMessage 等价（除 highlight 扩展外，本测试不依赖代码高亮）.
 */
export function formatMessage(content: string): string {
  return marked.parse(content) as string;
}
