/**
 * Panel feedback intake E2E: shortcut → popover → submit → inbox.jsonl.
 *
 * The feedback entry point lives in client-next (review-feedback.jsx + review-app
 * wiring): ⌘/Ctrl+Shift+F opens a lightweight popover; submitting POSTs
 * /api/feedback with the typed text/category plus auto-collected context (sessionId,
 * a #docText DOM snapshot, the early console ring buffer, viewport, activeSection).
 * The server appends one line to $XDG_STATE_HOME/scribepad/feedback/inbox.jsonl.
 *
 * This spec starts a real production Hono server (non-session mode via PORT=0) with a
 * per-run temp XDG_STATE_HOME so the inbox is isolated and readable, drives the
 * popover in a browser, and asserts the persisted line: source 'panel', the text, and
 * a sessionId matching the one the browser actually sent (round-trip, not just render).
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')

type Server = { child: ChildProcessWithoutNullStreams; origin: string; tmp: string; state: string }
type InboxEntry = {
  source: string
  text: string
  category?: string
  sessionId?: string
  context?: { viewport?: string; activeSection?: string; consoleErrors?: string[] }
}

test.describe('/next panel feedback intake', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startServer()
  })

  test.afterAll(async () => {
    server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  })

  test('shortcut opens the popover, submit persists a panel feedback line', async ({ browser }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()

    // Capture the sessionId the browser actually sends, to assert the inbox line ties
    // back to the current session (not a hardcoded value).
    let sentSessionId: string | undefined
    page.on('request', (req) => {
      if (req.url().endsWith('/api/feedback') && req.method() === 'POST') {
        const body = req.postDataJSON() as { sessionId?: string } | null
        sentSessionId = body?.sessionId
      }
    })

    await page.goto(`${server.origin}/next/?doc=tests/fixtures/plan-data-backend.md`)
    // App mounted once the first section renders.
    await expect(page.locator('.sec-h[data-sec="goal"]')).toBeVisible({ timeout: 25_000 })

    // ⌘/Ctrl+Shift+F opens the feedback popover (Control works cross-OS: the handler
    // gates on metaKey||ctrlKey).
    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('.fb-modal')).toBeVisible()

    await page.locator('.fb-modal textarea').fill('extraction missed a hard constraint')
    await page.locator('.fb-cats button', { hasText: '抽取错误' }).click()
    await page.locator('.fb-modal button.go').click()

    // Popover closes + success toast on a persisted submit.
    await expect(page.locator('.fb-modal')).toBeHidden()
    await expect(page.locator('.toast')).toContainText('反馈已提交')

    // The inbox line landed with the panel source, our text/category, and the same
    // sessionId the browser sent.
    const entry = await readLastInboxEntry(server.state)
    expect(entry.source).toBe('panel')
    expect(entry.text).toBe('extraction missed a hard constraint')
    expect(entry.category).toBe('extract-bug')
    expect(typeof sentSessionId).toBe('string')
    expect(entry.sessionId).toBe(sentSessionId)
    // Auto-collected context made it through.
    expect(entry.context?.viewport).toMatch(/^\d+x\d+$/)

    await context.close()
  })
})

async function readLastInboxEntry(stateHome: string): Promise<InboxEntry> {
  const inbox = join(stateHome, 'scribepad', 'feedback', 'inbox.jsonl')
  const raw = await readFile(inbox, 'utf8')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  expect(lines.length).toBeGreaterThan(0)
  return JSON.parse(lines[lines.length - 1]!) as InboxEntry
}

async function startServer(): Promise<Server> {
  const tmp = await mkdtemp(join(tmpdir(), 'scribepad-fb-e2e-'))
  const state = join(tmp, 'state')
  const child = spawn(process.execPath, [SERVER_ENTRY, 'tests/fixtures/plan-data-backend.md'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: '0',
      XDG_CONFIG_HOME: join(tmp, 'config'),
      XDG_STATE_HOME: state,
      XDG_RUNTIME_DIR: join(tmp, 'runtime'),
    },
  })
  const origin = await waitForOrigin(child)
  return { child, origin, tmp, state }
}

function waitForOrigin(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for server URL')), 20_000)
    const onData = (chunk: Buffer): void => {
      const match = chunk.toString('utf8').match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+/)
      if (!match) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolvePromise(match[0])
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => {
      if (chunk.toString('utf8').includes('Error:')) {
        clearTimeout(timer)
        reject(new Error(chunk.toString('utf8')))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited before URL, code=${code}`))
    })
  })
}
