import { describe, expect, it } from 'vitest'
import { extract } from '../../core/extract/index.js'
import { chatTask, runChatTask } from '../../core/agent/tasks/chat.js'
import type { LlmRunner } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import type { LlmError } from '../../types/ports.js'

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
