/**
 * llm-stub — a deterministic, TEST-ONLY LlmRunner for the browser write-path E2E
 * (tests/e2e/next-g4.spec.ts).
 *
 * Wired in ONLY when the SCRIBEPAD_STUB_LLM env var is set, at the composition
 * root (server/index.ts). The default production path always builds the real
 * execa runner, so this adapter never changes real LLM behavior.
 *
 * It speaks the rewrite task only (core/rewrite.ts `rewriteTask`): that prompt
 * ends with a JSON array of items `{ id, selection, instruction }`. The stub
 * echoes each `selection` back with a deterministic 〔已审阅〕 marker appended and
 * emits the exact schema-valid `[{ id, rewritten }]` JSON array that runTask's
 * fence-strip + zod expect — letting the whole write path (rewrite → splice →
 * persist → re-extract) run end to end without any provider CLI. Any other task's
 * prompt yields an `empty-output` error, which is intentional: the E2E exercises
 * only the rewrite path.
 */
import type { LlmError, LlmRunRequest, LlmRunner } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { err, ok } from '../../core/result.js'

/** Deterministic marker the E2E asserts on to prove the rewrite reached the doc. */
export const STUB_REVIEWED_MARK = '〔已审阅〕'

interface PromptItem {
  id: string
  selection: string
}

export function createStubLlmRunner(): LlmRunner {
  return {
    run(req: LlmRunRequest): Promise<Result<string, LlmError>> {
      const items = parseRewriteItems(req.prompt)
      if (!items) {
        return Promise.resolve(
          err({ kind: 'empty-output', message: 'stub LLM only supports the rewrite task' }),
        )
      }
      const result = items.map((it) => ({
        id: it.id,
        rewritten: it.selection + STUB_REVIEWED_MARK,
      }))
      return Promise.resolve(ok(JSON.stringify(result)))
    },
  }
}

/**
 * Recover the rewrite items from the tail of the rewrite prompt. `rewriteTask`
 * places the document between `<<<DOC … DOC>>>` and the items JSON array after it,
 * so we parse the bracketed array following the last `DOC>>>` marker. Returns null
 * for any other task's prompt (the stub only speaks rewrite).
 */
function parseRewriteItems(prompt: string): PromptItem[] | null {
  const marker = 'DOC>>>'
  const markerAt = prompt.lastIndexOf(marker)
  const tail = markerAt >= 0 ? prompt.slice(markerAt + marker.length) : prompt
  const start = tail.indexOf('[')
  const end = tail.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(tail.slice(start, end + 1))
    if (!Array.isArray(parsed)) return null
    const items = parsed.filter(isPromptItem)
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

function isPromptItem(x: unknown): x is PromptItem {
  if (typeof x !== 'object' || x === null) return false
  const rec = x as Record<string, unknown>
  return typeof rec.id === 'string' && typeof rec.selection === 'string'
}
