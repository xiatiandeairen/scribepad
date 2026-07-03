import { describe, it, expect, beforeEach } from 'vitest'
import { testAi, getAiStatus, markAiUntested } from '../../server/services/ai-status.js'
import type { LlmRunner } from '../../types/ports.js'
import type { AiConfig, AiProvider } from '../../types/api.js'

function makeConfig(provider: AiProvider): AiConfig {
  return {
    provider,
    timeoutMs: 5000,
    codex: { command: 'codex', model: 'o4-mini', reasoningEffort: 'medium', sandbox: 'read-only' },
    claude: { command: 'claude', args: ['-p'] },
  }
}

const okRunner = (text: string): LlmRunner => ({ run: async () => ({ ok: true, value: text }) })
const errRunner = (message: string): LlmRunner => ({
  run: async () => ({ ok: false, error: { kind: 'spawn', message } }),
})

beforeEach(() => markAiUntested())

describe('getAiStatus — available computation', () => {
  it('untested (initial) is available', () => {
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('untested')
    expect(status.available).toBe(true)
  })

  it('ready after a passing healthcheck', async () => {
    await testAi(makeConfig('claude-code-cli'), okRunner('OK'))
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('ready')
    expect(status.available).toBe(true)
  })

  it('error (unavailable) after a failing healthcheck, with reason + lastCheckedAt', async () => {
    await testAi(makeConfig('claude-code-cli'), errRunner('connection refused'))
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('error')
    expect(status.available).toBe(false)
    expect(status.reason).toContain('connection refused')
    expect(status.lastCheckedAt).toBeDefined()
  })

  it('error when the provider replies with unexpected output', async () => {
    await testAi(makeConfig('codex-cli'), okRunner('nope'))
    expect(getAiStatus(makeConfig('codex-cli')).state).toBe('error')
  })
})

describe('markAiUntested', () => {
  it('resets state and clears reason / lastCheckedAt', async () => {
    await testAi(makeConfig('claude-code-cli'), errRunner('boom'))
    markAiUntested()
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('untested')
    expect(status.available).toBe(true)
    expect(status.reason).toBeUndefined()
    expect(status.lastCheckedAt).toBeUndefined()
  })
})

describe('getAiStatus — label / provider passthrough', () => {
  it('labels codex-cli', () => {
    const status = getAiStatus(makeConfig('codex-cli'))
    expect(status.provider).toBe('codex-cli')
    expect(status.label).toBe('Codex CLI')
  })

  it('labels claude-code-cli', () => {
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.provider).toBe('claude-code-cli')
    expect(status.label).toBe('Claude Code CLI')
  })
})
