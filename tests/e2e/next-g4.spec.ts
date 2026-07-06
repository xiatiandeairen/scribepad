/**
 * G4 — browser write-path E2E: selection → rewrite → persist → reload survives.
 *
 * The retired React SPA's write path is gone; the live path is /next (client-next),
 * where a text selection inside an anchored info point drives POST
 * /api/sessions/:id/rewrite-apply, which rewrites the selection via the LLM,
 * splices the result back into the markdown source, saves it, and re-extracts. Only
 * unit tests covered this so far (session.test rewriteApply + client-next-agent-net
 * computeSrcRange); this spec pins the full browser round-trip.
 *
 * The real rewrite-apply calls a provider CLI (execa claude/codex) that isn't
 * available in CI, so the server is spawned with SCRIBEPAD_STUB_LLM=1 — a
 * deterministic, env-gated stub LlmRunner (server/adapters/llm-stub.ts) that echoes
 * each selection back with a 〔已审阅〕 marker. The stub is opt-in: the default
 * next-smoke / session-server specs never set it and keep the real runner.
 *
 * To avoid mutating a committed fixture, the server opens a per-run temp copy of
 * plan-data-backend.md; the write lands there, so reloading the page re-reads the
 * mutated file and proves the edit was truly persisted (not just re-rendered).
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const SERVER_ENTRY = resolve(REPO_ROOT, 'dist/server/index.js')
const FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/plan-data-backend.md')
const REVIEWED_MARK = '〔已审阅〕'

// Anchored info point to exercise. P1 (precondition) is a single markdown list item
// whose full body renders as one text node under `.tx` and appears verbatim in its
// source anchor — so selecting the whole `.tx` maps cleanly to a src range.
const TARGET_LABEL = 'P1'

type Server = { child: ChildProcessWithoutNullStreams; origin: string; tmp: string; doc: string }

test.describe('/next write path (G4): selection → rewrite → persist → reload', () => {
  let server: Server

  test.beforeAll(async () => {
    server = await startStubServer()
  })

  test.afterAll(async () => {
    server.child.kill('SIGTERM')
    await rm(server.tmp, { recursive: true, force: true })
  })

  test('rewrites a selection, shows the marker, and it survives a reload', async ({ browser }) => {
    test.setTimeout(45_000)
    const context = await browser.newContext()
    const page = await context.newPage()

    const docUrl = `${server.origin}/next/?doc=${encodeURIComponent(server.doc)}`
    await page.goto(docUrl)

    // App mounted once the target precondition point is rendered.
    const target = page.locator(`.pre[data-pt="${TARGET_LABEL}"]`)
    await expect(target).toBeVisible({ timeout: 25_000 })
    // Precondition body must not already carry the marker (clean baseline).
    await expect(target).not.toContainText(REVIEWED_MARK)

    // Select the whole precondition body, then fire mouseup so useDocSelection
    // captures the range and opens the selection toolbar. Dispatch on the element
    // (not document) so the handler's e.target.closest(...) has a real Element.
    const selected = await page.evaluate((label) => {
      const tx = document.querySelector(`.pre[data-pt="${label}"] .tx`)
      if (!tx) throw new Error('precondition .tx not found')
      const range = document.createRange()
      range.selectNodeContents(tx)
      const sel = window.getSelection()
      if (!sel) throw new Error('no selection')
      sel.removeAllRanges()
      sel.addRange(range)
      tx.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return sel.toString().trim()
    }, TARGET_LABEL)
    expect(selected.length).toBeGreaterThan(2)

    // Selection toolbar → 改写 opens the rewrite modal → 确认改写 fires rewrite-apply.
    await expect(page.locator('.seltool')).toBeVisible()
    await page.locator('.seltool button', { hasText: '改写' }).click()
    await expect(page.locator('.rw-modal')).toBeVisible()
    await page.locator('.rw-modal button.go').click()

    // The marker lands in the rendered document after rewrite-apply + re-extract.
    await expect(target).toContainText(REVIEWED_MARK, { timeout: 15_000 })

    // Reload: the bootstrap re-opens the doc and GETs a fresh extract off disk. The
    // marker still being present proves the rewrite was persisted, not just local.
    await page.reload()
    const reloaded = page.locator(`.pre[data-pt="${TARGET_LABEL}"]`)
    await expect(reloaded).toBeVisible({ timeout: 25_000 })
    await expect(reloaded).toContainText(REVIEWED_MARK)

    await context.close()
  })
})

async function startStubServer(): Promise<Server> {
  const tmp = await mkdtemp(join(tmpdir(), 'scribepad-g4-e2e-'))
  // Per-run temp copy so the write never touches a committed fixture.
  const doc = join(tmp, 'g4doc.md')
  await copyFile(FIXTURE, doc)
  // PORT set => non-session mode (no registry, no idle shutdown). SCRIBEPAD_STUB_LLM
  // swaps in the deterministic rewrite stub at the composition root.
  const child = spawn(process.execPath, [SERVER_ENTRY, doc], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: '0',
      SCRIBEPAD_STUB_LLM: '1',
      XDG_CONFIG_HOME: join(tmp, 'config'),
      XDG_STATE_HOME: join(tmp, 'state'),
      XDG_RUNTIME_DIR: join(tmp, 'runtime'),
    },
  })
  const origin = await waitForOrigin(child)
  return { child, origin, tmp, doc }
}

// The server logs its origin on startup; take it as the base URL for /next and /api.
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
