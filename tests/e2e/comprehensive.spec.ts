/**
 * comprehensive.spec — full v0.1 end-to-end coverage.
 *
 * Organized into 9 groups (Boot/Render, Selection/Popover, Draft, AI Rewrite,
 * DiffModal, Accept side effects, 防漂移, Persistence, Edge cases).
 *
 * Conventions:
 *   - sample.md baseline is captured at suite start; restored after each test.
 *   - sidecar `.sample.md.annotations.json` is removed in beforeEach.
 *   - /api/rewrite is always mocked unless the test specifically wants to hit
 *     the real backend (one such test exists for 防漂移).
 *   - Each test is independent: no leakage of state between tests.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SAMPLE_PATH = resolve(__dirname, '../../sample.md')
const SIDECAR_PATH = resolve(__dirname, '../../.sample.md.annotations.json')

// Capture canonical sample.md at suite start so each test can restore it after
// rewrite-flow tests mutate the file via /api/save.
const SAMPLE_BASELINE = readFileSync(SAMPLE_PATH, 'utf8')

function clearSidecar(): void {
  if (existsSync(SIDECAR_PATH)) unlinkSync(SIDECAR_PATH)
}

function restoreSample(): void {
  writeFileSync(SAMPLE_PATH, SAMPLE_BASELINE, 'utf8')
}

/** Mock /api/rewrite to echo "改写: " + selection per item. */
async function mockRewrite(page: Page): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    const req = route.request()
    const body = req.postDataJSON() as { items: { id: string; selection: string }[] }
    const results = (body.items ?? []).map((it) => ({
      id: it.id,
      rewritten: '改写: ' + it.selection,
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    })
  })
}

/** Mock /api/rewrite with a delay so we can observe thinking state. */
async function mockRewriteSlow(page: Page, delayMs = 400): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    const req = route.request()
    const body = req.postDataJSON() as { items: { id: string; selection: string }[] }
    const results = (body.items ?? []).map((it) => ({
      id: it.id,
      rewritten: '改写: ' + it.selection,
    }))
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    })
  })
}

/** Mock /api/rewrite to fail with a 500 + error JSON. */
async function mockRewriteError(page: Page, message = 'rewrite failed'): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: message }),
    })
  })
}

/**
 * Programmatically select a substring inside the reader. If a paragraphSelector
 * is given, search only that element; otherwise scan all text nodes in `.reader`
 * for the first match of `substring`.
 */
async function selectInReader(
  page: Page,
  opts: { paragraphSelector?: string; substring?: string } = {},
): Promise<string> {
  const paragraphSelector = opts.paragraphSelector ?? '.reader'
  const substring = opts.substring ?? null

  return await page.evaluate(
    (args: { paragraphSelector: string; substring: string | null }) => {
      const root = document.querySelector(args.paragraphSelector)
      if (!root) throw new Error('paragraph not found: ' + args.paragraphSelector)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let target: Text | null = null
      let startOffset = 0
      let endOffset = 0
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text
        const value = tn.data
        if (args.substring) {
          const idx = value.indexOf(args.substring)
          if (idx >= 0) {
            target = tn
            startOffset = idx
            endOffset = idx + args.substring.length
            break
          }
        } else if (value.trim().length >= 4) {
          target = tn
          startOffset = 0
          endOffset = Math.min(6, value.length)
          break
        }
      }
      if (!target) throw new Error('no suitable text node found')
      const range = document.createRange()
      range.setStart(target, startOffset)
      range.setEnd(target, endOffset)
      const sel = window.getSelection()
      if (!sel) throw new Error('no Selection API')
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return range.toString()
    },
    { paragraphSelector, substring },
  )
}

/** Clear browser selection (avoid bleed between actions). */
async function clearBrowserSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
}

async function waitForReader(page: Page): Promise<void> {
  await expect(page.locator('.reader p').first()).toBeVisible()
}

async function createDraft(
  page: Page,
  substring: string,
  paragraphSelector?: string,
): Promise<string> {
  const opts: { substring: string; paragraphSelector?: string } = { substring }
  if (paragraphSelector !== undefined) opts.paragraphSelector = paragraphSelector
  const selected = await selectInReader(page, opts)
  await expect(page.locator('.popover')).toBeVisible()
  await page.locator('.popover').click()
  await expect(page.locator('.anno-card').first()).toBeVisible()
  return selected
}

test.describe('comprehensive v0.1', () => {
  test.beforeEach(async ({ page }) => {
    clearSidecar()
    restoreSample()
    // Default mock — individual tests may override with mockRewriteSlow / mockRewriteError.
    await mockRewrite(page)
  })

  test.afterEach(() => {
    restoreSample()
    clearSidecar()
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 1 — Boot & Render
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 1 — Boot & Render', () => {
    test('1.1 page loads at /', async ({ page }) => {
      const res = await page.goto('/')
      expect(res?.status()).toBeLessThan(400)
      await expect(page.locator('.app-header strong')).toHaveText('scribepad')
    })

    test('1.2 header shows scribepad + path containing sample.md', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('.app-header strong')).toHaveText('scribepad')
      await expect(page.locator('.app-header .path')).toContainText('sample.md')
    })

    test('1.3 header badge initially "0 批注 · 0 已定"', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await expect(page.locator('.app-header .badge')).toHaveText('0 批注 · 0 已定')
    })

    test('1.4 reader content rendered (h1, h2, code)', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await expect(page.locator('.reader h1')).toContainText('示例:auth 重构计划')
      // multiple h2s present
      const h2Count = await page.locator('.reader h2').count()
      expect(h2Count).toBeGreaterThanOrEqual(2)
      // inline code rendered (e.g. `##`)
      await expect(page.locator('.reader code').first()).toBeVisible()
    })

    test('1.5 sidebar shows empty state', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await expect(page.locator('.sidebar .empty')).toBeVisible()
      await expect(page.locator('.sidebar .empty')).toContainText('选中正文文字')
      await expect(page.locator('.anno-card')).toHaveCount(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 2 — Selection & Popover
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 2 — Selection & Popover', () => {
    test('2.1 drag-select shows popover with 💬 批注', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await selectInReader(page, { substring: '演示文档' })
      const popover = page.locator('.popover')
      await expect(popover).toBeVisible()
      await expect(popover).toContainText('批注')
    })

    test('2.2 popover positioned near the selection (above it)', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await selectInReader(page, { substring: '演示文档' })
      await expect(page.locator('.popover')).toBeVisible()

      const popoverBox = await page.locator('.popover').boundingBox()
      const selBox = await page.evaluate(() => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return null
        const r = sel.getRangeAt(0).getBoundingClientRect()
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      })
      expect(popoverBox).not.toBeNull()
      expect(selBox).not.toBeNull()
      // popover top should be above selection top (smaller y).
      expect(popoverBox!.y).toBeLessThan(selBox!.top)
    })

    test('2.3 collapsing selection hides popover', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await selectInReader(page, { substring: '演示文档' })
      await expect(page.locator('.popover')).toBeVisible()
      await clearBrowserSelection(page)
      await expect(page.locator('.popover')).toHaveCount(0)
    })

    test('2.4 click popover creates annotation (card + mark appear)', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      await expect(page.locator('.anno-card')).toHaveCount(1)
      await expect(page.locator('mark.anno.draft')).toBeVisible()
    })

    test('2.5 selecting text outside reader does not show popover', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      // Select text inside header (path) — outside .reader
      await page.evaluate(() => {
        const path = document.querySelector('.app-header .path') as HTMLElement | null
        if (!path) throw new Error('no path element')
        const tn = path.firstChild
        if (!tn) throw new Error('no path text node')
        const range = document.createRange()
        range.selectNodeContents(path)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      // wait for debounce
      await page.waitForTimeout(120)
      await expect(page.locator('.popover')).toHaveCount(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 3 — Draft state
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 3 — Draft state', () => {
    test('3.1 newly created annotation shows draft card', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      const selected = await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await expect(card).toBeVisible()
      await expect(card.locator('.text')).toContainText(selected)
    })

    test('3.2 draft mark in reader has yellow visual + ? badge', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const mark = page.locator('mark.anno.draft')
      await expect(mark).toBeVisible()
      // Verify ::after pseudo content === "?"
      const afterContent = await mark.evaluate((el) => {
        const cs = getComputedStyle(el, '::after')
        return cs.content
      })
      // content can be `"?"` or `'?'`
      expect(afterContent.replace(/['"]/g, '')).toBe('?')
    })

    test('3.3 draft card has input + ↵ button', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await expect(card.locator('textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
      await expect(card.locator('button.primary', { hasText: '↵' })).toBeVisible()
    })

    test('3.4 two drafts coexist', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      await clearBrowserSelection(page)
      // Second selection in a different paragraph
      await selectInReader(page, { substring: '业务背景' })
      await expect(page.locator('.popover')).toBeVisible()
      await page.locator('.popover').click()
      await expect(page.locator('.anno-card')).toHaveCount(2)
      await expect(page.locator('mark.anno.draft')).toHaveCount(2)
    })

    test('3.5 header badge updates to "1 批注 · 0 已定" after 1 draft', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      await expect(page.locator('.app-header .badge')).toHaveText('1 批注 · 0 已定')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 4 — AI Rewrite
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 4 — AI Rewrite', () => {
    test('4.1 thinking visual after submit (slow mock)', async ({ page }) => {
      await mockRewriteSlow(page, 500)
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')

      // Mark visually transitions to thinking (still yellow + ⏳ via CSS).
      await expect(page.locator('mark.anno.thinking')).toBeVisible()
    })

    test('4.2 card shows "codex 思考中" while thinking', async ({ page }) => {
      await mockRewriteSlow(page, 500)
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(card.locator('.status-line.thinking')).toBeVisible()
      await expect(card.locator('.status-line.thinking')).toContainText('思考中')
    })

    test('4.3 mark turns to deciding (orange + ✏️) after AI returns', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('mark.anno.deciding')).toBeVisible()
      const afterContent = await page
        .locator('mark.anno.deciding')
        .evaluate((el) => getComputedStyle(el, '::after').content)
      expect(afterContent.replace(/['"]/g, '')).toContain('✏')
    })

    test('4.4 card shows only "AI 已返回" after AI returns', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      const deciding = page.locator('.anno-card.deciding')
      await expect(deciding).toBeVisible()
      await expect(deciding).toContainText('AI 已返回')
      await expect(deciding).toHaveText('AI 已返回')
    })

    test('4.5 modal does NOT auto-open after AI returns', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      // Wait for deciding state to settle.
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
      await expect(page.locator('.diff-modal')).toHaveCount(0)
    })

    test('4.6 click mark opens modal', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('mark.anno.deciding')).toBeVisible()
      await page.locator('mark.anno.deciding').click()
      await expect(page.locator('.diff-modal')).toBeVisible()
    })

    test('4.7 click deciding card opens modal', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      const deciding = page.locator('.anno-card.deciding')
      await expect(deciding).toBeVisible()
      await deciding.click()
      await expect(page.locator('.diff-modal')).toBeVisible()
    })

    test('4.8 modal contents: instruction echo + diff', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      const selected = await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
      await page.locator('.anno-card.deciding').click()
      const modal = page.locator('.diff-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('.instruction-box')).toHaveCount(0)
      await expect(modal.locator('.row-del')).toContainText(selected)
      await expect(modal.locator('.row-add')).toContainText('改写: ' + selected)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 5 — DiffModal
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 5 — DiffModal', () => {
    async function openModal(page: Page, substring = '演示文档'): Promise<string> {
      await page.goto('/')
      await waitForReader(page)
      const sel = await createDraft(page, substring)
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
      await page.locator('.anno-card.deciding').click()
      await expect(page.locator('.diff-modal')).toBeVisible()
      return sel
    }

    test('5.1 modal renders header structure', async ({ page }) => {
      await openModal(page)
      const modal = page.locator('.diff-modal')
      await expect(modal.locator('.diff-modal-header .title')).toContainText('改写建议')
      await expect(modal.locator('.diff-modal-header .meta-tag')).toHaveCount(0)
      await expect(modal.locator('.diff-modal-header .close-btn')).toBeVisible()
    })

    test('5.2 modal shows diff (old red strike + new green) and footer', async ({ page }) => {
      await openModal(page)
      const modal = page.locator('.diff-modal')
      await expect(modal.locator('.row-del')).toBeVisible()
      await expect(modal.locator('.row-add')).toBeVisible()
      await expect(modal.locator('.delta-stats')).toHaveCount(0)
      await expect(modal.locator('.reprompt')).toBeVisible()
      await expect(modal.locator('.diff-modal-footer')).toHaveCount(0)
      await expect(modal.locator('.reprompt button', { hasText: '提交' })).toBeVisible()
      await expect(modal.locator('.reprompt button.primary', { hasText: '接受' })).toBeVisible()
      await expect(modal.locator('button', { hasText: '拍板' })).toHaveCount(0)
    })

    test('5.3 Esc dismisses modal and keeps AI result reopenable', async ({ page }) => {
      await openModal(page)
      await page.keyboard.press('Escape')
      await expect(page.locator('.diff-modal')).toHaveCount(0)
      await expect(page.locator('mark.anno.deciding')).toBeVisible()
      await expect(page.locator('.anno-card.deciding')).toContainText('AI 已返回')
    })

    test('5.4 Enter accepts (content updated, mark gone, card gone)', async ({ page }) => {
      const sel = await openModal(page)
      await page.keyboard.press('Enter')
      await expect(page.locator('.diff-modal')).toHaveCount(0)
      await expect(page.locator('mark.anno')).toHaveCount(0)
      await expect(page.locator('.anno-card')).toHaveCount(0)
      await expect(page.locator('.reader')).toContainText('改写: ' + sel)
    })

    test('5.5 Cmd+Enter accepts without locking', async ({ page }) => {
      const sel = await openModal(page)
      await page.keyboard.press('Meta+Enter')
      await expect(page.locator('.diff-modal')).toHaveCount(0)
      await expect(page.locator('.reader')).toContainText('改写: ' + sel)
      await expect
        .poll(
          () => {
            if (!existsSync(SIDECAR_PATH)) return null
            const sc = JSON.parse(readFileSync(SIDECAR_PATH, 'utf8')) as {
              annotations: Array<{ state: string; status: string }>
            }
            return sc.annotations[0] ?? null
          },
          { timeout: 3000 },
        )
        .toMatchObject({ state: 'discussed', status: 'applied' })
    })

    test('5.6 click backdrop dismisses modal', async ({ page }) => {
      await openModal(page)
      // Click the backdrop area (outside the diff-modal box).
      await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } })
      await expect(page.locator('.diff-modal')).toHaveCount(0)
    })

    test('5.7 click close dismisses modal', async ({ page }) => {
      await openModal(page)
      await page.locator('.diff-modal-header .close-btn').click()
      await expect(page.locator('.diff-modal')).toHaveCount(0)
    })

    test('5.8 click [接受] accepts', async ({ page }) => {
      const sel = await openModal(page)
      await page.locator('.reprompt button.primary', { hasText: '接受' }).first().click()
      await expect(page.locator('.diff-modal')).toHaveCount(0)
      await expect(page.locator('.reader')).toContainText('改写: ' + sel)
    })

    test('5.9 no accept-and-lock action in modal', async ({ page }) => {
      await openModal(page)
      await expect(page.locator('button', { hasText: '拍板' })).toHaveCount(0)
    })

    test('5.10 reprompt + Enter does NOT accept (intercepted)', async ({ page }) => {
      const sel = await openModal(page)
      const repInput = page.locator('.reprompt textarea')
      await repInput.fill('再压缩一些')
      await repInput.press('Enter')
      // After reprompt, modal closes (since AI returns again immediately) but
      // the document content should NOT contain the original "改写:" text yet
      // because reprompt restarts the loop, not accepts.
      // A second deciding card should reappear.
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
      // No accepted text yet (the doc must NOT have been spliced).
      await expect(page.locator('.reader')).not.toContainText('改写: ' + sel)
    })

    test('5.11 reprompt + click [提交] reruns AI', async ({ page }) => {
      await openModal(page)
      const repInput = page.locator('.reprompt textarea')
      await repInput.fill('换种说法')
      await page.locator('.reprompt button', { hasText: '提交' }).click()
      // Modal closes (handleReprompt clears the modal target), then deciding
      // card reappears after AI re-returns.
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 6 — Accept side effects
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 6 — Accept side effects', () => {
    async function acceptOnce(page: Page, substring = '演示文档'): Promise<string> {
      await page.goto('/')
      await waitForReader(page)
      const sel = await createDraft(page, substring)
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('.anno-card.deciding')).toBeVisible()
      await page.locator('.anno-card.deciding').click()
      await expect(page.locator('.diff-modal')).toBeVisible()
      await page.locator('.reprompt button.primary', { hasText: '接受' }).first().click()
      await expect(page.locator('.diff-modal')).toHaveCount(0)
      return sel
    }

    test('6.1 reader content reflects ai_suggestion replacing original', async ({ page }) => {
      const sel = await acceptOnce(page)
      await expect(page.locator('.reader')).toContainText('改写: ' + sel)
    })

    test('6.2 mark removed from reader after accept', async ({ page }) => {
      await acceptOnce(page)
      await expect(page.locator('mark.anno')).toHaveCount(0)
    })

    test('6.3 card removed from sidebar after accept', async ({ page }) => {
      await acceptOnce(page)
      await expect(page.locator('.anno-card')).toHaveCount(0)
      await expect(page.locator('.sidebar .empty')).toBeVisible()
    })

    test('6.4 file on disk updated', async ({ page }) => {
      await acceptOnce(page)
      // Re-fetch /api/file and assert content contains the new text.
      const content = await page.evaluate(async () => {
        const res = await fetch('/api/file')
        const data = (await res.json()) as { content: string }
        return data.content
      })
      expect(content).toContain('改写: ')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 7 — 防漂移
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 7 — 防漂移', () => {
    test('7.1 decided annotation: green mark + ✓ badge + locked card', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')

      // Promote to decided via API.
      await page.evaluate(async () => {
        const res = await fetch('/api/annotations')
        const data = (await res.json()) as { annotations: Array<Record<string, unknown>> }
        const next = data.annotations.map((a) => ({ ...a, state: 'decided' as const }))
        await fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations: next }),
        })
      })
      await page.locator('button[aria-label="重新加载"]').click()

      const mark = page.locator('mark.anno.decided')
      await expect(mark).toBeVisible()
      const afterContent = await mark.evaluate((el) => getComputedStyle(el, '::after').content)
      expect(afterContent.replace(/['"]/g, '')).toContain('✓')

      const card = page.locator('.anno-card.decided')
      await expect(card).toBeVisible()
      await expect(card).toContainText('已锁定')
    })

    test('7.2 decided card shows 🔒 lock indicator', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      await page.evaluate(async () => {
        const res = await fetch('/api/annotations')
        const data = (await res.json()) as { annotations: Array<Record<string, unknown>> }
        const next = data.annotations.map((a) => ({ ...a, state: 'decided' as const }))
        await fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations: next }),
        })
      })
      await page.locator('button[aria-label="重新加载"]').click()
      const card = page.locator('.anno-card.decided')
      await expect(card).toBeVisible()
      await expect(card.locator('.status-line')).toContainText('🔒')
    })

    test('7.3 rewrite error toast appears on 500', async ({ page }) => {
      await mockRewriteError(page, 'all selected items are state=decided; cannot rewrite')
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      const card = page.locator('.anno-card').first()
      await card.locator('textarea').fill('改一下')
      await card.locator('textarea').press('Enter')
      await expect(page.locator('.toast')).toBeVisible()
      await expect(page.locator('.toast')).toContainText('cannot rewrite')
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 8 — Persistence
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 8 — Persistence', () => {
    test('8.1 three annotations survive reload', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      await clearBrowserSelection(page)
      await createDraft(page, '业务背景')
      await clearBrowserSelection(page)
      await createDraft(page, '涉及范围')
      await expect(page.locator('.anno-card')).toHaveCount(3)
      await page.reload()
      await waitForReader(page)
      await expect(page.locator('.anno-card')).toHaveCount(3)
    })

    test('8.2 state change (lock) persists across reload', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      // Lock via API
      await page.evaluate(async () => {
        const res = await fetch('/api/annotations')
        const data = (await res.json()) as { annotations: Array<Record<string, unknown>> }
        const next = data.annotations.map((a) => ({ ...a, state: 'decided' as const }))
        await fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations: next }),
        })
      })
      await page.reload()
      await waitForReader(page)
      await expect(page.locator('.anno-card.decided')).toBeVisible()
      await expect(page.locator('mark.anno.decided')).toBeVisible()
    })

    test('8.3 sidecar file exists after writes', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await createDraft(page, '演示文档')
      // Wait briefly for fire-and-forget POST to finish — poll the sidecar.
      await expect.poll(() => existsSync(SIDECAR_PATH), { timeout: 3000 }).toBe(true)
      const sidecar = JSON.parse(readFileSync(SIDECAR_PATH, 'utf8')) as {
        version: number
        annotations: unknown[]
      }
      expect(sidecar.version).toBe(2)
      expect(sidecar.annotations.length).toBe(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Group 9 — Edge cases
  // ─────────────────────────────────────────────────────────────────────
  test.describe('Group 9 — Edge cases', () => {
    test('9.1 empty (collapsed) selection does not show popover', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      await page.evaluate(() => {
        const para = document.querySelector('.reader p')
        if (!para) throw new Error('no para')
        const sel = window.getSelection()
        sel?.removeAllRanges()
        const r = document.createRange()
        r.setStart(para, 0)
        r.collapse(true)
        sel?.addRange(r)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await page.waitForTimeout(120)
      await expect(page.locator('.popover')).toHaveCount(0)
    })

    test('9.2 whitespace-only selection does not produce a usable annotation', async ({ page }) => {
      // A selection containing only whitespace must not result in a usable
      // annotation. Implementation may either suppress the popover or refuse
      // the create — both are acceptable. We assert: after attempting, no
      // mark is rendered (or no card with non-empty text).
      await page.goto('/')
      await waitForReader(page)
      // Try to find a whitespace-only run; sample.md has plain text. So we
      // construct a range purely on a single space character if any.
      const ok = await page.evaluate(() => {
        const root = document.querySelector('.reader')
        if (!root) return false
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const tn = walker.currentNode as Text
          const idx = tn.data.search(/\s/)
          if (idx >= 0 && tn.data[idx] === ' ') {
            const r = document.createRange()
            r.setStart(tn, idx)
            r.setEnd(tn, idx + 1)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(r)
            document.dispatchEvent(new Event('selectionchange'))
            return true
          }
        }
        return false
      })
      // If no whitespace was found in reader text (Chinese punctuation rich),
      // skip the test silently.
      if (!ok) {
        test.skip()
        return
      }
      // Either popover is hidden, or clicking it produces no actionable mark.
      const popoverVisible = await page
        .locator('.popover')
        .isVisible()
        .catch(() => false)
      if (popoverVisible) {
        await page.locator('.popover').click()
      }
      // Whatever happened, there must be no mark with empty/whitespace text.
      const markTexts = await page
        .locator('mark.anno')
        .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''))
      for (const t of markTexts) {
        expect(t.trim().length).toBeGreaterThan(0)
      }
    })

    test('9.3 rapid selection changes do not break popover', async ({ page }) => {
      await page.goto('/')
      await waitForReader(page)
      // Fire several selection changes rapidly.
      for (let i = 0; i < 5; i++) {
        await page.evaluate((seed) => {
          const root = document.querySelector('.reader p') as HTMLElement | null
          if (!root) return
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let tn: Text | null = null
          while (walker.nextNode()) {
            tn = walker.currentNode as Text
            if (tn.data.trim().length >= 6) break
          }
          if (!tn) return
          const r = document.createRange()
          const start = seed % Math.max(1, tn.data.length - 6)
          r.setStart(tn, start)
          r.setEnd(tn, start + 4)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(r)
          document.dispatchEvent(new Event('selectionchange'))
        }, i)
        await page.waitForTimeout(20)
      }
      // After settling, popover should be visible and clickable (single popover
      // instance — no flicker / multi-mount).
      await page.waitForTimeout(150)
      await expect(page.locator('.popover')).toHaveCount(1)
      await page.locator('.popover').click()
      await expect(page.locator('.anno-card')).toHaveCount(1)
    })
  })
})
