/**
 * core/rewrite — the rewrite use-case: agent task orchestration.
 *
 * Pure orchestration (E0): the LlmRunner is injected, so this has no execa/fs.
 *
 * NOTE: the old server-side anti-drift filter (dropping decided annotations
 * before the prompt) was removed with D3; grounding is now the drift defense.
 * Extracted from the old services/rewrite during the P4.3 cutover onto
 * core/agent's runTask.
 */
import { z } from 'zod'
import { runTask } from './agent/runner.js'
import type { TaskSpec } from './agent/task.js'
import { err, ok } from './result.js'
import type { Result } from '../types/result.js'
import type { LlmRunner } from '../types/ports.js'
import type { RewriteItem, RewriteResultEntry } from '../types/api.js'

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
 * Returns one entry per requested item in the original order; items the LLM
 * did not return fall back to an empty `rewritten` placeholder. Throws when the
 * agent task fails after retries.
 */
export async function rewriteItems(
  fullDoc: string,
  items: RewriteItem[],
  llm: LlmRunner,
): Promise<RewriteResultEntry[]> {
  const result = await runTask(rewriteTask, { fullDoc, items }, llm)
  if (!result.ok) {
    throw new Error(
      `rewrite failed after ${result.error.attempts} attempt(s): ${result.error.message}`,
    )
  }

  const rewrittenById = new Map(result.value.map((r) => [r.id, r.rewritten]))
  return items.map((it) => ({
    id: it.id,
    rewritten: rewrittenById.get(it.id) ?? '',
  }))
}

/**
 * One replacement to splice into the markdown source. `selection` is the text
 * the caller expects to still occupy [srcStart, srcEnd) — the drift guard's
 * expected value; `rewritten` is what replaces it.
 */
export interface EditAt {
  srcStart: number
  srcEnd: number
  selection: string
  rewritten: string
}

export type RewriteApplyErrorKind = 'drift' | 'out-of-bounds' | 'overlap'

/** Which edit failed (`index` into the input array) and why. */
export interface RewriteApplyError {
  kind: RewriteApplyErrorKind
  message: string
  index: number
}

/**
 * Splice `edits` into `doc`, returning the new source.
 *
 * Business failures return `Err` (never throw), so the caller can map them to a
 * 4xx/409 without a try:
 *  - `drift` — an anchor no longer matches (`doc.slice(srcStart, srcEnd) !==
 *    selection`); the document changed since the anchor was taken. This is the
 *    concurrency guard equivalent to a textHash mismatch.
 *  - `out-of-bounds` — an anchor violates `0 ≤ srcStart ≤ srcEnd ≤ doc.length`.
 *  - `overlap` — two anchors cover overlapping `[srcStart, srcEnd)` ranges.
 *
 * Edits are applied back-to-front (descending `srcStart`) so an earlier splice
 * never shifts the offsets of a later one. Empty `edits` returns `doc` verbatim.
 */
export function applyRewrites(doc: string, edits: EditAt[]): Result<string, RewriteApplyError> {
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    if (
      !Number.isInteger(edit.srcStart) ||
      !Number.isInteger(edit.srcEnd) ||
      edit.srcStart < 0 ||
      edit.srcStart > edit.srcEnd ||
      edit.srcEnd > doc.length
    ) {
      return err({
        kind: 'out-of-bounds',
        index: i,
        message: `edit ${i}: [${edit.srcStart}, ${edit.srcEnd}) out of bounds for doc length ${doc.length}`,
      })
    }
    if (doc.slice(edit.srcStart, edit.srcEnd) !== edit.selection) {
      return err({
        kind: 'drift',
        index: i,
        message: `edit ${i}: selection no longer matches doc at [${edit.srcStart}, ${edit.srcEnd}) — document changed since the anchor was taken`,
      })
    }
  }

  // Overlap check on ranges sorted by start; carry the original index for reporting.
  const ordered = edits
    .map((edit, index) => ({ srcStart: edit.srcStart, srcEnd: edit.srcEnd, index }))
    .sort((a, b) => a.srcStart - b.srcStart)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].srcStart < ordered[i - 1].srcEnd) {
      return err({
        kind: 'overlap',
        index: ordered[i].index,
        message: `edit ${ordered[i].index}: range [${ordered[i].srcStart}, ${ordered[i].srcEnd}) overlaps edit ${ordered[i - 1].index}`,
      })
    }
  }

  // Splice back-to-front so each replacement leaves earlier offsets intact.
  let out = doc
  for (const edit of [...edits].sort((a, b) => b.srcStart - a.srcStart)) {
    out = out.slice(0, edit.srcStart) + edit.rewritten + out.slice(edit.srcEnd)
  }
  return ok(out)
}
