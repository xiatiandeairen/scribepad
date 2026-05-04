/**
 * services/rewrite — orchestrates AI rewrite of one or more selections.
 *
 * Foundation skeleton: builds prompt, dispatches to the Codex CLI adapter,
 * parses JSON array response. v0.3 will swap adapter selection (multi-agent).
 */
import { runCodexCli } from '../adapters/codex-cli.js'
import type { RewriteItem, RewriteResultEntry } from '../../types/api.js'
import type { Annotation } from '../../types/annotation.js'

export async function rewriteItems(
  fullDoc: string,
  items: RewriteItem[],
  existingAnnotations: Annotation[] = [],
): Promise<RewriteResultEntry[]> {
  // 防漂移过滤:剔除 id 命中 state=decided 的批注的请求项
  const decidedIds = new Set(
    existingAnnotations.filter((a) => a.state === 'decided').map((a) => a.id),
  )
  const filtered: RewriteItem[] = []
  const skipped: RewriteItem[] = []
  for (const it of items) {
    if (decidedIds.has(it.id)) skipped.push(it)
    else filtered.push(it)
  }
  if (filtered.length === 0) {
    throw new Error('all selected items are state=decided; cannot rewrite')
  }

  const prompt = buildPrompt(fullDoc, filtered)
  const raw = await runCodexCli(prompt)
  const results = parseRewriteJson(raw, filtered)

  // 被过滤项保持 rewritten = '' 占位,按原 items 顺序合并返回
  const resultMap = new Map(results.map((r) => [r.id, r.rewritten]))
  return items.map((it) => ({
    id: it.id,
    rewritten: decidedIds.has(it.id) ? '' : (resultMap.get(it.id) ?? ''),
  }))
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
    throw new Error('codex returned no JSON array: ' + raw.slice(0, 200))
  }
  const arr = JSON.parse(text.slice(start, end + 1)) as RewriteResultEntry[]
  const map = new Map(arr.map((r) => [r.id, r.rewritten]))
  return items.map((it) => ({ id: it.id, rewritten: map.get(it.id) ?? '' }))
}
