import { runCodexCli } from '../adapters/codex-cli.js'
import type { ReviewNormalizeRequest, ReviewNormalizeResponse } from '../../types/api.js'

export class ReviewNormalizeInputError extends Error {}

export async function normalizeReviewPlanRequest(
  req: Partial<ReviewNormalizeRequest>,
): Promise<ReviewNormalizeResponse> {
  if (typeof req.fullDoc !== 'string' || req.fullDoc.trim() === '') {
    throw new ReviewNormalizeInputError('fullDoc required')
  }
  return { content: await normalizeReviewPlan(req.fullDoc) }
}

export async function normalizeReviewPlan(fullDoc: string): Promise<string> {
  const raw = await runCodexCli(buildPrompt(fullDoc))
  const content = stripMarkdownFence(raw).trim()
  if (!content) throw new Error('codex returned empty normalized document')
  return content
}

function buildPrompt(fullDoc: string): string {
  return `你是研发 plan 文档整理器。请把下面 markdown 文档按 Review 目录重新排版。

固定目录只能使用以下 H2，大目录不存在对应内容时不要输出该目录：
- 目标
- 范围
- 方案
- 验收
- 待确认

严格规则：
1. 不新增事实。
2. 不删除内容。
3. 不改变原意。
4. 不补空章节。
5. 不把推测写成结论。
6. 只允许调整标题、层级、顺序和列表归属。
7. 超出目录但与边界、限制、风险、依赖相关的内容归入“范围”。
8. 超出目录但与做法、流程、信息展示、交互、实现步骤相关的内容归入“方案”。
9. 不确定归属、存在争议、需要用户判断的内容归入“待确认”。
10. 输出必须是完整 markdown 文档，不要解释，不要代码块。

<<<DOC
${fullDoc}
DOC>>>`
}

function stripMarkdownFence(value: string): string {
  const text = value.trim()
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/)
  return fence?.[1] ?? text
}
