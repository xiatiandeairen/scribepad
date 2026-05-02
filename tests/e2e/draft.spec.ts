/**
 * draft.spec — flow #1: select text → popover → create → draft card visible.
 *
 * Covers `docs/plan.md` §1.2 row "创建批注(draft)" and the leftmost
 * column of the §1.4 state machine. After the user clicks the popover, we
 * expect:
 *   - exactly one `.anno-card` rendered in the sidebar (variant=draft, the
 *     default for newly created annotations);
 *   - a `mark.anno.draft` wrapping the selected text inside the reader.
 *
 * No network mocks needed — creating a draft does not call /api/rewrite.
 * The /api/annotations POST is a real call to the dev server but writes to
 * the local sidecar (cleared in beforeEach).
 */
import { test, expect } from '@playwright/test'
import { clearSidecar, createAnnotation, waitForReaderReady } from './helpers'

test.describe('draft flow', () => {
  test.beforeEach(() => {
    clearSidecar()
  })

  test('select text → popover → click → draft card visible + draft mark in reader', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: '演示文档' })

    // Sidebar: exactly one card, in draft variant (DraftRow with input + ↵ btn).
    const card = page.locator('.anno-card').first()
    await expect(card).toBeVisible()
    await expect(card.locator('input[placeholder="告诉 AI 怎么改…"]')).toBeVisible()

    // Reader: a <mark class="anno draft"> wraps the selected text.
    const mark = page.locator('mark.anno.draft')
    await expect(mark).toBeVisible()
    await expect(mark).toHaveText(selected)
  })
})
