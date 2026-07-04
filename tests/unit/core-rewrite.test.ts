import { describe, expect, it } from 'vitest'
import { rewriteItems } from '../../core/rewrite.js'
import type { LlmRunner } from '../../types/ports.js'
import type { RewriteItem } from '../../types/api.js'

function fakeLlm(response: string): LlmRunner {
  return { run: async () => ({ ok: true, value: response }) }
}

const item = (id: string): RewriteItem => ({ id, selection: `sel-${id}`, instruction: 'do' })

describe('core/rewrite', () => {
  it('returns an empty placeholder for items the LLM omits, preserving order', async () => {
    const llm = fakeLlm(JSON.stringify([{ id: 'b', rewritten: 'B!' }]))
    const out = await rewriteItems('doc', [item('a'), item('b')], llm)
    expect(out).toEqual([
      { id: 'a', rewritten: '' },
      { id: 'b', rewritten: 'B!' },
    ])
  })

  it('rewrites every requested item', async () => {
    const llm = fakeLlm(
      JSON.stringify([
        { id: 'a', rewritten: 'A!' },
        { id: 'b', rewritten: 'B!' },
      ]),
    )
    const out = await rewriteItems('doc', [item('a'), item('b')], llm)
    expect(out).toEqual([
      { id: 'a', rewritten: 'A!' },
      { id: 'b', rewritten: 'B!' },
    ])
  })
})
