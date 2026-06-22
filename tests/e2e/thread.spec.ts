import { test, expect } from '@playwright/test'
import { clearSidecar, createAnnotation, waitForReaderReady } from './helpers'

test.describe('annotation threads', () => {
  test.beforeEach(async ({ page }) => {
    await clearSidecar()
    await page.goto('/')
    await waitForReaderReady(page)
  })

  test('adds note and decision messages to an annotation thread', async ({ page }) => {
    await createAnnotation(page)

    const card = page.locator('.anno-card').first()
    await expect(card).toBeVisible()

    const input = card.locator('textarea[placeholder="告诉 AI 怎么改…"]')
    await input.fill('这个范围先留一个人工 note')
    await card.getByRole('button', { name: '追加 note' }).click()

    await expect(card.locator('.thread-message.note')).toContainText('这个范围先留一个人工 note')

    await input.fill('确认 v0.3 只做 decision thread')
    await card.getByRole('button', { name: '写成决定并锁定' }).click()

    await expect(card.locator('.thread-message.decision')).toContainText(
      '确认 v0.3 只做 decision thread',
    )
    await expect(card.locator('.status-line')).toContainText('已锁定')

    const persisted = await page.evaluate(async () => {
      const res = await fetch('/api/annotations')
      const data = (await res.json()) as {
        annotations: Array<{ state: string; thread?: Array<{ kind: string; text: string }> }>
      }
      return data.annotations[0]
    })

    expect(persisted?.state).toBe('decided')
    expect(persisted?.thread?.map((message) => message.kind)).toEqual(['note', 'decision'])
  })
})
