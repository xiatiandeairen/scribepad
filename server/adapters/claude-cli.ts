/**
 * adapters/claude-cli — wraps the local `claude` CLI (Claude Code) via subprocess.
 *
 * Foundation skeleton. Single adapter today (claude). v0.3 will introduce
 * sibling adapters (cursor / aider / etc.) under a shared interface — the
 * interface is intentionally NOT designed yet, since 1-implementation
 * "abstractions" are a common over-engineering trap.
 */
import { spawn } from 'node:child_process'

export function runClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt])
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(err || `claude exit ${code}`))
    })
    proc.on('error', reject)
  })
}
