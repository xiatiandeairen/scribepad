/**
 * core/rewrite — the rewrite use-case: anti-drift filter + agent task.
 *
 * Pure orchestration (E0): the LlmRunner is injected, so this has no execa/fs.
 * Decided annotations are filtered out before the LLM ever sees them — this is
 * scribepad's anti-drift guard. Extracted from the old services/rewrite during
 * the P4.3 cutover onto core/agent's runTask.
 */
import { z } from 'zod'
import { runTask } from './agent/runner.js'
import type { TaskSpec } from './agent/task.js'
import type { LlmRunner } from '../types/ports.js'
import type { RewriteItem, RewriteResultEntry } from '../types/api.js'
import type { Annotation } from '../types/annotation.js'

interface RewriteTaskInput {
  fullDoc: string
  items: RewriteItem[]
}

const rewriteResultSchema = z.array(z.object({ id: z.string(), rewritten: z.string() }))

export const rewriteTask: TaskSpec<RewriteTaskInput, RewriteResultEntry[]> = {
  name: 'rewrite',
  retry: 1,
  schema: rewriteResultSchema,
  buildPrompt: ({ fullDoc, items }) => {
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
  },
}

/**
 * Rewrite the given selections via the injected LLM.
 *
 * Anti-drift: items whose id matches a `decided` annotation are dropped before
 * the prompt is built and returned with an empty `rewritten` placeholder, in the
 * original request order. Throws when every requested item is decided (callers
 * surface this as a 4xx/5xx). Throws when the agent task fails after retries.
 */
export async function rewriteItems(
  fullDoc: string,
  items: RewriteItem[],
  existingAnnotations: Annotation[],
  llm: LlmRunner,
): Promise<RewriteResultEntry[]> {
  const decidedIds = new Set(
    existingAnnotations.filter((a) => a.state === 'decided').map((a) => a.id),
  )
  const filtered = items.filter((it) => !decidedIds.has(it.id))
  if (filtered.length === 0) {
    throw new Error('all selected items are state=decided; cannot rewrite')
  }

  const result = await runTask(rewriteTask, { fullDoc, items: filtered }, llm)
  if (!result.ok) {
    throw new Error(
      `rewrite failed after ${result.error.attempts} attempt(s): ${result.error.message}`,
    )
  }

  const rewrittenById = new Map(result.value.map((r) => [r.id, r.rewritten]))
  return items.map((it) => ({
    id: it.id,
    rewritten: decidedIds.has(it.id) ? '' : (rewrittenById.get(it.id) ?? ''),
  }))
}
