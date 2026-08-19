/**
 * /next review-doc report E2E (docKind:'review').
 *
 * core/extract/review.ts classifies a doc into the review path and yields
 * ReviewExtract{ verdicts, reconciliation, claims, leftovers, details };
 * client-next/report-contract.jsx turns that into REPORT_MODEL and
 * client-next/report-sections.jsx renders it behind the docKind branch in
 * review-net.jsx / review-doc.jsx / review-right.jsx (see those files' "docKind:
 * 'review' →" comments). This spec drives the same production Hono server the
 * other /next specs use (`node dist/server/index.js`, non-session mode via
 * PORT=0) against tests/fixtures/review-standard.md and review-edge.md, and
 * pins:
 *   - the render shape (5 section headers, verdict cards, recon pills, the
 *     claims unverified flag, leftovers, the collapsed details <details>, and
 *     the 裁决进度 right panel);
 *   - signoff (D1/L1) persistence across a reload — this goes through the
 *     same generic GET/POST /sessions/:id/signoffs plumbing the plan path
 *     uses (client-next/review-app.jsx toggleSign), so a break here would be a
 *     real regression, not a review-doc-only gap;
 *   - annotation anchoring on a review unit — no spec drives annotation
 *     creation through the UI yet (report-sections.jsx does not wire
 *     AnnoText/NOTE_HIGHLIGHTS the way the plan path's review-sections.jsx
 *     does), so this round-trips the same REST endpoints
 *     (plan-review-rehearsal.spec.ts's pattern) with an anchor sliced from
 *     inside D1's extracted range;
 *   - the edge fixture's degrade-never-throw paths (zero verdicts, an unknown
 *     recon status).
 */
import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Annotation } from '../../types/annotation'
import type {
  AnnotationsResponse,
  ExtractResponse,
  FileResponse,
  OpenSessionResponse,
} from '../../types/api'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')
const STANDARD_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/review-standard.md')
const EDGE_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/review-edge.md')

const SECTION_IDS = ['verdicts', 'recon', 'claims', 'leftovers', 'details'] as const
const SECTION_NAMES = ['需要你裁决', '计划对账', '声明与证据', '遗留与假设', '变更明细']

// Chromium logs failed favicon.ico / other resource loads at error level; those are
// not app faults (same filter next-smoke.spec.ts uses).
function isAppConsoleError(text: string): boolean {
  return !/favicon\.ico|Failed to load resource/i.test(text)
}

type Server = { child: ChildProcessWithoutNullStreams; origin: string; tmp: string; doc: string }

test.describe('/next review-doc report: tests/fixtures/review-standard.md', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startServer(STANDARD_FIXTURE)
  })

  test.afterAll(async () => {
    server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  })

  test('renders the 5 report sections, verdicts, recon pills, claims, leftovers, collapsed details, and 0/6 progress', async ({
    browser,
  }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isAppConsoleError(msg.text())) consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    await gotoDoc(page, server)

    // 5 section headers, in order.
    for (const id of SECTION_IDS) {
      await expect(page.locator(`.sec-h[data-sec="${id}"]`)).toBeVisible()
    }
    await expect(page.locator('.sec-h h2')).toHaveText(SECTION_NAMES)

    // §1 — 3 verdict cards (D1-D3), each with a risk tag chip.
    await expect(page.locator('.rpt-vcard')).toHaveCount(3)
    for (const label of ['D1', 'D2', 'D3']) {
      const card = page.locator(`.rpt-vcard[data-pt="${label}"]`)
      await expect(card).toBeVisible()
      await expect(card.locator('.rpt-tag')).toBeVisible()
    }

    // §2 — recon status pills cover all 4 known statuses (fixture has no
    // unknown row; the edge fixture pins that case separately below).
    const pillTexts = await page.locator('.rpt-pill').allTextContents()
    for (const label of ['按计划', '有偏差', '未做', '新增']) {
      expect(pillTexts, `recon pill labels: ${pillTexts.join(', ')}`).toContain(label)
    }

    // §3 — exactly one claim (C4) is flagged unverified.
    await expect(page.locator('tr.rpt-unv')).toHaveCount(1)
    await expect(page.locator('.rpt-warnchip')).toHaveCount(1)

    // §4 — leftovers L1-L3.
    for (const label of ['L1', 'L2', 'L3']) {
      await expect(page.locator(`.rpt-lrow[data-pt="${label}"]`)).toBeVisible()
    }

    // §5 — the details <details> is collapsed by default.
    const details = page.locator('details.rpt-details')
    await expect(details).toHaveCount(1)
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

    // Right panel: 3 verdicts + 3 leftovers = 6 signable units, none signed yet.
    await expect(page.locator('.rightbar .dash-h .mo')).toHaveText('0 / 6')

    expect(consoleErrors, 'console errors rendering review-standard.md').toEqual([])
    await context.close()
  })

  test('signing D1 and L1 brings progress to 2/6 and survives a reload', async ({ browser }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    await gotoDoc(page, server)

    const d1Sign = page.locator('.rpt-vcard[data-pt="D1"] button.rpt-sign')
    const l1Sign = page.locator('.rpt-lrow[data-pt="L1"] button.rpt-sign')
    await expect(d1Sign).toHaveText('批准')
    await expect(l1Sign).toHaveText('已知晓')

    await d1Sign.click()
    await expect(d1Sign).toHaveText('已批准')
    await l1Sign.click()
    await expect(l1Sign).toHaveText('已确认')

    await expect(page.locator('.rightbar .dash-h .mo')).toHaveText('2 / 6')

    // Reload: bootstrap re-opens the doc, re-extracts, and re-fetches signoffs
    // off the session's sidecar file — this is the real POST /signoffs → GET
    // /signoffs round-trip, not local component state.
    await page.reload()
    await expect(page.locator('.sec-h[data-sec="verdicts"]')).toBeVisible({ timeout: 25_000 })
    await expect(page.locator('.rightbar .dash-h .mo')).toHaveText('2 / 6')
    await expect(page.locator('.rpt-vcard[data-pt="D1"] button.rpt-sign')).toHaveText('已批准')
    await expect(page.locator('.rpt-lrow[data-pt="L1"] button.rpt-sign')).toHaveText('已确认')

    await context.close()
  })

  test('an annotation anchored inside D1 survives a reload', async ({ browser }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    await gotoDoc(page, server)

    // openSession is idempotent by absolute path (server/services/session-manager.ts),
    // so this reuses the same session the browser opened via ?doc=.
    const openRes = await fetch(`${server.origin}/api/sessions/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: server.doc }),
    })
    expect(openRes.ok).toBe(true)
    const { sessionId } = (await openRes.json()) as OpenSessionResponse

    const extractRes = await fetch(`${server.origin}/api/sessions/${sessionId}/extract`)
    expect(extractRes.ok).toBe(true)
    const { result } = (await extractRes.json()) as ExtractResponse
    const d1 = result.review?.verdicts.find((v) => v.label === 'D1')
    expect(d1?.anchor).toBeDefined()
    const anchor = d1!.anchor!

    const fileRes = await fetch(`${server.origin}/api/sessions/${sessionId}/file`)
    expect(fileRes.ok).toBe(true)
    const { content } = (await fileRes.json()) as FileResponse

    // A slice strictly inside D1's range (not the whole card) — pins that the
    // anchor is a real sub-range, not just an alias for the verdict's own anchor.
    const srcStart = anchor.srcStart
    const srcEnd = Math.min(anchor.srcStart + 40, anchor.srcEnd)
    expect(srcEnd).toBeGreaterThan(srcStart)
    const text = content.slice(srcStart, srcEnd)
    expect(text.length).toBeGreaterThan(0)

    const annotation: Annotation = {
      id: 'ann-d1-anchor-e2e',
      anchor: { srcStart, srcEnd, text },
      target: { type: 'selection' },
      instruction: '锚定在 D1 范围内的一段，验证审阅报告的批注锚定',
      state: 'draft',
      status: 'open',
      history: [{ ts: new Date().toISOString(), action: 'create' }],
      created_at: new Date().toISOString(),
    }
    const postRes = await fetch(`${server.origin}/api/sessions/${sessionId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations: [annotation] }),
    })
    expect(postRes.ok).toBe(true)

    // Reload the live panel — proves the annotation survives the same
    // bootstrap (GET extract/file + GET annotations) a human reviewer hits,
    // not just an isolated API call.
    await page.reload()
    await expect(page.locator('.sec-h[data-sec="verdicts"]')).toBeVisible({ timeout: 25_000 })

    const afterReload = await fetch(`${server.origin}/api/sessions/${sessionId}/annotations`)
    expect(afterReload.ok).toBe(true)
    const { annotations } = (await afterReload.json()) as AnnotationsResponse
    const saved = annotations.find((a) => a.id === 'ann-d1-anchor-e2e')
    expect(saved).toBeDefined()
    expect(saved?.anchor).toEqual({ srcStart, srcEnd, text })

    await context.close()
  })
})

test.describe('/next review-doc report: tests/fixtures/review-edge.md', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startServer(EDGE_FIXTURE)
  })

  test.afterAll(async () => {
    server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  })

  test('renders the zero-verdicts placeholder and an unknown recon status, no console error', async ({
    browser,
  }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isAppConsoleError(msg.text())) consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    await gotoDoc(page, server)

    await expect(page.locator('.rpt-empty-card')).toHaveText('本次无裁决事项')
    await expect(page.locator('.rpt-pill.na')).toHaveText('—')

    expect(consoleErrors, 'console errors rendering review-edge.md').toEqual([])
    await context.close()
  })
})

async function gotoDoc(page: Page, server: Server): Promise<void> {
  await page.goto(`${server.origin}/next/?doc=${encodeURIComponent(server.doc)}`)
  // Bootstrap: loading → live extract → React render. First section visible ==
  // App mounted (Babel in-browser transform makes first paint slow).
  await expect(page.locator('.sec-h[data-sec="verdicts"]')).toBeVisible({ timeout: 25_000 })
}

async function startServer(fixture: string): Promise<Server> {
  const tmp = await mkdtemp(join(tmpdir(), 'scribepad-next-report-e2e-'))
  const doc = join(tmp, 'doc.md')
  await copyFile(fixture, doc)
  // PORT set (any truthy value) => non-session mode: no registry write, no idle
  // shutdown timer, server stays up until killed. PORT=0 => OS-assigned free port.
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
