import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../../core/extract/index.js'
import { chatTask, runChatTask } from '../../core/agent/tasks/chat.js'
import type { LlmRunner } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import type { LlmError } from '../../types/ports.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

// A plan whose 做法 step grounds itself on two goals, so the step's related
// points are G1 + G2 — used to assert the grounding pack reaches the prompt.
const GROUNDED_DOC = [
  '# Plan',
  '',
  '## 目标',
  '- **G1** 目标一，可判定：X。',
  '- **G2** 目标二，可判定：Y。',
  '',
  '## 做法',
  '1. 依据 G1 与 G2 完成核心迁移工作。',
  '',
  '## 验收',
  '- [ ] 依据 G1 验收。',
].join('\n')

const FOCUS_QUOTE = '依据 G1 与 G2 完成核心迁移工作'

function fakeLlm(response: Result<string, LlmError>): LlmRunner {
  return {
    async run() {
      return response
    },
  }
}

describe('chatTask.buildPrompt', () => {
  it('embeds the relatedPoints grounding pack of the quoted point', () => {
    const ex = extract(GROUNDED_DOC)
    const prompt = chatTask.buildPrompt({
      fullDoc: GROUNDED_DOC,
      extract: ex,
      text: '这段的依据是什么？',
      quote: FOCUS_QUOTE,
    })

    // Full doc is present as context.
    expect(prompt).toContain('DOC>>>')
    // The two grounding goals reached the focused-context block.
    expect(prompt).toContain('聚焦上下文')
    expect(prompt).toContain('G1')
    expect(prompt).toContain('G2')
    // The defined-label jump whitelist is spelled out for pt grounding.
    expect(prompt).toContain('可用于跳转的标签')
    // The user instruction and the selection are carried through.
    expect(prompt).toContain('这段的依据是什么？')
    expect(prompt).toContain(FOCUS_QUOTE)
  })

  it('omits the focus block when no quote hits a point', () => {
    const ex = extract(GROUNDED_DOC)
    const prompt = chatTask.buildPrompt({ fullDoc: GROUNDED_DOC, extract: ex, text: '概览一下' })
    expect(prompt).not.toContain('聚焦上下文')
    expect(prompt).toContain('概览一下')
  })
})

describe('runChatTask', () => {
  const ex = extract(GROUNDED_DOC)

  it('returns the reply and keeps a pt that names a defined label', async () => {
    const llm = fakeLlm({
      ok: true,
      value: JSON.stringify({
        paragraphs: ['已核对依据链。'],
        actions: [{ icon: 'edit', kind: 'edit', title: '跳到 G1', sub: '依据', pt: 'G1' }],
      }),
    })
    const result = await runChatTask(
      { fullDoc: GROUNDED_DOC, extract: ex, text: 'x', quote: FOCUS_QUOTE },
      llm,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.paragraphs).toEqual(['已核对依据链。'])
      expect(result.value.actions[0]!.pt).toBe('G1')
    }
  })

  it('drops a dangling pt (undefined label) but keeps the action', async () => {
    const llm = fakeLlm({
      ok: true,
      value: JSON.stringify({
        paragraphs: ['处理完成。'],
        actions: [{ icon: 'edit', kind: 'edit', title: '跳转', sub: 'x', pt: 'G99' }],
      }),
    })
    const result = await runChatTask({ fullDoc: GROUNDED_DOC, extract: ex, text: 'x' }, llm)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.actions).toHaveLength(1)
      expect(result.value.actions[0]!.pt).toBeUndefined()
    }
  })

  it('fails (exhausted) after retries when the LLM never returns valid JSON', async () => {
    // retry=1 → two attempts; both invalid.
    let calls = 0
    const llm: LlmRunner = {
      async run() {
        calls += 1
        return { ok: true, value: 'not json at all' }
      },
    }
    const result = await runChatTask({ fullDoc: GROUNDED_DOC, extract: ex, text: 'x' }, llm)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('exhausted')
    expect(calls).toBe(2)
  })
})

// ── review-doc grounding (docKind: 'review') ─────────────────────────────────
//
// extract.points is always [] on a review doc — its units live in
// extract.review (verdicts/claims/leftovers). Left unguarded, the chat task
// tells the model there are no jump labels at all, and normalizeAction strips
// every proposed pt toward D1/C1/L1 as "undefined" even when the model named
// a real review unit.
describe('chatTask.buildPrompt — review doc', () => {
  const reviewSource = readFixture('tests/fixtures/review-standard.md')
  const reviewEx = extract(reviewSource)

  // The fixed instruction sentence at the prompt's tail always mentions
  // "可用于跳转的标签" and D1/C1/L1 tokens also appear verbatim inside fullDoc
  // itself (embedded raw), so a bare `toContain` would pass even when the
  // whitelist line is empty. Isolate the actual `labelsLine` segment
  // (`...不得虚构): <labels>`) to assert against the real whitelist content.
  function labelsLineOf(prompt: string): string {
    const marker = '不得虚构): '
    const start = prompt.indexOf(marker)
    if (start < 0) return ''
    const end = prompt.indexOf('\n', start)
    return prompt.slice(start + marker.length, end < 0 ? undefined : end)
  }

  it('lists review verdict/claim/leftover labels in the jump whitelist', () => {
    const prompt = chatTask.buildPrompt({
      fullDoc: reviewSource,
      extract: reviewEx,
      text: '概览一下',
    })
    const labelsLine = labelsLineOf(prompt)
    expect(labelsLine).toContain('D1')
    expect(labelsLine).toContain('C1')
    expect(labelsLine).toContain('L1')
  })

  it('grounds a quote that hits a claim in the focused-context block', () => {
    const prompt = chatTask.buildPrompt({
      fullDoc: reviewSource,
      extract: reviewEx,
      text: '这条声明的证据是什么？',
      quote: '全部 248 个单测通过',
    })
    expect(prompt).toContain('聚焦上下文')
    const focusStart = prompt.indexOf('聚焦上下文')
    const focusBlock = prompt.slice(focusStart, prompt.indexOf('可用于跳转的标签'))
    expect(focusBlock).toContain('C1')
  })
})

describe('runChatTask — review doc', () => {
  const reviewSource = readFixture('tests/fixtures/review-standard.md')
  const reviewEx = extract(reviewSource)

  it('keeps a pt naming a review verdict label (D1)', async () => {
    const llm = fakeLlm({
      ok: true,
      value: JSON.stringify({
        paragraphs: ['已核对 D1。'],
        actions: [{ icon: 'edit', kind: 'edit', title: '跳到 D1', sub: '裁决', pt: 'D1' }],
      }),
    })
    const result = await runChatTask({ fullDoc: reviewSource, extract: reviewEx, text: 'x' }, llm)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.actions[0]!.pt).toBe('D1')
  })
})
