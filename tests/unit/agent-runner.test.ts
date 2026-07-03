import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runTask } from '../../core/agent/runner.js'
import type { TaskSpec } from '../../core/agent/task.js'
import type { LlmRunner, LlmRunRequest, LlmError } from '../../types/ports.js'
import type { Result } from '../../types/result.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeLlm(responses: Array<Result<string, LlmError>>): LlmRunner {
  let idx = 0
  return {
    async run(_req: LlmRunRequest): Promise<Result<string, LlmError>> {
      const response = responses[idx]
      if (response === undefined) throw new Error('fake LLM ran out of responses')
      idx++
      return response
    },
  }
}

function okText(text: string): Result<string, LlmError> {
  return { ok: true, value: text }
}

function errLlm(kind: LlmError['kind'], message = 'test error'): Result<string, LlmError> {
  return { ok: false, error: { kind, message } }
}

const pointSchema = z.object({ x: z.number(), y: z.number() })
type Point = z.infer<typeof pointSchema>

const pointTask: TaskSpec<string, Point> = {
  name: 'point-extractor',
  buildPrompt: (input: string) => `Extract a point from: ${input}`,
  schema: pointSchema,
  retry: 2,
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runTask', () => {
  it('returns ok on valid JSON output', async () => {
    const llm = fakeLlm([okText('{"x":1,"y":2}')])
    const result = await runTask(pointTask, 'x=1, y=2', llm)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ x: 1, y: 2 })
    }
  })

  it('returns ok on valid JSON wrapped in a ```json fence', async () => {
    const llm = fakeLlm([okText('```json\n{"x":3,"y":4}\n```')])
    const result = await runTask(pointTask, 'x=3, y=4', llm)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ x: 3, y: 4 })
    }
  })

  it('retries on invalid output and succeeds on a later attempt', async () => {
    const llm = fakeLlm([
      okText('not valid json'), // attempt 1 — fails parse
      okText('{"x":5,"y":6}'), // attempt 2 — succeeds
    ])
    const result = await runTask(pointTask, 'x=5, y=6', llm)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ x: 5, y: 6 })
    }
  })

  it('retries on schema validation failure and succeeds on a later attempt', async () => {
    const llm = fakeLlm([
      okText('{"x":"oops","y":0}'), // attempt 1 — x is string, schema expects number
      okText('{"x":7,"y":8}'), // attempt 2 — valid
    ])
    const result = await runTask(pointTask, 'x=7, y=8', llm)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ x: 7, y: 8 })
    }
  })

  it('returns exhausted after all retry attempts produce invalid output', async () => {
    const llm = fakeLlm([
      okText('bad'), // attempt 1
      okText('bad'), // attempt 2
      okText('bad'), // attempt 3 (retry=2 → 3 total)
    ])
    const result = await runTask(pointTask, 'x=?, y=?', llm)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('exhausted')
      expect(result.error.attempts).toBe(3)
    }
  })

  it('returns invalid-output when retry=0 and first attempt fails', async () => {
    const noRetryTask: TaskSpec<string, Point> = { ...pointTask, retry: 0 }
    const llm = fakeLlm([okText('bad json')])
    const result = await runTask(noRetryTask, 'input', llm)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-output')
      expect(result.error.attempts).toBe(1)
    }
  })

  it('returns llm error immediately when the LLM call fails', async () => {
    const llm = fakeLlm([errLlm('timeout', 'timed out')])
    const result = await runTask(pointTask, 'input', llm)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('llm')
      expect(result.error.attempts).toBe(1)
      expect(result.error.message).toContain('timeout')
    }
  })

  it('returns llm error on spawn failure without retrying', async () => {
    const llm = fakeLlm([errLlm('spawn', 'command not found')])
    const result = await runTask(pointTask, 'input', llm)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('llm')
      expect(result.error.attempts).toBe(1)
    }
  })
})
