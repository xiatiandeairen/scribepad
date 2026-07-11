/**
 * Server-link awareness — pure pieces of the panel's heartbeat wiring.
 *
 * Background: the connect/heartbeat routes existed server-side only; the panel
 * never called them, so a dead server left a fully-interactive page whose every
 * write failed with a bare "Failed to fetch" at click time. These tests pin the
 * pure half (link state machine + error classification + REST wrappers) loaded
 * from review-net.jsx with a stand-in window, exactly as the sibling
 * client-next-*.test.ts files do. The interval wiring and banner rendering are
 * covered by tests/e2e/server-link.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type LinkState = { status: 'up' | 'down'; fails: number }

type Net = {
  LINK_FAIL_THRESHOLD: number
  linkTransition: (state: LinkState, event: 'ok' | 'fail') => LinkState
  linkEventOfError: (e: unknown) => 'ok' | 'fail'
  connectReviewSession: (sessionId: string) => Promise<{ clientId: string }>
  postHeartbeat: (sessionId: string, clientId: string) => Promise<unknown>
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

describe('linkTransition — link state machine', () => {
  const up: LinkState = { status: 'up', fails: 0 }

  it('stays up on a single failure (transient blip tolerated)', () => {
    expect(net.linkTransition(up, 'fail')).toEqual({ status: 'up', fails: 1 })
  })

  it('goes down after LINK_FAIL_THRESHOLD consecutive failures', () => {
    let state = up
    for (let i = 0; i < net.LINK_FAIL_THRESHOLD; i += 1) {
      state = net.linkTransition(state, 'fail')
    }
    expect(state.status).toBe('down')
  })

  it('a success resets both status and the failure counter', () => {
    const down = net.linkTransition(net.linkTransition(up, 'fail'), 'fail')
    expect(down.status).toBe('down')
    expect(net.linkTransition(down, 'ok')).toEqual({ status: 'up', fails: 0 })
  })

  it('an interleaved success prevents two non-consecutive failures from tripping it', () => {
    let state = net.linkTransition(up, 'fail')
    state = net.linkTransition(state, 'ok')
    state = net.linkTransition(state, 'fail')
    expect(state.status).toBe('up')
  })
})

describe('linkEventOfError — HTTP response means the server is alive', () => {
  it('classifies an error carrying an HTTP status as link-ok (server responded)', () => {
    const httpError = Object.assign(new Error('404 Not Found'), { status: 404 })
    expect(net.linkEventOfError(httpError)).toBe('ok')
  })

  it('classifies a network-level error (no status) as link-fail', () => {
    expect(net.linkEventOfError(new TypeError('Failed to fetch'))).toBe('fail')
    expect(net.linkEventOfError(undefined)).toBe('fail')
  })
})

describe('connect / heartbeat REST wrappers', () => {
  it('connectReviewSession POSTs to the session connect route', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ clientId: 'c-1', session: { id: 'sess-1' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await net.connectReviewSession('sess-1')
    expect(res.clientId).toBe('c-1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/sess-1/connect')
    expect(init.method).toBe('POST')
  })

  it('postHeartbeat POSTs the clientId to the heartbeat route', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'sess-1' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await net.postHeartbeat('sess-1', 'c-1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/sess-1/heartbeat')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ clientId: 'c-1' })
  })
})
