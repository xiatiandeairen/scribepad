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
 *         --[click 接受]--> applied (status=applied, mark removed, content updated)
 *
 * /api/rewrite is mocked deterministically (no real CLI agent calls). The mock
 * appends ' [改写]' to the selection so we can grep for it in the document.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { clearSidecar, createAnnotation, mockRewrite, waitForReaderReady } from './helpers'

async function mockRewriteDelayed(page: Page, delayMs = 350): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    const req = route.request()
    const body = req.postDataJSON() as { items: { id: string; selection: string }[] }
    const results = (body.items ?? []).map((it) => ({
      id: it.id,
      rewritten: `${it.selection} [${body.items.length}-${Date.now()}]`,
    }))
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    })
  })
}

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
    // The modal focuses on the AI rewrite line (selection + ' [改写]' from the mock).
    await expect(modal.locator('.instruction-box')).toHaveCount(0)
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

    const secondCard = page.locator('.anno-card').nth(1)
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('再压缩一点')
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')
    await expect(secondCard).toContainText('AI 已返回')
    await expect(secondCard).not.toContainText(secondSelected)

    const firstCard = page.locator('.anno-card').first()
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('改得更专业一些')
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')

    await expect(page.locator('.anno-card.deciding')).toHaveCount(2)
    await expect(page.locator('.anno-card.deciding').first()).not.toContainText(firstSelected)
    await page.locator('.anno-card.deciding').first().click()
    await page.locator('.diff-modal button.primary', { hasText: '接受' }).first().click()

    await expect(page.locator('.reader')).toContainText(firstSelected + ' [改写]')

    await expect(page.locator('.anno-card.deciding')).toHaveCount(1)
    const survivingCard = page.locator('.anno-card.deciding').first()
    await expect(survivingCard).not.toContainText(secondSelected)
    await expect(page.locator('mark.anno.deciding')).toHaveCount(1)

    await survivingCard.click()
    await expect(page.locator('.diff-modal .row-add')).toContainText(secondSelected + ' [改写]')
  })

  test('reprompt stays in modal, syncs sidebar thinking, and can reopen after close', async ({
    page,
  }) => {
    await page.unroute('**/api/rewrite')
    await mockRewriteDelayed(page)
    await page.goto('/')
    await waitForReaderReady(page)

    await createAnnotation(page, { substring: 'session token' })
    const card = page.locator('.anno-card').first()
    await card.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('先改一次')
    await card.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')

    await expect(page.locator('.anno-card.deciding')).toBeVisible()
    await page.locator('.anno-card.deciding').click()
    const modal = page.locator('.diff-modal')
    await expect(modal).toBeVisible()

    const reprompt = modal.locator('.reprompt textarea')
    await reprompt.fill('再改一次')
    await reprompt.press('Enter')

    await expect(modal).toBeVisible()
    await expect(modal.locator('.row-add')).toContainText('正在分析中')
    await expect(page.locator('.anno-card')).toContainText('思考中')

    await page.locator('.diff-modal-header .close-btn').click()
    await expect(modal).toHaveCount(0)
    await expect(page.locator('.anno-card')).toContainText('思考中')

    await expect(page.locator('.anno-card.deciding')).toBeVisible()
    await page.locator('.anno-card.deciding').click()
    await expect(modal).toBeVisible()
    await expect(modal.locator('.row-add')).not.toContainText('正在分析中')
  })
})
