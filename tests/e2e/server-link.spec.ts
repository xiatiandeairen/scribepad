/**
 * Server-link banner E2E — the panel must not fail silently when its server dies.
 *
 * Background: the `--wait` server can die before the page does (it lives as an
 * agent-session background task and gets SIGTERMed on session cleanup). Before
 * the heartbeat wiring, the page stayed fully interactive and every write
 * (feedback / signoff / deliver) failed only at click time with a bare
 * "Failed to fetch". This spec kills the server under a live page and pins the
 * visible consequence: the .link-banner appears and the deliver button disables.
 * The pure link state machine (threshold / recovery) is unit-tested in
 * tests/unit/client-next-server-link.test.ts; recovery needs a same-port
 * restart which PORT=0 cannot provide, so it is not driven here.
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')
const FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/review-standard.md')

type Server = { child: ChildProcessWithoutNullStreams; origin: string; tmp: string; doc: string }

test('shows the disconnect banner and disables deliver after the server dies', async ({
  browser,
}) => {
  // Heartbeat interval is 5s and the link trips after 2 consecutive failures,
  // so detection lands within ~12s of the kill; budget generously above that.
  test.setTimeout(90_000)
  const server = await startServer(FIXTURE)
  try {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`${server.origin}/next/?doc=${encodeURIComponent(server.doc)}`)
    await expect(page.locator('.sec-h[data-sec="verdicts"]')).toBeVisible({ timeout: 25_000 })

    // Live server: no banner, deliver enabled.
    await expect(page.locator('.link-banner')).toHaveCount(0)
    await expect(page.locator('.tb-deliver')).toBeEnabled()

    server.child.kill('SIGKILL')

    await expect(page.locator('.link-banner')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.link-banner')).toContainText('服务器已断开')
    await expect(page.locator('.tb-deliver')).toBeDisabled()
  } finally {
    if (server.child.exitCode === null) server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  }
})

async function startServer(fixture: string): Promise<Server> {
  const tmp = await mkdtemp(join(tmpdir(), 'scribepad-server-link-e2e-'))
  const doc = join(tmp, 'doc.md')
  await copyFile(fixture, doc)
  // PORT set => non-session mode (no registry write, no idle shutdown); PORT=0
  // => OS-assigned free port. Same pattern as next-report.spec.ts.
  const child = spawn(process.execPath, [SERVER_ENTRY, doc], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: '0',
      XDG_CONFIG_HOME: join(tmp, 'config'),
      XDG_STATE_HOME: join(tmp, 'state'),
      XDG_RUNTIME_DIR: join(tmp, 'runtime'),
    },
  })
  const origin = await waitForOrigin(child)
  return { child, origin, tmp, doc }
}

function waitForOrigin(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for server URL')), 20_000)
    const onData = (chunk: Buffer): void => {
      const match = /panel\s+(http:\/\/127\.0\.0\.1:\d+)\//.exec(chunk.toString())
      if (match) {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        child.stderr.off('data', onData)
        resolvePromise(match[1]!)
      }
    }
    // Non-session (PORT) mode logs to stdout; --wait mode logs to stderr.
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => {
      clearTimeout(timer)
      reject(new Error('server exited before printing its URL'))
    })
  })
}
