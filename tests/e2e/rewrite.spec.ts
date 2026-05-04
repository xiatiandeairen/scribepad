/**
 * rewrite.spec — flow #3-#5: draft → input instruction → AI returns →
 * deciding card → open modal → accept → applied.
 *
 * Steps mirror docs/plan.md §1.2 rows "AI 改写", "看 diff", "接受",
 * exercising the §1.4 state machine path:
 *
 *   draft --[submit instruction]--> discussed (thinking)
 *         --[mock /api/rewrite returns]--> discussed (deciding, ai_suggestion set)
 *         --[click card]--> modal open
 *         --[click ↵ 接受]--> applied (status=applied, mark removed, content updated)
 *
 * /api/rewrite is mocked deterministically (no real CLI agent calls). The mock
 * appends ' [改写]' to the selection so we can grep for it in the document.
 */
import { test, expect } from '@playwright/test'
import { clearSidecar, createAnnotation, mockRewrite, waitForReaderReady } from './helpers'

test.describe('rewrite flow', () => {
  test.beforeEach(async ({ page }) => {
    clearSidecar()
    await mockRewrite(page)
  })

  test('draft → instruction → AI returns → modal → accept → applied', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'session token' })

    // Type an instruction in the draft card and press Enter.
    const card = page.locator('.anno-card').first()
    const input = card.locator('textarea[placeholder="告诉 AI 怎么改…"]')
    await input.fill('改得更专业一些')
    await input.press('Enter')

    // Card transitions: thinking → deciding. Thinking state can be very brief
    // because our mock responds synchronously, so we tolerate either being
    // observed or going straight to deciding. Deciding is the post-condition.
    const deciding = page.locator('.anno-card.deciding')
    await expect(deciding).toBeVisible()

    // Open the diff modal.
    await deciding.click()
    const modal = page.locator('.diff-modal')
    await expect(modal).toBeVisible()
    // The modal should show the user's instruction and the AI rewrite line
    // (selection + ' [改写]' from the mock).
    await expect(modal.locator('.instruction-box')).toContainText('改得更专业一些')
    await expect(modal.locator('.row-add')).toContainText(selected + ' [改写]')

    // Accept.
    await modal.locator('button.primary', { hasText: '接受' }).first().click()
    await expect(modal).not.toBeVisible()

    // Post-accept: mark.anno is gone (status=applied → hidden from reader),
    // sidebar card is gone, and the underlying document content includes '[改写]'.
    await expect(page.locator('mark.anno')).toHaveCount(0)
    await expect(page.locator('.anno-card')).toHaveCount(0)
    await expect(page.locator('.reader')).toContainText('[改写]')
  })

  test('accept earlier rewrite keeps later annotations alive after splice', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const firstSelected = await createAnnotation(page, { substring: 'session token' })
    const secondSelected = await createAnnotation(page, {
      paragraphSelector: '.reader',
      substring: '成熟身份提供商',
    })

    const secondCard = page.locator('.anno-card', { hasText: secondSelected }).first()
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('再压缩一点')
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')
    await expect(
      page.locator('.anno-card.deciding', { hasText: secondSelected }).first(),
    ).toBeVisible()

    const firstCard = page.locator('.anno-card', { hasText: firstSelected }).first()
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('改得更专业一些')
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')

    const firstDeciding = page.locator('.anno-card.deciding', { hasText: firstSelected }).first()
    await expect(firstDeciding).toBeVisible()
    await firstDeciding.click()
    await page.locator('.diff-modal button.primary', { hasText: '接受' }).first().click()

    await expect(page.locator('.reader')).toContainText(firstSelected + ' [改写]')

    const survivingCard = page.locator('.anno-card.deciding', { hasText: secondSelected }).first()
    await expect(survivingCard).toBeVisible()
    await expect(page.locator('mark.anno.deciding')).toHaveCount(1)

    await survivingCard.click()
    await expect(page.locator('.diff-modal .row-add')).toContainText(secondSelected + ' [改写]')
  })
})
