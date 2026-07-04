/**
 * Default LlmJudge — the no-op the composition root injects this release. The AI
 * half of the layered model (QLT-*) is designed but not run yet; the seam lets it
 * land later without touching the deterministic verify() path.
 */
import type { ExtractResult } from '../../types/domain.js'
import type { LlmJudge, Problem } from '../../types/verify.js'

export const emptyJudge: LlmJudge = {
  judge(_result: ExtractResult, _source: string): Promise<Problem[]> {
    return Promise.resolve([])
  },
}
