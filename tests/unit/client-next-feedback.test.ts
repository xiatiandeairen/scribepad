/**
 * Panel feedback intake — pure pieces of the client-next feedback network layer.
 *
 * The popover UI itself (review-feedback.jsx) needs a DOM to exercise and is
 * pinned by the Playwright spec (tests/e2e/next-feedback.spec.ts). What is pure
 * and shippable-source testable here — evaluated with a stand-in window exactly
 * as client-next-deliver.test.ts does — is:
 *
 *  1. buildFeedbackPayload — assemble the POST /api/feedback body: required text,
 *     omit-when-absent optional fields, dom/console size caps.
 *  2. postFeedback         — POST /api/feedback with that body.
 *
 * The early console ring buffer it reads at submit is covered separately in
 * client-next-console-buffer.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type FeedbackPayload = {
  text: string
  category?: string
  sessionId?: string
  dom?: string
  consoleErrors?: string[]
  viewport?: string
  activeSection?: string
}

type Net = {
  buildFeedbackPayload: (
    text: unknown,
    category?: unknown,
    sessionId?: unknown,
    domSnapshot?: unknown,
    consoleErrors?: unknown,
    viewport?: unknown,
    activeSection?: unknown,
  ) => FeedbackPayload
  postFeedback: (payload: FeedbackPayload) => Promise<{ id: string }>
  FEEDBACK_DOM_MAX: number
  FEEDBACK_CONSOLE_MAX: number
}

function loadNet(): Net {
  const win: Record<string, unknown> = {}
  const code = readFileSync(`${repoRoot}/client-next/review-net.jsx`, 'utf8')
  new Function('window', code)(win)
  return win as unknown as Net
}

const net = loadNet()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildFeedbackPayload — required text', () => {
  it('throws when text is empty or whitespace-only', () => {
    expect(() => net.buildFeedbackPayload('')).toThrow()
    expect(() => net.buildFeedbackPayload('   ')).toThrow()
    expect(() => net.buildFeedbackPayload(undefined)).toThrow()
  })

  it('trims surrounding whitespace off the required text', () => {
    expect(net.buildFeedbackPayload('  hi there  ')).toEqual({ text: 'hi there' })
  })
})

describe('buildFeedbackPayload — optional fields omitted when absent', () => {
  it('emits only text when nothing else is on hand', () => {
    expect(net.buildFeedbackPayload('just text')).toEqual({ text: 'just text' })
  })

  it('drops empty / undefined optionals rather than sending blank values', () => {
    const payload = net.buildFeedbackPayload('t', '', '', '', [], '', '')
    expect(payload).toEqual({ text: 't' })
    expect('category' in payload).toBe(false)
    expect('sessionId' in payload).toBe(false)
    expect('dom' in payload).toBe(false)
    expect('consoleErrors' in payload).toBe(false)
    expect('viewport' in payload).toBe(false)
    expect('activeSection' in payload).toBe(false)
  })

  it('includes each optional field when present', () => {
    const payload = net.buildFeedbackPayload(
      'extraction missed a goal',
      'extract-bug',
      'sess-1',
      '<div>x</div>',
      ['TypeError: boom'],
      '1280x800',
      'goal',
    )
    expect(payload).toEqual({
      text: 'extraction missed a goal',
      category: 'extract-bug',
      sessionId: 'sess-1',
      dom: '<div>x</div>',
      consoleErrors: ['TypeError: boom'],
      viewport: '1280x800',
      activeSection: 'goal',
    })
  })
})

describe('buildFeedbackPayload — size caps', () => {
  it('truncates an oversized dom snapshot to the cap', () => {
    const huge = 'a'.repeat(net.FEEDBACK_DOM_MAX + 5000)
    const payload = net.buildFeedbackPayload('t', undefined, undefined, huge)
    expect(payload.dom!.length).toBeLessThanOrEqual(net.FEEDBACK_DOM_MAX + 32)
    expect(payload.dom!.length).toBeLessThan(huge.length)
    expect(payload.dom!.startsWith('a')).toBe(true)
  })

  it('keeps a dom snapshot under the cap intact', () => {
    const small = '<section>ok</section>'
    const payload = net.buildFeedbackPayload('t', undefined, undefined, small)
    expect(payload.dom).toBe(small)
  })

  it('keeps only the most recent console errors up to the cap', () => {
    const many = Array.from({ length: net.FEEDBACK_CONSOLE_MAX + 10 }, (_, i) => `err ${i}`)
    const payload = net.buildFeedbackPayload('t', undefined, undefined, undefined, many)
    expect(payload.consoleErrors).toHaveLength(net.FEEDBACK_CONSOLE_MAX)
    // last one kept, oldest dropped
    expect(payload.consoleErrors!.at(-1)).toBe(`err ${net.FEEDBACK_CONSOLE_MAX + 9}`)
    expect(payload.consoleErrors).not.toContain('err 0')
  })

  it('coerces console entries to strings', () => {
    const payload = net.buildFeedbackPayload('t', undefined, undefined, undefined, [
      new Error('boom'),
    ] as unknown[])
    expect(payload.consoleErrors!.every((e) => typeof e === 'string')).toBe(true)
  })
})

describe('postFeedback — POST /api/feedback', () => {
  it('POSTs the payload and returns the created id', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ id: 'fb-1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const payload = net.buildFeedbackPayload('doc looks wrong', 'ux', 'sess-1')
    const res = await net.postFeedback(payload)
    expect(res).toEqual({ id: 'fb-1' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })
})
