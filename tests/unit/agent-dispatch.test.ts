import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../../core/extract/index.js'
import { verify } from '../../core/verify/index.js'
import {
  buildRefsReply,
  buildReviewReply,
  dispatchAgent,
} from '../../server/services/agent-dispatch.js'
import type { AgentDispatchDeps } from '../../server/services/agent-dispatch.js'
import type { AgentEvent, AgentRequest } from '../../types/api.js'
import type { LlmRunner } from '../../types/ports.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

// A labeled goal G2 that references an undefined G9 → REF-01 dangling; G1 is
// referenced by both a step and a verification item, making it the hub.
const DANGLING_DOC = [
  '# Plan',
  '',
  '## 目标',
  '- **G1** 基础目标，可判定：X。',
  '- **G2** 依赖 G9 的扩展目标，可判定：Y。',
  '',
  '## 做法',
  '1. 依据 G1 完成迁移。',
  '',
  '## 验收',
  '- [ ] 依据 G1 验收。',
].join('\n')

const CLEAN_DOC = [
  '# Plan',
  '',
  '## 目标',
  '- **G1** 基础目标，可判定：X。',
  '',
  '## 做法',
  '1. 依据 G1 完成迁移。',
  '',
  '## 验收',
  '- [ ] 依据 G1 验收。',
].join('\n')

/** An LLM that throws if run — proves command paths never touch the model. */
const throwingLlm: LlmRunner = {
  async run() {
    throw new Error('LLM must not be called on a command path')
  },
}

function makeDeps(doc: string, overrides: Partial<AgentDispatchDeps> = {}): AgentDispatchDeps {
  return {
    extract: extract(doc),
    source: doc,
    resolveLlm: () => throwingLlm,
    ...overrides,
  }
}

async function collect(request: AgentRequest, deps: AgentDispatchDeps): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of dispatchAgent(request, deps)) events.push(event)
  return events
}

// ── buildRefsReply (zero LLM, deterministic) ─────────────────────────────────

describe('buildRefsReply', () => {
  it('lists the dangling reference and jumps to the offending point', () => {
    const ex = extract(DANGLING_DOC)
    const { paragraphs, actions } = buildRefsReply(ex, verify(ex, { source: DANGLING_DOC }))
    const joined = paragraphs.join('\n')
    expect(joined).toContain('悬空引用')
    expect(joined).toContain('G2') // the offending point
    expect(joined).toContain('G9') // the undefined target
    expect(actions).toHaveLength(1)
    expect(actions[0]!.pt).toBe('G2') // navigable — the point owning the bad ref
    expect(actions[0]!.sub).toContain('G9')
  })

  it('reports zero dangling refs and names the hub on a clean doc', () => {
    const ex = extract(CLEAN_DOC)
    const { paragraphs, actions } = buildRefsReply(ex, verify(ex, { source: CLEAN_DOC }))
    expect(paragraphs[0]).toContain('无悬空引用')
    expect(paragraphs[0]).toContain('G1') // G1 is referenced twice → hub
    expect(actions[0]!.title).toBe('引用图健康')
    expect(actions[0]!.sub).toContain('0 悬空')
    expect(actions[0]!.pt).toBe('G1')
  })
})

// ── buildReviewReply (zero LLM, deterministic) ───────────────────────────────

describe('buildReviewReply', () => {
  it('emits one action per blocker for sample.md (the known five)', () => {
    const source = readFixture('tests/fixtures/sample.md')
    const ex = extract(source)
    const { actions } = buildReviewReply(ex, verify(ex, { source }))
    expect(actions.map((a) => a.title).sort()).toEqual([
      'DEC-01',
      'HYG-01',
      'HYG-02',
      'STR-02',
      'STR-03',
    ])
    // None of sample.md's blockers own a navigable label → no fabricated pt.
    expect(actions.every((a) => a.pt === undefined)).toBe(true)
  })

  it('resolves a blocker pt to the affected point label (REF-01 → offending point)', () => {
    const ex = extract(DANGLING_DOC)
    const { actions } = buildReviewReply(ex, verify(ex, { source: DANGLING_DOC }))
    const ref01 = actions.find((a) => a.title === 'REF-01')
    expect(ref01).toBeDefined()
    expect(ref01!.pt).toBe('G2')
  })
})

// ── dispatchAgent generator (sequence + dispatch correctness) ─────────────────

describe('dispatchAgent — command (no LLM)', () => {
  it('ai-refs emits progress* then a single final, without calling the LLM', async () => {
    const events = await collect({ type: 'command', id: 'ai-refs' }, makeDeps(DANGLING_DOC))
    expect(events[events.length - 1]!.type).toBe('final')
    expect(events.filter((e) => e.type === 'progress').length).toBeGreaterThanOrEqual(1)
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1)
  })

  it('ai-review emits progress* then final, without calling the LLM', async () => {
    const source = readFixture('tests/fixtures/sample.md')
    const events = await collect({ type: 'command', id: 'ai-review' }, makeDeps(source))
    const final = events.at(-1)
    expect(final?.type).toBe('final')
    if (final?.type === 'final') expect(final.actions.length).toBe(5)
  })
})

describe('dispatchAgent — chat / explain (LLM)', () => {
  const okLlm: LlmRunner = {
    async run() {
      return {
        ok: true,
        value: JSON.stringify({ paragraphs: ['答复。'], actions: [] }),
      }
    },
  }

  it('chat emits progress phases then a final built from the LLM reply', async () => {
    const events = await collect(
      { type: 'chat', text: '你好' },
      makeDeps(CLEAN_DOC, { resolveLlm: () => okLlm }),
    )
    const progress = events.filter((e) => e.type === 'progress')
    expect(progress.length).toBeGreaterThanOrEqual(1)
    const final = events.at(-1)
    expect(final).toEqual({ type: 'final', paragraphs: ['答复。'], actions: [] })
  })

  it('selection-op:explain routes through the chat task', async () => {
    const events = await collect(
      { type: 'selection-op', op: 'explain', quote: '依据 G1 完成迁移。' },
      makeDeps(CLEAN_DOC, { resolveLlm: () => okLlm }),
    )
    expect(events.at(-1)).toEqual({ type: 'final', paragraphs: ['答复。'], actions: [] })
  })

  it('falls back to a final error paragraph when the LLM never returns valid JSON', async () => {
    const badLlm: LlmRunner = {
      async run() {
        return { ok: true, value: 'not json' }
      },
    }
    const events = await collect(
      { type: 'chat', text: 'x' },
      makeDeps(CLEAN_DOC, { resolveLlm: () => badLlm }),
    )
    const final = events.at(-1)
    expect(final?.type).toBe('final')
    if (final?.type === 'final') {
      expect(final.paragraphs[0]).toContain('失败')
      expect(final.actions).toEqual([])
    }
  })
})

describe('dispatchAgent — not-implemented placeholders', () => {
  it('selection-op dcard|risk|open return an honest P6 placeholder (no LLM)', async () => {
    for (const op of ['dcard', 'risk', 'open'] as const) {
      const events = await collect({ type: 'selection-op', op, quote: 'x' }, makeDeps(CLEAN_DOC))
      expect(events).toHaveLength(1)
      const final = events[0]!
      expect(final.type).toBe('final')
      if (final.type === 'final') expect(final.paragraphs[0]).toContain('P6')
    }
  })

  it('analyze-notes returns a v2 placeholder (no LLM)', async () => {
    const events = await collect({ type: 'analyze-notes', notes: [] }, makeDeps(CLEAN_DOC))
    expect(events).toHaveLength(1)
    const final = events[0]!
    expect(final.type).toBe('final')
    if (final.type === 'final') expect(final.paragraphs[0]).toContain('v2')
  })
})
