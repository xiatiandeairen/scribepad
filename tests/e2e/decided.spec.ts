/**
 * decided.spec — flow #6-#7: 拍板 lock + 防漂移 + graceful error UX.
 *
 * Three assertions tied to docs/plan.md §1.4 + §1.2:
 *   (1) An annotation in `state=decided` renders a green/locked card and a
 *       `mark.anno.decided` highlight in the reader.
 *   (2) The server's 防漂移 filter (services/rewrite.ts) rejects rewrite
 *       requests for decided segments — verified by calling /api/rewrite
 *       directly with a real (un-mocked) backend.
 *   (3) When /api/rewrite fails (500), the UI shows a `.toast` and reverts
 *       the in-flight annotation back to draft (App.tsx error path).
 *
 * Sidebar's `⋯` menu button is render-only (v0.2 deferred), so we trigger
 * the lock by writing directly through the public `/api/annotations` endpoint
 * and reloading — the alternative path explicitly allowed in the brief.
 */
import { test, expect } from '@playwright/test'
import { clearSidecar, createAnnotation, mockRewriteError, waitForReaderReady } from './helpers'

test.describe('decided flow + 防漂移', () => {
  test.beforeEach(() => {
    clearSidecar()
  })

  test('locked annotation renders decided variant + server blocks rewrite', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await createAnnotation(page, { substring: 'session token' })

    // Promote to decided via direct API write, then reload to refetch.
    await page.evaluate(async () => {
      const res = await fetch('/api/annotations')
      const data = (await res.json()) as { annotations: Array<{ state: string }> }
      const next = data.annotations.map((a) => ({ ...a, state: 'decided' as const }))
      await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: next }),
      })
    })
    await page.reload()
    await waitForReaderReady(page)
    await page.getByRole('tab', { name: /Comments/ }).click()

    const card = page.locator('.anno-card.decided')
    await expect(card).toBeVisible()
    await expect(card).toContainText('已锁定')
    await expect(page.locator('mark.anno.decided')).toBeVisible()

    // 防漂移: real backend should reject the rewrite for a decided id.
    const blocked = await page.evaluate(async () => {
      const annosRes = await fetch('/api/annotations')
      const data = (await annosRes.json()) as {
        annotations: Array<{ id: string; anchor: { text: string } }>
      }
      const a = data.annotations[0]
      const fileRes = await fetch('/api/file')
      const file = (await fileRes.json()) as { content: string }
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullDoc: file.content,
          items: [{ id: a.id, selection: a.anchor.text, instruction: '改写一下' }],
        }),
      })
      return { status: res.status, body: (await res.json()) as { error?: string } }
    })
    expect(blocked.status).toBe(500)
    expect(blocked.body.error).toContain('cannot rewrite')
  })

  test('rewrite 500 error surfaces a toast and reverts state to draft', async ({ page }) => {
    // Mock /api/rewrite to fail; create a fresh draft annotation, submit
    // an instruction, and verify the toast + state revert.
    await mockRewriteError(page, 'all selected items are state=decided; cannot rewrite')

    await page.goto('/')
    await waitForReaderReady(page)
    await createAnnotation(page, { substring: 'session token' })

    const card = page.locator('.anno-card').first()
    const input = card.locator('textarea[placeholder="告诉 AI 怎么改…"]')
    await input.fill('改一下')
    await input.press('Enter')

    // Toast should appear with the error message.
    const toast = page.locator('.toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('cannot rewrite')

    // Annotation should have reverted to draft (input row is back).
    await expect(card.locator('textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
  })
})
