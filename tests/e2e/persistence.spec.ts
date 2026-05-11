/**
 * persistence.spec — flow: create annotation → reload → annotation still there.
 *
 * Verifies the document-state JSON round-trip described in docs/plan.md §1.2 row
 * "创建批注(draft)": after the user creates an annotation, App.persistAnnotations
 * fires `POST /api/annotations`, the server writes XDG document state,
 * and on a subsequent page load
 * `App.reload` calls `GET /api/annotations` to restore the list.
 *
 * Test ensures the selected text re-appears as a draft mark after
 * `page.reload()`, while the card stays focused on the instruction input.
 */
import { test, expect } from '@playwright/test'
import { clearSidecar, createAnnotation, waitForReaderReady } from './helpers'

test.describe('document state persistence', () => {
  test.beforeEach(() => {
    clearSidecar()
  })

  test('annotation survives page reload', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'session token' })

    // Sanity: card visible pre-reload.
    await expect(page.locator('.anno-card')).toHaveCount(1)

    // Reload — App refetches /api/annotations from the sidecar JSON.
    await page.reload()
    await waitForReaderReady(page)
    await page.getByRole('tab', { name: /Comments/ }).click()

    // Annotation card should re-appear without duplicating the selected text.
    const card = page.locator('.anno-card').first()
    await expect(card).toBeVisible()
    await expect(card).not.toContainText(selected)
    await expect(card.locator('textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
    await expect(page.locator('mark.anno.draft')).toHaveText(selected)
  })
})
