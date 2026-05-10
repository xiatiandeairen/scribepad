import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { clearSidecar, waitForReaderReady } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_PATH = resolve(__dirname, '../../sample.md')
let sampleBaseline = ''

const REVIEW_STYLES = [
  'executive',
  'spreadsheet',
  'kanban',
  'timeline',
  'command',
  'minimal',
  'inspector',
  'contrast',
] as const

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
    writeFileSync(SAMPLE_PATH, sampleBaseline, 'utf8')
  })

  test.afterEach(() => {
    writeFileSync(SAMPLE_PATH, sampleBaseline, 'utf8')
    clearSidecar()
  })

  test('all review styles render without console errors', async ({ page }) => {
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

    for (const style of REVIEW_STYLES) {
      await page.locator('.review-style-picker select').selectOption(style)
      await expect(page.locator('.plan-panel')).toBeVisible()
      await expect(page.locator('.review-tab-panel')).not.toBeEmpty()
    }

    expect(consoleErrors).toEqual([])
  })

  test('all review styles avoid horizontal overflow on desktop and mobile', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 980 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await waitForReaderReady(page)

      for (const style of REVIEW_STYLES) {
        await page.locator('.review-style-picker select').selectOption(style)
        await expect(page.locator('.plan-panel')).toBeVisible()
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
      }
    }
  })

  test('executive outline item locks and persists', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await expect(page.locator('.executive-outline')).toBeVisible()
    await page.locator('.executive-point').first().click()
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)

    await page.reload()
    await waitForReaderReady(page)
    await expect(page.locator('.executive-point.locked').first()).toBeVisible()
    await expect(page.locator('.plan-rail-marker.locked').first()).toBeVisible()
  })

  test('timeline step locks and persists', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)
    await page.locator('.review-style-picker select').selectOption('timeline')

    await expect(page.locator('.timeline-step').first()).toBeVisible()
    await page.locator('.timeline-step').first().click()
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)

    await page.reload()
    await waitForReaderReady(page)
    await page.locator('.review-style-picker select').selectOption('timeline')
    await expect(page.locator('.timeline-step.locked').first()).toBeVisible()
  })

  test('locked plan item becomes stale after source text changes and can be relocked', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await page.locator('.executive-point').first().click()
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)

    await saveDocumentWithReplacement(page, '当前业务背景是：', '当前业务背景是：更新后')
    await page.reload()
    await waitForReaderReady(page)

    await expect(page.locator('.executive-point.stale').first()).toBeVisible()
    await page.locator('.executive-point.stale').first().click()
    await expect(page.locator('.executive-point.stale')).toHaveCount(0)
    await expect.poll(() => lockedPlanStateCount(page)).toBe(1)
  })

  test('signals popover is usable on mobile and can focus a linked item', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await waitForReaderReady(page)

    await page.locator('.signals-trigger').click()
    const popover = page.locator('.signals-popover')
    await expect(popover).toBeVisible()
    await expect
      .poll(async () =>
        popover.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth
        }),
      )
      .toBe(true)

    await page.locator('.signal-item', { hasText: '尚未锁定' }).first().click()
    await expect(popover).not.toBeVisible()
    await expect(page.locator('.plan-block-active')).toBeVisible()
  })
})
