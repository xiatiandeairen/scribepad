/**
 * client-next/console-buffer.js — the early console/error ring buffer.
 *
 * Loaded as a plain synchronous script before React/Babel so it captures errors
 * thrown during bootstrap/render; the feedback popover reads the last N entries via
 * window.__recentConsoleErrors() at submit. The module takes its deps (addEventListener
 * / console) off the passed-in window, so we drive it with a stand-in window exactly
 * as client-next-deliver.test.ts evaluates shipped source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type FakeConsole = { error: (...a: unknown[]) => void }
type FakeWindow = {
  addEventListener: (type: string, fn: (e: unknown) => void) => void
  console: FakeConsole
  __recentConsoleErrors?: () => string[]
  __handlers: Record<string, (e: unknown) => void>
}

function loadConsoleBuffer(): { win: FakeWindow; origErrorCalls: unknown[][] } {
  const origErrorCalls: unknown[][] = []
  const win: FakeWindow = {
    __handlers: {},
    addEventListener(type, fn) {
      this.__handlers[type] = fn
    },
    console: {
      error(...args: unknown[]) {
        origErrorCalls.push(args)
      },
    },
  }
  const code = readFileSync(`${repoRoot}/client-next/console-buffer.js`, 'utf8')
  new Function('window', code)(win)
  return { win, origErrorCalls }
}

describe('console-buffer.js — early error ring buffer', () => {
  it('exposes an initially empty reader', () => {
    const { win } = loadConsoleBuffer()
    expect(typeof win.__recentConsoleErrors).toBe('function')
    expect(win.__recentConsoleErrors!()).toEqual([])
  })

  it('captures window error events', () => {
    const { win } = loadConsoleBuffer()
    win.__handlers['error']!({ message: 'boom' })
    expect(win.__recentConsoleErrors!()).toContain('boom')
  })

  it('captures console.error and still forwards to the original', () => {
    const { win, origErrorCalls } = loadConsoleBuffer()
    win.console.error('rendered wrong', 42)
    expect(win.__recentConsoleErrors!().some((e) => e.includes('rendered wrong'))).toBe(true)
    expect(origErrorCalls).toHaveLength(1)
  })

  it('is capacity-bounded to the last 20 entries', () => {
    const { win } = loadConsoleBuffer()
    for (let i = 0; i < 25; i++) win.__handlers['error']!({ message: `e${i}` })
    const buf = win.__recentConsoleErrors!()
    expect(buf).toHaveLength(20)
    expect(buf.at(-1)).toBe('e24')
    expect(buf).not.toContain('e0')
  })

  it('returns a copy so callers cannot mutate the buffer', () => {
    const { win } = loadConsoleBuffer()
    win.__handlers['error']!({ message: 'x' })
    const a = win.__recentConsoleErrors!()
    a.push('injected')
    expect(win.__recentConsoleErrors!()).not.toContain('injected')
  })
})
