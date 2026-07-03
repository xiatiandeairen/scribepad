/**
 * runTask — orchestrates one agent task against an injected LlmRunner.
 *
 * Pure orchestration logic: no execa, no fs, no framework imports (E0).
 * The LlmRunner is injected so tests can swap in a fake without any subprocess.
 *
 * Retry loop:
 *   1. buildPrompt(input) → call llm.run
 *   2. On LLM error → return err({ kind: 'llm' })
 *   3. Strip ```json fence → JSON.parse → schema.safeParse
 *   4. If validation fails and attempts < retry → append error feedback, retry
 *   5. If exhausted → err({ kind: 'exhausted' }) if retries were configured,
 *      err({ kind: 'invalid-output' }) if retry=0
 */
import type { Result } from '../../types/result.js'
import type { LlmRunner } from '../../types/ports.js'
import { ok, err } from '../result.js'
import type { TaskSpec, AgentError } from './task.js'

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/)
  return match ? match[1].trim() : trimmed
}

export async function runTask<In, Out>(
  task: TaskSpec<In, Out>,
  input: In,
  llm: LlmRunner,
): Promise<Result<Out, AgentError>> {
  let prompt = task.buildPrompt(input)
  let attempts = 0

  for (;;) {
    attempts++

    const llmResult = await llm.run({ prompt })
    if (!llmResult.ok) {
      return err({
        kind: 'llm',
        message: `${task.name}: LLM error (${llmResult.error.kind}): ${llmResult.error.message}`,
        attempts,
      })
    }

    const raw = stripJsonFence(llmResult.value)

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      if (attempts <= task.retry) {
        prompt = buildRetryPrompt(prompt, llmResult.value, `JSON parse error: ${parseMsg}`)
        continue
      }
      return err({
        kind: task.retry > 0 ? 'exhausted' : 'invalid-output',
        message: `${task.name}: JSON parse failed after ${attempts} attempt(s): ${parseMsg}`,
        attempts,
      })
    }

    const validation = task.schema.safeParse(parsed)
    if (validation.success) {
      return ok(validation.data)
    }

    const validationMsg = validation.error.message
    if (attempts <= task.retry) {
      prompt = buildRetryPrompt(
        prompt,
        llmResult.value,
        `Schema validation error: ${validationMsg}`,
      )
      continue
    }
    return err({
      kind: task.retry > 0 ? 'exhausted' : 'invalid-output',
      message: `${task.name}: schema validation failed after ${attempts} attempt(s): ${validationMsg}`,
      attempts,
    })
  }
}

function buildRetryPrompt(prevPrompt: string, badOutput: string, feedback: string): string {
  return (
    `${prevPrompt}\n\n` +
    `---\nPrevious response was invalid. Feedback:\n${feedback}\n\n` +
    `Previous output:\n${badOutput}\n\n` +
    `Please try again and return valid JSON only.`
  )
}
