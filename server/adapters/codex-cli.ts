/**
 * adapters/codex-cli — wraps the local `codex exec` CLI via subprocess.
 *
 * We run Codex non-interactively, force read-only sandboxing, and capture the
 * final assistant message into a temp file so stdout noise/progress output
 * never corrupts the rewrite JSON contract.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AiConfig } from '../../types/api.js'

export async function runCodexCli(prompt: string, config: AiConfig): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'scribepad-codex-'))
  const outputFile = join(tempDir, 'last-message.txt')

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
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
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )

      let err = ''
      proc.stdout.on('data', () => {
        // output-last-message is the source of truth; ignore stdout chatter.
      })
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`codex timed out after ${config.timeoutMs}ms`))
      }, config.timeoutMs)
      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(err || `codex exit ${code}`))
      })
      proc.on('error', reject)
      proc.stdin.end(prompt)
    })

    return (await readFile(outputFile, 'utf8')).trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
