/**
 * llm-execa — LlmRunner adapter that spawns provider CLIs via execa.
 *
 * Returns Result instead of throwing, and uses execa v9 (pure ESM) for clean
 * subprocess management.
 *
 * Error mapping:
 *   timeout     → execa timedOut flag
 *   spawn       → ENOENT (command not found)
 *   nonzero-exit → process exited with non-zero code
 *   empty-output → stdout/file was empty after trim
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execa, ExecaError } from 'execa'
import type { AiConfig } from '../../types/api.js'
import type { LlmRunner, LlmRunRequest, LlmError } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import { ok, err } from '../../core/result.js'

/**
 * Creates a LlmRunner backed by the provider CLI configured in AiConfig.
 * The provider (claude vs codex) is resolved once at construction time.
 * Callers pass only the prompt; timeout falls back to config.timeoutMs.
 */
export function createExecaRunner(config: AiConfig): LlmRunner {
  return {
    async run(req: LlmRunRequest): Promise<Result<string, LlmError>> {
      const timeoutMs = req.timeoutMs ?? config.timeoutMs
      try {
        const text =
          config.provider === 'codex-cli'
            ? await runCodex(config, req.prompt, timeoutMs)
            : await runClaude(config, req.prompt, timeoutMs)

        if (!text) {
          return err({ kind: 'empty-output', message: 'LLM returned empty output' })
        }
        return ok(text)
      } catch (e) {
        return err(classifyError(e, config, timeoutMs))
      }
    },
  }
}

async function runClaude(config: AiConfig, prompt: string, timeoutMs: number): Promise<string> {
  // claude: command + [...args, prompt], capture stdout.
  const result = await execa(config.claude.command, [...config.claude.args, prompt], {
    timeout: timeoutMs,
  })
  return result.stdout.trim()
}

async function runCodex(config: AiConfig, prompt: string, timeoutMs: number): Promise<string> {
  // codex: prompt goes to stdin, output-last-message to a temp file because
  // codex stdout is chatty progress noise.
  const tempDir = await mkdtemp(join(tmpdir(), 'scribepad-execa-'))
  const outputFile = join(tempDir, 'last-message.txt')
  try {
    await execa(
      config.codex.command,
      [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        config.codex.sandbox,
        '--model',
        config.codex.model,
        '--config',
        `model_reasoning_effort="${config.codex.reasoningEffort}"`,
        '--output-last-message',
        outputFile,
        '-',
      ],
      { input: prompt, timeout: timeoutMs },
    )
    return (await readFile(outputFile, 'utf8')).trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function classifyError(e: unknown, config: AiConfig, timeoutMs: number): LlmError {
  if (!(e instanceof ExecaError)) {
    return { kind: 'spawn', message: String(e) }
  }
  if (e.timedOut) {
    return {
      kind: 'timeout',
      message: `${config.provider} timed out after ${timeoutMs}ms`,
    }
  }
  // ENOENT = command binary not found on PATH
  const cause = e.cause as { code?: string } | undefined
  const isEnoent =
    cause?.code === 'ENOENT' ||
    (e as unknown as { code?: string }).code === 'ENOENT' ||
    e.message.includes('ENOENT')
  if (isEnoent) {
    return {
      kind: 'spawn',
      message: `${config.provider}: command not found (${e.command ?? config.provider})`,
    }
  }
  return {
    kind: 'nonzero-exit',
    message: e.stderr || e.shortMessage || e.message,
  }
}
