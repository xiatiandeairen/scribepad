import { describe, expect, it } from 'vitest'
import { rewriteItems } from '../../core/rewrite.js'
import type { LlmRunner } from '../../types/ports.js'
import type { Annotation } from '../../types/annotation.js'
import type { RewriteItem } from '../../types/api.js'

function fakeLlm(response: string): LlmRunner {
  return { run: async () => ({ ok: true, value: response }) }
}

function ann(id: string, state: Annotation['state']): Annotation {
  return {
    id,
    anchor: { srcStart: 0, srcEnd: 1, text: 'x' },
    state,
    status: 'open',
    history: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ai_suggestion: null,
  }
}

const item = (id: string): RewriteItem => ({ id, selection: `sel-${id}`, instruction: 'do' })

describe('core/rewrite anti-drift filter', () => {
  it('throws the exact message when every item is decided (P0.7 contract)', async () => {
    await expect(
      rewriteItems('doc', [item('a')], [ann('a', 'decided')], fakeLlm('[]')),
    ).rejects.toThrow('all selected items are state=decided; cannot rewrite')
  })

  it('drops decided items (empty placeholder) and rewrites the rest in order', async () => {
    const llm = fakeLlm(JSON.stringify([{ id: 'b', rewritten: 'B!' }]))
    const out = await rewriteItems('doc', [item('a'), item('b')], [ann('a', 'decided')], llm)
    expect(out).toEqual([
      { id: 'a', rewritten: '' },
      { id: 'b', rewritten: 'B!' },
    ])
  })

  it('rewrites all items when none are decided', async () => {
    const llm = fakeLlm(
      JSON.stringify([
        { id: 'a', rewritten: 'A!' },
        { id: 'b', rewritten: 'B!' },
      ]),
    )
    const out = await rewriteItems('doc', [item('a'), item('b')], [], llm)
    expect(out).toEqual([
      { id: 'a', rewritten: 'A!' },
      { id: 'b', rewritten: 'B!' },
    ])
  })
})
