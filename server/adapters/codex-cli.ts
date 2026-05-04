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

const CODEX_MODEL = process.env.SCRIBEPAD_CODEX_MODEL ?? 'gpt-5.4-mini'
const CODEX_REASONING_EFFORT = process.env.SCRIBEPAD_CODEX_REASONING_EFFORT ?? 'low'

export async function runCodexCli(prompt: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'scribepad-codex-'))
  const outputFile = join(tempDir, 'last-message.txt')

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'codex',
        [
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '--model',
          CODEX_MODEL,
          '--config',
          `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
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
      proc.on('close', (code) => {
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
