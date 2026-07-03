/**
 * services/ai-status — AI connection health for the /api/ai/* endpoints.
 *
 * Tracks a module-level runtime status and probes the provider through the same
 * execa LlmRunner the rest of the app uses, so there is a single spawn path.
 * The runner is injectable for tests; production builds one from the AI config.
 */
import { createExecaRunner } from '../adapters/llm-execa.js'
import type { LlmRunner } from '../../types/ports.js'
import type { AiConfig, AiProvider, AiState, AiStatusResponse } from '../../types/api.js'

interface AiRuntimeStatus {
  state: AiState
  reason?: string
  lastCheckedAt?: string
}

const runtimeStatus: AiRuntimeStatus = { state: 'untested' }

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

/**
 * Probe the provider with a fixed healthcheck prompt and record the outcome.
 * `runner` is injected in tests; defaults to an execa runner for `config`.
 */
export async function testAi(
  config: AiConfig,
  runner: LlmRunner = createExecaRunner(config),
): Promise<AiStatusResponse> {
  runtimeStatus.state = 'testing'
  const result = await runner.run({ prompt: 'Reply exactly: OK' })
  if (result.ok && /^OK\b/i.test(result.value.trim())) {
    runtimeStatus.state = 'ready'
    delete runtimeStatus.reason
    delete runtimeStatus.lastCheckedAt
  } else {
    runtimeStatus.state = 'error'
    runtimeStatus.reason = result.ok
      ? `${labelFor(config.provider)} test returned unexpected output`
      : result.error.message
    runtimeStatus.lastCheckedAt = new Date().toISOString()
  }
  return getAiStatus(config)
}

function labelFor(provider: AiProvider): string {
  return provider === 'codex-cli' ? 'Codex CLI' : 'Claude Code CLI'
}
