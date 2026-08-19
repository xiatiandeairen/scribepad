/**
 * /next browser smoke E2E (P7 slice 2).
 *
 * The no-build Claude Design frontend (client-next/) is served by the Hono server
 * at GET /next/* — not by Vite. This spec starts a real production server
 * (`node dist/server/index.js`, non-session mode via PORT=0 → dynamic port, no
 * registry / no idle shutdown) that serves BOTH /next static and /api, then drives
 * a browser through the async bootstrap (POST /api/sessions/open → GET extract/file
 * → React render) for two structurally different plans.
 *
 * Asserts, per document, that the live pipeline renders all 8 sections with real
 * content and emits no console error — the last of which pins the HowSection key
 * fix (a duplicate React key warning surfaces as a console error here).
 *
 * Runs against the shipped React UMD + Babel-standalone from unpkg (see
 * client-next/index.html), so it needs network egress; the bootstrap includes an
 * in-browser JSX transform, hence the generous section-visible timeout.
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')

const SECTION_IDS = ['goal', 'scope', 'dec', 'how', 'acc', 'risk', 'pre', 'open'] as const
const SECTION_NAMES = ['目标', '边界', '决策', '做法', '验收', '风险', '前置', '待确认']

// Chromium logs failed favicon.ico / other resource loads at error level; those are
// not app faults. Everything else at error level (React warnings, thrown errors) is.
function isAppConsoleError(text: string): boolean {
  return !/favicon\.ico|Failed to load resource/i.test(text)
}

type Server = { child: ChildProcessWithoutNullStreams; origin: string; tmp: string }

test.describe('/next served by the production Hono server', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startServer()
  })

  test.afterAll(async () => {
    server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  })

  for (const doc of ['tests/fixtures/plan-data-backend.md', 'tests/fixtures/plan-auth-soc2.md']) {
    test(`renders all 8 sections with no console error: ${doc}`, async ({ browser }) => {
      test.setTimeout(45_000)
      const context = await browser.newContext()
      const page = await context.newPage()
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isAppConsoleError(msg.text())) consoleErrors.push(msg.text())
      })
      page.on('pageerror', (err) => consoleErrors.push(String(err)))

      await page.goto(`${server.origin}/next/?doc=${doc}`)

      // Bootstrap: loading → live extract → React render. First section visible ==
      // App mounted (Babel in-browser transform makes first paint slow).
      await expect(page.locator('.sec-h[data-sec="goal"]')).toBeVisible({ timeout: 25_000 })

      // All 8 sections present (data-sec) + their headings.
      for (const id of SECTION_IDS) {
        await expect(page.locator(`.sec-h[data-sec="${id}"]`)).toBeVisible()
      }
      await expect(page.locator('.sec-h h2')).toHaveText(SECTION_NAMES)

      // Key content is non-empty: goal hard-constraint rows and risk rows rendered.
      expect(await page.locator('.glist .grow').count()).toBeGreaterThan(0)
      expect(await page.locator('.riskl .riskrow').count()).toBeGreaterThan(0)
      // 做法 steps render for both the H3 `### N.` shape (plan-data-backend) and the
      // GFM ordered-list shape (soc2) — pins the ordinal-based step derivation.
      expect(await page.locator('.steps .step').count()).toBeGreaterThan(0)
      // Title comes from the live document.
      await expect(page.locator('h1.doc-title')).not.toBeEmpty()

      expect(consoleErrors, `console errors on /next/?doc=${doc}`).toEqual([])
      await context.close()
    })
  }
})

async function startServer(): Promise<Server> {
  const tmp = await mkdtemp(join(tmpdir(), 'scribepad-next-e2e-'))
  // PORT set (any truthy value) => non-session mode: no registry write, no idle
  // shutdown timer, server stays up until killed. PORT=0 => OS-assigned free port
  // (no fixed-port collisions with a parallel session test).
  const child = spawn(process.execPath, [SERVER_ENTRY, 'tests/fixtures/plan-data-backend.md'], {
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
  return { child, origin, tmp }
}

// The server logs `[scribepad] panel  http://127.0.0.1:<port>/next/` on startup;
// take its origin as the base URL for both /next and /api.
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
