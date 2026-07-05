/**
 * Production-session E2E (API-driven).
 *
 * Covers the repo-local shared server model as a pure CLI/HTTP contract — no
 * browser, no SPA. The session lifecycle is driven straight through the server's
 * own endpoints:
 *   - first CLI command starts the server and opens one document session;
 *   - second CLI command reuses the same server and opens another session;
 *   - GET /api/sessions/:id/file serves each session's isolated document;
 *   - POST /api/sessions/:id/done closes that session and exports final markdown
 *     (this is the same gate the /next Done button and `--wait` block on);
 *   - when all sessions are Done, the shared server exits after active idle.
 *
 * Driving Done via the HTTP endpoint (instead of a UI button) is the point: the
 * `--wait` blocking gate and the export path are server contracts, independent of
 * any frontend.
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registryPath } from '../../server/registry'
import { exportPathFor } from '../../server/paths'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')

type CliServer = {
  child: ChildProcessWithoutNullStreams
  origin: string
  sessionId: string
}

test.describe('shared production server sessions', () => {
  test.beforeEach(async () => {
    await cleanupRegistryServer()
  })

  test.afterEach(async () => {
    await cleanupRegistryServer()
  })

  test('one repo server can host two document sessions and exits after both are Done', async () => {
    test.setTimeout(45_000)

    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-e2e-'))
    const configPath = join(tmp, 'config.json')
    const firstDoc = join(tmp, 'first.md')
    const secondDoc = join(tmp, 'second.md')
    await writeFile(
      configPath,
      JSON.stringify({ activeIdleMs: 10_000, initialIdleMs: 600_000 }),
      'utf8',
    )
    await writeFile(firstDoc, '# First Plan\n\nFirst document body.\n', 'utf8')
    await writeFile(secondDoc, '# Second Plan\n\nSecond document body.\n', 'utf8')

    const env = makeEnv(tmp, configPath)
    const first = await startCli(firstDoc, env)
    const second = await runCliToCompletion(secondDoc, env)

    // registry reuse: one repo server hosts both, with distinct sessions.
    expect(second.origin).toBe(first.origin)
    expect(second.sessionId).not.toBe(first.sessionId)

    const health = await fetch(`${first.origin}/api/healthz`)
    await expect(health.json()).resolves.toEqual({ ok: true })

    // Each session serves its own isolated document.
    await assertSessionDocument(first.origin, first.sessionId, 'First Plan', 'First document body.')
    await assertSessionDocument(
      second.origin,
      second.sessionId,
      'Second Plan',
      'Second document body.',
    )

    // Done the first session via the server's done endpoint — the export gate.
    const firstOut = await postDone(first.origin, first.sessionId)
    expect(firstOut).toBe(agentPathFor(firstDoc, env))
    await expect.poll(() => sessionExists(first.origin, first.sessionId)).toBe(false)
    await expect.poll(() => sessionExists(second.origin, second.sessionId)).toBe(true)
    await expect(readFile(agentPathFor(firstDoc, env), 'utf8')).resolves.toBe(
      '# First Plan\n\nFirst document body.\n',
    )

    const secondOut = await postDone(second.origin, second.sessionId)
    expect(secondOut).toBe(agentPathFor(secondDoc, env))
    await expect.poll(() => sessionExists(second.origin, second.sessionId)).toBe(false)
    await expect(readFile(agentPathFor(secondDoc, env), 'utf8')).resolves.toBe(
      '# Second Plan\n\nSecond document body.\n',
    )

    // Both sessions Done → shared server exits after active idle.
    await expectProcessExit(first.child, 20_000)
  })

  test('wait mode prints only the approved export path after Done', async () => {
    test.setTimeout(45_000)

    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-wait-e2e-'))
    const configPath = join(tmp, 'config.json')
    const doc = join(tmp, 'wait.md')
    await writeFile(
      configPath,
      JSON.stringify({ activeIdleMs: 10_000, initialIdleMs: 600_000 }),
      'utf8',
    )
    await writeFile(doc, '# Wait Plan\n\nReviewed by human.\n', 'utf8')

    const env = makeEnv(tmp, configPath)
    const waitCli = await startWaitCli(doc, env)
    await assertSessionDocument(
      waitCli.origin,
      waitCli.sessionId,
      'Wait Plan',
      'Reviewed by human.',
    )

    // Attach the stdout waiter before Done so the printed path can't be missed.
    const exited = waitForStdoutOnExit(waitCli.child, 20_000)
    await postDone(waitCli.origin, waitCli.sessionId)
    const stdout = await exited

    const outputPath = stdout.trim()
    expect(outputPath).toBe(agentPathFor(doc, env))
    expect(stdout).toBe(`${outputPath}\n`)
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('# Wait Plan\n\nReviewed by human.\n')
  })

  test('wait mode works when reusing an existing repo server', async () => {
    test.setTimeout(45_000)

    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-wait-reuse-e2e-'))
    const configPath = join(tmp, 'config.json')
    const firstDoc = join(tmp, 'first.md')
    const waitDoc = join(tmp, 'wait.md')
    await writeFile(
      configPath,
      JSON.stringify({ activeIdleMs: 10_000, initialIdleMs: 600_000 }),
      'utf8',
    )
    await writeFile(firstDoc, '# First Plan\n\nKeep server alive.\n', 'utf8')
    await writeFile(waitDoc, '# Wait Plan\n\nReuse existing server.\n', 'utf8')

    const env = makeEnv(tmp, configPath)
    const first = await startCli(firstDoc, env)
    const waitCli = await startWaitCli(waitDoc, env)

    expect(waitCli.origin).toBe(first.origin)
    expect(waitCli.sessionId).not.toBe(first.sessionId)

    await assertSessionDocument(
      waitCli.origin,
      waitCli.sessionId,
      'Wait Plan',
      'Reuse existing server.',
    )

    const waitExited = waitForStdoutOnExit(waitCli.child, 20_000)
    await postDone(waitCli.origin, waitCli.sessionId)
    const stdout = await waitExited

    const outputPath = stdout.trim()
    expect(outputPath).toBe(agentPathFor(waitDoc, env))
    expect(stdout).toBe(`${outputPath}\n`)
    // The shared server stays up because the first session is still active.
    await expect.poll(() => sessionExists(first.origin, first.sessionId)).toBe(true)

    await assertSessionDocument(first.origin, first.sessionId, 'First Plan', 'Keep server alive.')
    await postDone(first.origin, first.sessionId)
    await expectProcessExit(first.child, 20_000)
  })
})

function makeEnv(tmp: string, configPath: string): Record<string, string> {
  return {
    SCRIBEPAD_CONFIG: configPath,
    XDG_CONFIG_HOME: join(tmp, 'xdg-config'),
    XDG_STATE_HOME: join(tmp, 'xdg-state'),
    XDG_RUNTIME_DIR: join(tmp, 'xdg-runtime'),
  }
}

async function assertSessionDocument(
  origin: string,
  sessionId: string,
  title: string,
  body: string,
): Promise<void> {
  const res = await fetch(`${origin}/api/sessions/${sessionId}/file`)
  expect(res.ok).toBe(true)
  const doc = (await res.json()) as { content: string }
  expect(doc.content).toContain(title)
  expect(doc.content).toContain(body)
}

async function postDone(origin: string, sessionId: string): Promise<string> {
  const res = await fetch(`${origin}/api/sessions/${sessionId}/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(res.ok).toBe(true)
  const body = (await res.json()) as { ok: boolean; outputPath: string }
  expect(body.ok).toBe(true)
  return body.outputPath
}

async function sessionExists(origin: string, sessionId: string): Promise<boolean> {
  const res = await fetch(`${origin}/api/sessions/${sessionId}`)
  return res.ok
}

async function startCli(filePath: string, extraEnv: Record<string, string>): Promise<CliServer> {
  const child = spawnCli([SERVER_ENTRY, filePath], extraEnv)
  return resolveCliServer(child, 'stdout')
}

async function runCliToCompletion(
  filePath: string,
  extraEnv: Record<string, string>,
): Promise<{ origin: string; sessionId: string }> {
  const child = spawnCli([SERVER_ENTRY, filePath], extraEnv)
  const server = await resolveCliServer(child, 'stdout')
  await expectProcessExit(child, 5_000)
  return { origin: server.origin, sessionId: server.sessionId }
}

async function startWaitCli(
  filePath: string,
  extraEnv: Record<string, string>,
): Promise<CliServer> {
  const child = spawnCli([SERVER_ENTRY, filePath, '--wait'], extraEnv)
  // In --wait mode the CLI logs go to stderr; stdout is reserved for the export path.
  return resolveCliServer(child, 'stderr')
}

function spawnCli(
  argv: string[],
  extraEnv: Record<string, string>,
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, argv, {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
  })
}

/**
 * Resolve the running server's origin + this CLI's session id from its logs.
 * A fresh server logs the `/next/` panel URL (origin only) — the session id is
 * then read back from the fallback-session endpoint. A CLI that reuses an
 * existing server logs the `/s/<id>` session URL directly.
 */
async function resolveCliServer(
  child: ChildProcessWithoutNullStreams,
  stream: 'stdout' | 'stderr',
): Promise<CliServer> {
  const info = await waitForServerInfo(child, stream)
  const sessionId = info.sessionId ?? (await fetchFallbackSessionId(info.origin))
  return { child, origin: info.origin, sessionId }
}

async function fetchFallbackSessionId(origin: string): Promise<string> {
  const res = await fetch(`${origin}/api/session`)
  if (!res.ok) throw new Error(`GET /api/session failed: ${res.status}`)
  const body = (await res.json()) as { id?: string }
  if (!body.id) throw new Error('session response missing id')
  return body.id
}

function waitForServerInfo(
  child: ChildProcessWithoutNullStreams,
  stream: 'stdout' | 'stderr',
): Promise<{ origin: string; sessionId?: string }> {
  return new Promise((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('timed out waiting for server URL')), 10_000)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      // Reuse CLIs print the `/s/<id>` session URL; fresh CLIs print the `/next/` panel URL.
      const sessionMatch = buffer.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/s\/([^\s]+)/)
      if (sessionMatch) {
        clearTimeout(timer)
        child[stream].off('data', onData)
        resolvePromise({ origin: new URL(sessionMatch[0]).origin, sessionId: sessionMatch[1] })
        return
      }
      const panelMatch = buffer.match(/(http:\/\/(?:127\.0\.0\.1|localhost):\d+)\/next\//)
      if (panelMatch) {
        clearTimeout(timer)
        child[stream].off('data', onData)
        resolvePromise({ origin: panelMatch[1] })
      }
    }
    child[stream].on('data', onData)
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      if (text.includes('Error:')) {
        clearTimeout(timer)
        reject(new Error(text))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`CLI exited before URL, code=${code}`))
    })
  })
}

function waitForStdoutOnExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`CLI exited with code=${code}: ${stderr}`))
        return
      }
      resolvePromise(stdout)
    })
  })
}

function expectProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (child.exitCode !== null) {
      resolvePromise()
      return
    }
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

async function cleanupRegistryServer(): Promise<void> {
  const registryCandidates = [registryPath(REPO_ROOT), resolve(REPO_ROOT, '.scribepad/server.json')]
  for (const registryFile of registryCandidates) {
    await cleanupRegistryFile(registryFile)
  }
}

async function cleanupRegistryFile(registryFile: string): Promise<void> {
  if (existsSync(registryFile)) {
    try {
      const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as { pid?: number }
      if (typeof registry.pid === 'number') {
        try {
          process.kill(registry.pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
    } catch {
      // Invalid registry; remove below.
    }
  }
  await rm(registryFile, { force: true })
}

function agentPathFor(filePath: string, env: Record<string, string>): string {
  return exportPathFor(REPO_ROOT, filePath, env)
}
