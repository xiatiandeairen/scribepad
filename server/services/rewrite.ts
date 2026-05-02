/**
 * services/rewrite — orchestrates AI rewrite of one or more selections.
 *
 * Foundation skeleton: builds prompt, dispatches to claude-cli adapter,
 * parses JSON array response. v0.3 will swap adapter selection (multi-agent).
 */
import { runClaudeCli } from '../adapters/claude-cli.js'
import type { RewriteItem, RewriteResultEntry } from '../../types/api.js'

export async function rewriteItems(
  fullDoc: string,
  items: RewriteItem[],
): Promise<RewriteResultEntry[]> {
  const prompt = buildPrompt(fullDoc, items)
  const raw = await runClaudeCli(prompt)
  return parseRewriteJson(raw, items)
}

function buildPrompt(fullDoc: string, items: RewriteItem[]): string {
  const itemsJson = JSON.stringify(
    items.map((it) => ({ id: it.id, selection: it.selection, instruction: it.instruction })),
    null,
    2,
  )
  return `以下是 markdown 文档全文(仅供上下文参考):

<<<DOC
${fullDoc}
DOC>>>

请按指令改写下面 JSON 数组中的每个 selection,每条独立处理(可参考全文上下文)。
**只输出一个 JSON 数组**,每项形如 {"id":"...","rewritten":"..."},不要包裹代码块,不要加任何解释或前后缀。

${itemsJson}`
}

function parseRewriteJson(raw: string, items: RewriteItem[]): RewriteResultEntry[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) {
    throw new Error('claude returned no JSON array: ' + raw.slice(0, 200))
  }
  const arr = JSON.parse(text.slice(start, end + 1)) as RewriteResultEntry[]
  const map = new Map(arr.map((r) => [r.id, r.rewritten]))
  return items.map((it) => ({ id: it.id, rewritten: map.get(it.id) ?? '' }))
}
