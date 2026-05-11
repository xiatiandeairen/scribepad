import { runClaudeCli } from '../adapters/claude-cli.js'
import { runCodexCli } from '../adapters/codex-cli.js'
import type { AiConfig, AiProvider, AiState, AiStatusResponse } from '../../types/api.js'

export interface AiRunRequest {
  task: 'rewrite' | 'review-normalize' | 'healthcheck'
  prompt: string
}

interface AiRuntimeStatus {
  state: AiState
  reason?: string
  lastCheckedAt?: string
}

const runtimeStatus: AiRuntimeStatus = {
  state: 'untested',
}

export async function runAi(config: AiConfig, req: AiRunRequest): Promise<string> {
  runtimeStatus.state = 'running'
  try {
    const text = await runProvider(config, req.prompt)
    runtimeStatus.state = 'ready'
    delete runtimeStatus.reason
    runtimeStatus.lastCheckedAt = new Date().toISOString()
    return text
  } catch (e) {
    runtimeStatus.state = classifyError()
    runtimeStatus.reason = String((e as Error).message ?? e)
    runtimeStatus.lastCheckedAt = new Date().toISOString()
    throw e
  }
}

export async function testAi(config: AiConfig): Promise<AiStatusResponse> {
  runtimeStatus.state = 'testing'
  try {
    const text = await runAi(config, {
      task: 'healthcheck',
      prompt: 'Reply exactly: OK',
    })
    if (!/^OK\b/i.test(text.trim())) {
      throw new Error(`${labelFor(config.provider)} test returned unexpected output`)
    }
    runtimeStatus.state = 'ready'
    delete runtimeStatus.reason
  } catch (e) {
    runtimeStatus.state = classifyError()
    runtimeStatus.reason = String((e as Error).message ?? e)
    runtimeStatus.lastCheckedAt = new Date().toISOString()
  }
  return getAiStatus(config)
}

export function markAiUntested(): void {
  runtimeStatus.state = 'untested'
  delete runtimeStatus.reason
  delete runtimeStatus.lastCheckedAt
}

export function getAiStatus(config: AiConfig): AiStatusResponse {
  const state = runtimeStatus.state
  return {
    provider: config.provider,
    label: labelFor(config.provider),
    state,
    available: state === 'ready' || state === 'running' || state === 'untested',
    ...(runtimeStatus.reason ? { reason: runtimeStatus.reason } : {}),
    ...(runtimeStatus.lastCheckedAt ? { lastCheckedAt: runtimeStatus.lastCheckedAt } : {}),
  }
}

async function runProvider(config: AiConfig, prompt: string): Promise<string> {
  switch (config.provider) {
    case 'codex-cli':
      return runCodexCli(prompt, config)
    case 'claude-code-cli':
      return runClaudeCli(prompt, config)
    default: {
      const _exhaustive: never = config.provider
      return _exhaustive
    }
  }
}

function classifyError(): AiState {
  return 'error'
}

function labelFor(provider: AiProvider): string {
  return provider === 'codex-cli' ? 'Codex CLI' : 'Claude Code CLI'
}
