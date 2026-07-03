/**
 * Agent task contract — the spec that drives runTask.
 *
 * Pure types/constants only; no IO, no framework imports (E0 boundary).
 */
import type { ZodType } from 'zod'

/**
 * Describes one agent task: how to build its prompt, how to validate its
 * output, and how many times to retry on invalid output.
 *
 * In is the raw input fed to buildPrompt; Out is the validated output type.
 * `retry` is the number of *additional* attempts after the first failure, so
 * retry=0 means try once, retry=2 means up to 3 total attempts.
 */
export interface TaskSpec<In, Out> {
  name: string
  buildPrompt: (input: In) => string
  schema: ZodType<Out>
  retry: number
}

/**
 * Failure value returned by runTask.
 *
 * - 'llm': the LLM call itself failed (timeout / spawn / non-zero exit / empty)
 * - 'invalid-output': the LLM replied but output couldn't be parsed/validated,
 *   and no retries were configured (retry=0)
 * - 'exhausted': retries were configured but all attempts produced invalid output
 */
export interface AgentError {
  kind: 'llm' | 'invalid-output' | 'exhausted'
  message: string
  attempts: number
}
