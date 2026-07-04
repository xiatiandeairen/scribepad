import { describe, expect, it } from 'vitest'
import { applyRewrites, rewriteItems } from '../../core/rewrite.js'
import type { EditAt } from '../../core/rewrite.js'
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

describe('applyRewrites', () => {
  it('returns the doc verbatim for empty edits', () => {
    expect(applyRewrites('hello', [])).toEqual({ ok: true, value: 'hello' })
  })

  it('splices a single edit', () => {
    const r = applyRewrites('hello world', [
      { srcStart: 6, srcEnd: 11, selection: 'world', rewritten: 'there' },
    ])
    expect(r).toEqual({ ok: true, value: 'hello there' })
  })

  it('applies multiple edits back-to-front so offsets do not drift', () => {
    // The first edit shortens the text; applied front-to-back naively, the
    // second edit's offsets would be wrong. Descending splice keeps them valid.
    const doc = 'AAA BBB CCC'
    const edits: EditAt[] = [
      { srcStart: 0, srcEnd: 3, selection: 'AAA', rewritten: 'X' },
      { srcStart: 8, srcEnd: 11, selection: 'CCC', rewritten: 'YYYY' },
    ]
    expect(applyRewrites(doc, edits)).toEqual({ ok: true, value: 'X BBB YYYY' })
  })

  it('rejects a drifted edit whose selection no longer matches the doc slice', () => {
    const r = applyRewrites('hello world', [
      { srcStart: 6, srcEnd: 11, selection: 'WORLD', rewritten: 'there' },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('drift')
      expect(r.error.index).toBe(0)
    }
  })

  it('rejects an out-of-bounds edit whose srcEnd exceeds the doc length', () => {
    const r = applyRewrites('hi', [{ srcStart: 0, srcEnd: 5, selection: 'hi', rewritten: 'yo' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('out-of-bounds')
  })

  it('rejects overlapping edits', () => {
    const r = applyRewrites('abcdef', [
      { srcStart: 0, srcEnd: 3, selection: 'abc', rewritten: 'X' },
      { srcStart: 2, srcEnd: 5, selection: 'cde', rewritten: 'Y' },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('overlap')
  })
})
