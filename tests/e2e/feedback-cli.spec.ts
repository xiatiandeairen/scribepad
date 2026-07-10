/**
 * `scribepad feedback` CLI E2E.
 *
 * Covers the CLI feedback intake as a pure process/filesystem contract — no
 * server needs to be running (submits straight through FeedbackSink) and no
 * browser. Spawns the built CLI entry directly and inspects the resulting
 * `inbox.jsonl` line, mirroring how session-server.spec.ts drives the
 * document-opening CLI path.
 */
import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)))
const REPO_ROOT = resolve(__dirname, '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')

test.describe('scribepad feedback CLI', () => {
  test('records a feedback entry to the inbox and exits cleanly', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-feedback-e2e-'))
    const env = makeEnv(tmp)

    try {
      const result = await runCli(['feedback', 'test message'], env)
      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/test message|反馈|feedback/i)

      const inboxPath = join(tmp, 'xdg-state', 'scribepad', 'feedback', 'inbox.jsonl')
      const lines = (await readFile(inboxPath, 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(1)
      const entry = JSON.parse(lines[0]) as { source: string; text: string }
      expect(entry.source).toBe('cli')
      expect(entry.text).toBe('test message')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('exits non-zero with usage when no text is given', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-feedback-e2e-'))
    const env = makeEnv(tmp)

    try {
      const result = await runCli(['feedback'], env)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(/usage/i)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('opens a real file literally named "feedback" instead of the subcommand', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-feedback-e2e-'))
    const env = makeEnv(tmp)
    const docPath = join(tmp, 'feedback')
    await writeFile(docPath, '# Feedback doc\n\nThis file is literally named `feedback`.\n', 'utf8')

    let child: Awaited<ReturnType<typeof spawnCli>> | undefined
    try {
      // A trailing text arg makes this unambiguous: if the buggy code takes
      // the subcommand branch, it submits "not a real report" as feedback
      // text and exits immediately after printing a confirmation. If the fix
      // holds, that text is simply an ignored extra positional and the doc at
      // ./feedback opens as a session instead (process keeps running).
      child = spawnCli(['feedback', 'not a real report'], env, tmp)
      await sleep(1500)
      expect(child.stdoutSoFar()).not.toMatch(/feedback recorded/i)

      const inboxPath = join(tmp, 'xdg-state', 'scribepad', 'feedback', 'inbox.jsonl')
      await expect(access(inboxPath)).rejects.toThrow()
    } finally {
      child?.kill()
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

function makeEnv(tmp: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: join(tmp, 'xdg-config'),
    XDG_STATE_HOME: join(tmp, 'xdg-state'),
    XDG_RUNTIME_DIR: join(tmp, 'xdg-runtime'),
  }
}

function runCli(
  argv: string[],
  extraEnv: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY, ...argv], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const timer = setTimeout(() => reject(new Error('CLI did not exit in time')), 15_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** Spawns the CLI without waiting for exit — for cases that stay running (doc-open, no --wait). */
function spawnCli(argv: string[], extraEnv: Record<string, string>, cwd: string) {
  let stdout = ''
  const child = spawn(process.execPath, [SERVER_ENTRY, ...argv], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
  })
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  return {
    stdoutSoFar: () => stdout,
    kill: () => child.kill('SIGTERM'),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
