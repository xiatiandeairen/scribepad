/**
 * Characterization tests for server/services/ai.ts.
 *
 * Locks:
 *   - getAiStatus available-computation (ready/running/untested → true, rest → false)
 *   - markAiUntested resets the module-level singleton
 *   - runProvider dispatch — codex-cli calls runCodexCli; claude-code-cli calls runClaudeCli
 *   - label strings returned by getAiStatus
 *
 * NOTE: runtimeStatus is module-level mutable state. Tests use beforeEach to
 * call markAiUntested() so each test starts from a known clean slate.
 *
 * Adapters are mocked so no real subprocess is spawned.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

// vi.mock is hoisted before imports by vitest, so ai.ts receives mocked adapters.
vi.mock('../../server/adapters/claude-cli.js', () => ({
  runClaudeCli: vi.fn(),
}))
vi.mock('../../server/adapters/codex-cli.js', () => ({
  runCodexCli: vi.fn(),
}))

import { runAi, getAiStatus, markAiUntested } from '../../server/services/ai.js'
import { runClaudeCli } from '../../server/adapters/claude-cli.js'
import { runCodexCli } from '../../server/adapters/codex-cli.js'
import type { AiConfig, AiProvider } from '../../types/api.js'

const mockedClaudeCli = vi.mocked(runClaudeCli)
const mockedCodexCli = vi.mocked(runCodexCli)

function makeConfig(provider: AiProvider): AiConfig {
  return {
    provider,
    timeoutMs: 5000,
    codex: {
      command: 'codex',
      model: 'o4-mini',
      reasoningEffort: 'medium',
      sandbox: 'read-only',
    },
    claude: {
      command: 'claude',
      args: ['-p'],
    },
  }
}

beforeEach(() => {
  markAiUntested()
  mockedClaudeCli.mockReset()
  mockedCodexCli.mockReset()
})

// ---------------------------------------------------------------------------
// getAiStatus — available computation
// ---------------------------------------------------------------------------

describe('getAiStatus — available computation', () => {
  it('returns available=true when state is untested (initial state)', () => {
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('untested')
    expect(status.available).toBe(true)
  })

  it('returns available=true when state is ready (after successful runAi)', async () => {
    mockedClaudeCli.mockResolvedValue('ok')
    await runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' })

    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('ready')
    expect(status.available).toBe(true)
  })

  it('returns available=false when state is error (after failed runAi)', async () => {
    mockedClaudeCli.mockRejectedValue(new Error('timeout'))
    await expect(
      runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' }),
    ).rejects.toThrow('timeout')

    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('error')
    expect(status.available).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// markAiUntested — singleton reset
// ---------------------------------------------------------------------------

describe('markAiUntested', () => {
  it('resets state to untested after a successful run', async () => {
    mockedClaudeCli.mockResolvedValue('ok')
    await runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' })
    expect(getAiStatus(makeConfig('claude-code-cli')).state).toBe('ready')

    markAiUntested()
    expect(getAiStatus(makeConfig('claude-code-cli')).state).toBe('untested')
  })

  it('resets state to untested after a failed run', async () => {
    mockedClaudeCli.mockRejectedValue(new Error('boom'))
    await expect(
      runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' }),
    ).rejects.toThrow()
    expect(getAiStatus(makeConfig('claude-code-cli')).state).toBe('error')

    markAiUntested()
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.state).toBe('untested')
    expect(status.available).toBe(true)
  })

  it('clears reason and lastCheckedAt after reset', async () => {
    mockedClaudeCli.mockRejectedValue(new Error('some error'))
    await expect(
      runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' }),
    ).rejects.toThrow()

    markAiUntested()
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.reason).toBeUndefined()
    expect(status.lastCheckedAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// runProvider dispatch — which adapter is called
// ---------------------------------------------------------------------------

describe('runProvider dispatch', () => {
  it('calls runClaudeCli (not runCodexCli) when provider is claude-code-cli', async () => {
    mockedClaudeCli.mockResolvedValue('claude output')
    mockedCodexCli.mockResolvedValue('codex output')

    const result = await runAi(makeConfig('claude-code-cli'), {
      task: 'rewrite',
      prompt: 'test prompt',
    })

    expect(result).toBe('claude output')
    expect(mockedClaudeCli).toHaveBeenCalledOnce()
    expect(mockedCodexCli).not.toHaveBeenCalled()
  })

  it('calls runCodexCli (not runClaudeCli) when provider is codex-cli', async () => {
    mockedClaudeCli.mockResolvedValue('claude output')
    mockedCodexCli.mockResolvedValue('codex output')

    const result = await runAi(makeConfig('codex-cli'), {
      task: 'rewrite',
      prompt: 'test prompt',
    })

    expect(result).toBe('codex output')
    expect(mockedCodexCli).toHaveBeenCalledOnce()
    expect(mockedClaudeCli).not.toHaveBeenCalled()
  })

  it('passes the prompt string to the adapter', async () => {
    mockedClaudeCli.mockResolvedValue('ok')
    await runAi(makeConfig('claude-code-cli'), { task: 'rewrite', prompt: 'my prompt text' })

    expect(mockedClaudeCli).toHaveBeenCalledWith('my prompt text', expect.any(Object))
  })
})

// ---------------------------------------------------------------------------
// getAiStatus — label and provider passthrough
// ---------------------------------------------------------------------------

describe('getAiStatus — label and provider fields', () => {
  it('returns label "Codex CLI" for codex-cli provider', () => {
    const status = getAiStatus(makeConfig('codex-cli'))
    expect(status.provider).toBe('codex-cli')
    expect(status.label).toBe('Codex CLI')
  })

  it('returns label "Claude Code CLI" for claude-code-cli provider', () => {
    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.provider).toBe('claude-code-cli')
    expect(status.label).toBe('Claude Code CLI')
  })
})

// ---------------------------------------------------------------------------
// getAiStatus — error state includes reason and lastCheckedAt
// ---------------------------------------------------------------------------

describe('getAiStatus — error state fields', () => {
  it('includes reason in status after a failed run', async () => {
    mockedClaudeCli.mockRejectedValue(new Error('connection refused'))
    await expect(
      runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' }),
    ).rejects.toThrow()

    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.reason).toContain('connection refused')
  })

  it('includes lastCheckedAt in status after a failed run', async () => {
    mockedClaudeCli.mockRejectedValue(new Error('oops'))
    await expect(
      runAi(makeConfig('claude-code-cli'), { task: 'healthcheck', prompt: 'ping' }),
    ).rejects.toThrow()

    const status = getAiStatus(makeConfig('claude-code-cli'))
    expect(status.lastCheckedAt).toBeDefined()
    expect(new Date(status.lastCheckedAt!).getFullYear()).toBeGreaterThanOrEqual(2026)
  })
})
