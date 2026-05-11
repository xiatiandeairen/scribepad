/**
 * Production-session E2E.
 *
 * Covers the repo-local shared server model:
 *   - first CLI command starts the server and opens one document session;
 *   - second CLI command reuses the same server and opens another session;
 *   - /s/:sessionId routes load isolated document content;
 *   - Done closes only the current document session and exports final markdown;
 *   - when all sessions are Done, the shared server exits after active idle.
 */
import { test, expect, type Page } from '@playwright/test'
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

type CliResult = {
  child: ChildProcessWithoutNullStreams
  url: string
}

test.describe('shared production server sessions', () => {
  test.beforeEach(async () => {
    await cleanupRegistryServer()
  })

  test.afterEach(async () => {
    await cleanupRegistryServer()
  })

  test('one repo server can host two document sessions and exits after both are Done', async ({
    browser,
  }) => {
    test.setTimeout(45_000)

    const tmp = await mkdtemp(join(tmpdir(), 'scribepad-e2e-'))
    const xdgConfig = join(tmp, 'xdg-config')
    const xdgState = join(tmp, 'xdg-state')
    const xdgRuntime = join(tmp, 'xdg-runtime')
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

    const env = {
      SCRIBEPAD_CONFIG: configPath,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_STATE_HOME: xdgState,
      XDG_RUNTIME_DIR: xdgRuntime,
    }
    const first = await startCli(firstDoc, env)
    const second = await runCliToCompletion(secondDoc, env)

    const firstUrl = new URL(first.url)
    const secondUrl = new URL(second.url)
    expect(secondUrl.origin).toBe(firstUrl.origin)
    expect(secondUrl.pathname).not.toBe(firstUrl.pathname)

    const health = await fetch(`${firstUrl.origin}/api/healthz`)
    await expect(health.json()).resolves.toEqual({ ok: true })

    const context = await browser.newContext()
    const firstPage = await context.newPage()
    const secondPage = await context.newPage()
    await openAndAssertDocument(firstPage, first.url, 'First Plan', 'First document body.')
    await openAndAssertDocument(secondPage, second.url, 'Second Plan', 'Second document body.')

    await doneAndAccept(firstPage)
    await expect.poll(() => sessionExists(first.url)).toBe(false)
    await expect.poll(() => sessionExists(second.url)).toBe(true)
    await expect(readFile(agentPathFor(firstDoc, env), 'utf8')).resolves.toBe(
      '# First Plan\n\nFirst document body.\n',
    )

    await expect(secondPage.locator('.reader')).toContainText('Second document body.')
    await doneAndAccept(secondPage)
    await expect.poll(() => sessionExists(second.url)).toBe(false)
    await expect(readFile(agentPathFor(secondDoc, env), 'utf8')).resolves.toBe(
      '# Second Plan\n\nSecond document body.\n',
    )

    await expectProcessExit(first.child, 20_000)
    await context.close()
  })
})

async function openAndAssertDocument(
  page: Page,
  url: string,
  title: string,
  body: string,
): Promise<void> {
  await page.goto(url)
  await expect(page.locator('.reader h1')).toHaveText(title)
  await expect(page.locator('.reader')).toContainText(body)
  await expect(page.locator('button.primary', { hasText: 'Done' })).toBeVisible()
}

async function doneAndAccept(page: Page): Promise<void> {
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('已完成任务')
    await dialog.accept()
  })
  await page.locator('button.primary', { hasText: 'Done' }).click()
}

async function sessionExists(url: string): Promise<boolean> {
  const parsed = new URL(url)
  const sessionId = parsed.pathname.split('/').pop()
  if (!sessionId) return false
  const res = await fetch(`${parsed.origin}/api/sessions/${sessionId}`)
  return res.ok
}

async function startCli(filePath: string, extraEnv: Record<string, string>): Promise<CliResult> {
  const child = spawn(process.execPath, [SERVER_ENTRY, filePath], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
  })
  const url = await waitForUrl(child)
  return { child, url }
}

async function runCliToCompletion(
  filePath: string,
  extraEnv: Record<string, string>,
): Promise<{ url: string }> {
  const child = spawn(process.execPath, [SERVER_ENTRY, filePath], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...extraEnv },
  })
  const url = await waitForUrl(child)
  await expectProcessExit(child, 5_000)
  return { url }
}

function waitForUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for URL')), 10_000)
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      const match = text.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+\/s\/[^\s]+/)
      if (!match) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolvePromise(match[0])
    }
    child.stdout.on('data', onData)
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
