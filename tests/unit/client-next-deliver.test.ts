/**
 * P7 — new frontend (client-next/) "完成审阅 · 交付" wiring.
 *
 * The button + its handler live in a React component (plan-app.jsx) that needs a
 * DOM to exercise; there is no build step. What *is* pure and shippable-source
 * testable is the network call that closes the `--wait` gate and the delivery
 * state machine the button reads. As in client-next-agent-net.test.ts we evaluate
 * the shipped source with a stand-in window and assert against the exact code the
 * browser ships:
 *
 *  1. postDone           — POST /api/sessions/:id/done with the current review source
 *  2. deliverTransition  — idle → delivering → delivered (terminal) state machine
 *  3. deliverButton      — delivery state + session presence → button presentation
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type DeliverState = 'idle' | 'delivering' | 'delivered'
type DeliverEvent = 'start' | 'ok' | 'fail'
type DeliverButton = { disabled: boolean; done: boolean; label: string }

type Net = {
  postDone: (sessionId: string, content?: string) => Promise<{ ok: true; outputPath: string }>
  deliverTransition: (state: DeliverState, event: DeliverEvent) => DeliverState
  deliverButton: (state: DeliverState, hasSession: boolean) => DeliverButton
}

// Evaluate the shipped plan-net source with a stand-in window; harvest exports.
function loadNet(): Net {
  const win: Record<string, unknown> = {}
  const code = readFileSync(`${repoRoot}/client-next/plan-net.jsx`, 'utf8')
  new Function('window', code)(win)
  return win as unknown as Net
}

const net = loadNet()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postDone: close the --wait agent review gate', () => {
  function stubFetch() {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, outputPath: '/repo/.scribepad/plan.md' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('POSTs the reviewed source to /sessions/:id/done', async () => {
    const fetchMock = stubFetch()
    const res = await net.postDone('sess-1', '# approved plan\n')
    expect(res).toEqual({ ok: true, outputPath: '/repo/.scribepad/plan.md' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/sessions/sess-1/done')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ content: '# approved plan\n' })
  })

  it('encodes the session id in the path', async () => {
    const fetchMock = stubFetch()
    await net.postDone('sess/weird id', 'x')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/sessions/sess%2Fweird%20id/done')
  })

  it('sends an empty body when no source is given (server exports the file on disk)', async () => {
    const fetchMock = stubFetch()
    await net.postDone('sess-1', undefined)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBeUndefined()
  })
})

describe('deliverTransition: idle → delivering → delivered', () => {
  it('advances through the happy path', () => {
    expect(net.deliverTransition('idle', 'start')).toBe('delivering')
    expect(net.deliverTransition('delivering', 'ok')).toBe('delivered')
  })

  it('falls back to idle so a failed delivery can be retried', () => {
    expect(net.deliverTransition('delivering', 'fail')).toBe('idle')
  })

  it('treats delivered as terminal (delivery is not reversible)', () => {
    expect(net.deliverTransition('delivered', 'start')).toBe('delivered')
    expect(net.deliverTransition('delivered', 'fail')).toBe('delivered')
    expect(net.deliverTransition('delivered', 'ok')).toBe('delivered')
  })
})

describe('deliverButton: delivery state → button presentation', () => {
  it('is disabled with no session (nothing to deliver)', () => {
    expect(net.deliverButton('idle', false)).toEqual({
      disabled: true,
      done: false,
      label: '完成审阅 · 交付',
    })
  })

  it('is actionable when idle with a session', () => {
    expect(net.deliverButton('idle', true)).toEqual({
      disabled: false,
      done: false,
      label: '完成审阅 · 交付',
    })
  })

  it('disables and relabels while delivering and once delivered', () => {
    expect(net.deliverButton('delivering', true)).toMatchObject({ disabled: true, done: false })
    expect(net.deliverButton('delivered', true)).toEqual({
      disabled: true,
      done: true,
      label: '已交付给 agent',
    })
  })
})
