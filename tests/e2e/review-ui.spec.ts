import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { clearSidecar, waitForReaderReady } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_PATH = resolve(__dirname, '../../sample.md')
let sampleBaseline = ''
const REVIEW_SAMPLE = [
  '# 示例:auth 重构计划',
  '',
  '## 目标',
  '',
  '- 会话能够即时撤销，且敏感载荷不暴露在客户端。',
  '',
  '## 范围',
  '',
  '- 包含 web 端登录、API 网关鉴权、第三方 OAuth 回调。',
  '- 不包含移动端登录。',
  '',
  '## 方案',
  '',
  '### 服务端 Session',
  '',
  '- 登录成功后服务端在 Redis 中创建 session 记录。',
  '  - session 记录包含用户身份、过期时间、设备信息。',
  '- 网关用 session ID 查询实际状态。',
  '',
  '## 验收',
  '',
  '- 登出、风控、密码修改时会话立刻失效。',
  '',
  '## 待确认',
  '',
  '- 是否接入外部 IdP。',
].join('\n')

async function lockedPlanStateCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const res = await fetch('/api/plan-state')
    const body = (await res.json()) as { planState: Array<{ status: string }> }
    return body.planState.filter((state) => state.status === 'locked').length
  })
}

async function saveDocumentWithReplacement(
  page: Page,
  search: string,
  replacement: string,
): Promise<void> {
  await page.evaluate(
    async ({ search, replacement }) => {
      const fileRes = await fetch('/api/file')
      const file = (await fileRes.json()) as { content: string }
      if (!file.content.includes(search)) {
        throw new Error(`sample text not found: ${search}`)
      }
      const next = file.content.replace(search, replacement)
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next }),
      })
    },
    { search, replacement },
  )
}

test.describe('Review UI', () => {
  test.beforeAll(() => {
    sampleBaseline = readFileSync(SAMPLE_PATH, 'utf8')
  })

  test.beforeEach(() => {
    clearSidecar()
    writeFileSync(SAMPLE_PATH, REVIEW_SAMPLE, 'utf8')
  })

  test.afterEach(() => {
    writeFileSync(SAMPLE_PATH, sampleBaseline, 'utf8')
    clearSidecar()
  })

  test('review panel renders without console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (text.includes('Failed to load resource') && text.includes('404')) return
      consoleErrors.push(text)
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto('/')
    await waitForReaderReady(page)

    await expect(page.locator('.review-style-picker')).toHaveCount(0)
    await expect(page.locator('.plan-panel')).toBeVisible()
    await expect(page.locator('.review-outline')).toBeVisible()
    await expect(page.locator('.review-point', { hasText: '服务端 Session' })).toHaveCount(1)
    await expect(
      page.locator('.review-detail', {
        hasText: '登录成功后服务端在 Redis 中创建 session 记录。',
      }),
    ).toHaveCount(0)
    await page.locator('.review-point-main', { hasText: '服务端 Session' }).click()
    await expect(
      page.locator('.review-detail', {
        hasText: '登录成功后服务端在 Redis 中创建 session 记录。',
      }),
    ).toBeVisible()
    await page.locator('.review-point-main', { hasText: '服务端 Session' }).click()
    await expect(
      page.locator('.review-detail', {
        hasText: '登录成功后服务端在 Redis 中创建 session 记录。',
      }),
    ).toHaveCount(0)
    await expect(page.locator('.review-point-check').first()).toBeVisible()
    await expect(page.locator('.review-tab-panel')).not.toBeEmpty()
    await expect(page.locator('.plan-rail-marker[aria-label*="服务端 Session"]')).toHaveCount(1)
    await expect
      .poll(async () =>
        page
          .locator('.plan-rail-marker[aria-label*="服务端 Session"] .plan-rail-line')
          .evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBeGreaterThan(70)

    expect(consoleErrors).toEqual([])
  })

  test('review panel avoids horizontal overflow on desktop and mobile', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 980 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await waitForReaderReady(page)

      await expect(page.locator('.plan-panel')).toBeVisible()
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    }
  })

  test('review outline item locks and persists', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await expect(page.locator('.review-outline')).toBeVisible()
    await page.locator('.review-point-check').first().click()
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)

    await page.reload()
    await waitForReaderReady(page)
    await expect(page.locator('.review-point.locked').first()).toBeVisible()
    await expect(page.locator('.plan-rail-marker.locked').first()).toBeVisible()
  })

  test('review item hover previews source text and click feedback is transient', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const point = page.locator('.review-point', { hasText: '服务端 Session' }).first()
    await point.hover()
    await expect(page.locator('.plan-block-hover')).not.toHaveCount(0)

    await page.mouse.move(20, 20)
    await expect(page.locator('.plan-block-hover')).toHaveCount(0)

    await point.click()
    await expect(point).toHaveClass(/flash/)
    await expect(point).not.toHaveClass(/active/)
    await expect(point).not.toHaveClass(/flash/, { timeout: 1000 })
  })

  test('locked plan item becomes stale after source text changes and can be relocked', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await page.locator('.review-point-check').first().click()
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)

    await saveDocumentWithReplacement(
      page,
      '会话能够即时撤销，且敏感载荷不暴露在客户端。',
      '会话能够即时撤销，且敏感载荷不暴露在客户端和日志中。',
    )
    await page.reload()
    await waitForReaderReady(page)

    await expect(page.locator('.review-point.stale').first()).toBeVisible()
    await page.locator('.review-point.stale .review-point-check').first().click()
    await expect(page.locator('.review-point.stale')).toHaveCount(0)
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)
  })

  test('signals tooltip appears on hover and matches review sections', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await waitForReaderReady(page)

    await expect(page.locator('.app-header')).not.toContainText('Decided')
    const popover = page.locator('.signals-popover')
    await expect(popover).not.toBeVisible()

    await page.locator('.signals-trigger').hover()
    await expect(popover).toBeVisible()
    await expect
      .poll(async () =>
        popover.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth
        }),
      )
      .toBe(true)

    await expect(page.locator('.signal-item').first()).toContainText(/未确认|需复核/)
    const firstSignalSection =
      ((await page.locator('.signal-item strong').first().textContent()) ?? '').split(' ')[0] ?? ''
    await expect(
      page.locator('.review-section-title', { hasText: firstSignalSection }).first(),
    ).toBeVisible()
  })
})
