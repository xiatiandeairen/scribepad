/**
 * P0 E2E — product-critical flows for scribepad v0.2.
 *
 * These tests intentionally assert user outcomes, not detailed DOM layout:
 *   1. open and read a markdown file;
 *   2. create and persist annotations from selections;
 *   3. review, accept, or cancel AI rewrites;
 *   4. lock decisions and block decided-content rewrites;
 *   5. keep nearby annotations usable after one rewrite is applied.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  clearSidecar,
  createAnnotation,
  mockRewrite,
  mockRewriteError,
  waitForReaderReady,
} from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_PATH = resolve(__dirname, '../../sample.md')
let sampleBaseline = ''

function restoreSample(): void {
  writeFileSync(SAMPLE_PATH, sampleBaseline, 'utf8')
}

async function mockRewriteSlow(page: Page, delayMs = 300): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    const body = route.request().postDataJSON() as {
      items?: Array<{ id: string; selection: string }>
    }
    const results = (body.items ?? []).map((item) => ({
      id: item.id,
      rewritten: `${item.selection} [改写]`,
    }))
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    })
  })
}

async function submitInstruction(page: Page, text: string): Promise<void> {
  const input = page.locator('.anno-card textarea[placeholder="告诉 AI 怎么改…"]').first()
  await input.fill(text)
  await input.press('Enter')
}

async function waitForAnnotationCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => {
      const res = await page.evaluate(async () => {
        const annotationsRes = await fetch('/api/annotations')
        const data = (await annotationsRes.json()) as { annotations: unknown[] }
        return data.annotations.length
      })
      return res
    })
    .toBe(count)
}

async function promoteFirstAnnotationToDecided(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const res = await fetch('/api/annotations')
    const data = (await res.json()) as { annotations: Array<Record<string, unknown>> }
    const next = data.annotations.map((annotation, index) =>
      index === 0 ? { ...annotation, state: 'decided' } : annotation,
    )
    await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations: next }),
    })
  })
}

test.describe('P0 product flows', () => {
  test.beforeAll(() => {
    sampleBaseline = readFileSync(SAMPLE_PATH, 'utf8')
  })

  test.beforeEach(() => {
    clearSidecar()
    restoreSample()
  })

  test.afterEach(() => {
    restoreSample()
    clearSidecar()
  })

  test('P0.1 打开文档后可阅读 markdown，初始批注状态正确', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)

    await waitForReaderReady(page)
    await expect(page.locator('.app-header strong')).toHaveText('scribepad')
    await expect(page.locator('.app-header .path')).toContainText('sample.md')
    await expect(page.locator('.reader h1')).toBeVisible()
    await expect(page.locator('.reader h2').first()).toBeVisible()
    await expect(page.locator('.sidebar .empty')).toBeVisible()
    await expect(page.locator('.app-header .badge')).toHaveText('0 批注 · 0 已定')
  })

  test('P0.2 选区可以创建 draft 批注，并在刷新后从 sidecar 恢复', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'session token' })
    await expect(page.locator('mark.anno.draft')).toHaveText(selected)
    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(page.locator('.app-header .badge')).toHaveText('1 批注 · 0 已定')

    await page.reload()
    await waitForReaderReady(page)

    await expect(page.locator('mark.anno.draft')).toHaveText(selected)
    await expect(page.locator('.anno-card .head .text')).toContainText(selected)
    await expect(page.locator('.app-header .badge')).toHaveText('1 批注 · 0 已定')
  })

  test('P0.3 AI 改写进入 thinking/deciding，打开 diff 后接受并写回文档', async ({ page }) => {
    await mockRewriteSlow(page)
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'session token' })
    await submitInstruction(page, '改得更明确')

    await expect(page.locator('.anno-card')).toContainText('思考中')
    await expect(page.locator('.anno-card.deciding')).toContainText('AI 已返回')

    await page.locator('.anno-card.deciding').click()
    const modal = page.locator('.diff-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('改得更明确')
    await expect(modal.locator('.row-del')).toContainText(selected)
    await expect(modal.locator('.row-add')).toContainText(`${selected} [改写]`)

    await modal.locator('button.primary', { hasText: '接受' }).first().click()

    await expect(modal).not.toBeVisible()
    await expect(page.locator('.reader')).toContainText(`${selected} [改写]`)
    await expect(page.locator('mark.anno')).toHaveCount(0)
    await expect(page.locator('.anno-card')).toHaveCount(0)
  })

  test('P0.4 取消 diff 不写回文档，批注回到 draft 可继续编辑', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: '会话能够即时撤销' })
    await submitInstruction(page, '改短一点')
    await expect(page.locator('.anno-card.deciding')).toBeVisible()

    await page.locator('mark.anno').click()
    await expect(page.locator('.diff-modal')).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(page.locator('.diff-modal')).not.toBeVisible()
    await expect(page.locator('.reader')).not.toContainText(`${selected} [改写]`)
    await expect(page.locator('mark.anno.draft')).toHaveText(selected)
    await expect(page.locator('.anno-card textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
  })

  test('P0.5 open 批注可被拍板为 decided，刷新后仍保持锁定', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'SOC2 要求' })
    await waitForAnnotationCount(page, 1)
    await promoteFirstAnnotationToDecided(page)
    // Use browser reload here because clicking outside an empty draft is a
    // product shortcut that dismisses the active draft before React refetches.
    await page.reload()
    await waitForReaderReady(page)

    await expect(page.locator('mark.anno.decided')).toHaveText(selected)
    await expect(page.locator('.anno-card.decided')).toContainText('已锁定')
    await expect(page.locator('.app-header .badge')).toHaveText('1 批注 · 1 已定')

    await page.reload()
    await waitForReaderReady(page)

    await expect(page.locator('mark.anno.decided')).toHaveText(selected)
    await expect(page.locator('.anno-card.decided')).toContainText('已锁定')
    await expect(page.locator('.app-header .badge')).toHaveText('1 批注 · 1 已定')
  })

  test('P0.6 rewrite 失败会展示错误，并回到可重试状态', async ({ page }) => {
    await mockRewriteError(page, 'all selected items are state=decided; cannot rewrite')
    await page.goto('/')
    await waitForReaderReady(page)

    await createAnnotation(page, { substring: '敏感载荷不暴露' })
    await submitInstruction(page, '改一下')

    await expect(page.locator('.toast')).toContainText('cannot rewrite')
    await expect(page.locator('.anno-card textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
    await expect(page.locator('mark.anno.draft')).toBeVisible()
  })

  test('P0.7 真实后端会拒绝 decided 段的 rewrite 请求', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, {
      paragraphSelector: '.reader',
      substring: '成熟身份提供商',
    })
    await waitForAnnotationCount(page, 1)
    await promoteFirstAnnotationToDecided(page)

    const result = await page.evaluate(async () => {
      const annotationsRes = await fetch('/api/annotations')
      const annotationsJson = (await annotationsRes.json()) as {
        annotations: Array<{ id: string; anchor: { text: string } }>
      }
      const fileRes = await fetch('/api/file')
      const file = (await fileRes.json()) as { content: string }
      const annotation = annotationsJson.annotations[0]
      const rewriteRes = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullDoc: file.content,
          items: [
            {
              id: annotation.id,
              selection: annotation.anchor.text,
              instruction: '改写这个已决定段',
            },
          ],
        }),
      })
      return {
        status: rewriteRes.status,
        body: (await rewriteRes.json()) as { error?: string },
      }
    })

    expect(selected).toBe('成熟身份提供商')
    expect(result.status).toBe(500)
    expect(result.body.error).toContain('cannot rewrite')
  })

  test('P0.8 接受一处改写后，其他 open 批注仍可打开并接受', async ({ page }) => {
    await mockRewrite(page)
    await page.goto('/')
    await waitForReaderReady(page)

    const first = await createAnnotation(page, { substring: 'session token' })
    const second = await createAnnotation(page, {
      paragraphSelector: '.reader',
      substring: '成熟身份提供商',
    })

    const secondCard = page.locator('.anno-card', { hasText: second }).first()
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('改第二处')
    await secondCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')
    await expect(secondCard).toContainText('AI 已返回')

    const firstCard = page.locator('.anno-card', { hasText: first }).first()
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').fill('改第一处')
    await firstCard.locator('textarea[placeholder="告诉 AI 怎么改…"]').press('Enter')
    await expect(firstCard).toContainText('AI 已返回')
    await firstCard.click()
    await page.locator('.diff-modal button.primary', { hasText: '接受' }).first().click()

    await expect(page.locator('.reader')).toContainText(`${first} [改写]`)
    await expect(page.locator('.anno-card', { hasText: second })).toBeVisible()

    await secondCard.click()

    await expect(page.locator('.diff-modal .row-add')).toContainText(`${second} [改写]`)
  })
})
