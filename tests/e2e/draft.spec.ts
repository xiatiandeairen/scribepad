/**
 * draft.spec — flow #1: select text → release → draft card visible.
 *
 * Covers `docs/plan.md` §1.2 row "创建批注(draft)" and the leftmost
 * column of the §1.4 state machine. After the user clicks the popover, we
 * expect:
 *   - exactly one `.anno-card` rendered in the sidebar (variant=draft) with
 *     only the instruction input and confirm/cancel actions;
 *   - a `mark.anno.draft` wrapping the selected text inside the reader.
 *
 * No network mocks needed — creating a draft does not call /api/rewrite.
 * The /api/annotations POST is a real call to the dev server but writes to
 * the local sidecar (cleared in beforeEach).
 */
import { test, expect, type Page } from '@playwright/test'
import {
  clearSidecar,
  createAnnotation,
  releaseReaderDragSelection,
  waitForReaderReady,
} from './helpers'

async function selectAcrossReaderText(
  page: Page,
  opts: {
    startSelector: string
    startIndex?: number
    startText: string
    endSelector: string
    endIndex?: number
    endText: string
  },
): Promise<string> {
  return page.evaluate((args) => {
    const findTextNode = (root: Element, text: string): { node: Text; offset: number } => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const offset = node.data.indexOf(text)
        if (offset >= 0) return { node, offset }
      }
      throw new Error(`text not found: ${text}`)
    }

    const startRoot = document.querySelectorAll(args.startSelector)[args.startIndex ?? 0]
    const endRoot = document.querySelectorAll(args.endSelector)[args.endIndex ?? 0]
    if (!startRoot) throw new Error(`start root not found: ${args.startSelector}`)
    if (!endRoot) throw new Error(`end root not found: ${args.endSelector}`)

    const start = findTextNode(startRoot, args.startText)
    const end = findTextNode(endRoot, args.endText)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset + args.endText.length)

    const selection = window.getSelection()
    if (!selection) throw new Error('no Selection API')
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return range.toString()
  }, opts)
}

async function commitReaderSelection(page: Page): Promise<void> {
  await releaseReaderDragSelection(page)
}

async function textDragPoint(
  page: Page,
  opts: { selector: string; text: string; edge: 'start' | 'end' },
): Promise<{ x: number; y: number }> {
  return page.evaluate((args) => {
    const root = document.querySelector(args.selector)
    if (!root) throw new Error(`root not found: ${args.selector}`)

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const offset = node.data.indexOf(args.text)
      if (offset < 0) continue

      const range = document.createRange()
      const rangeOffset = args.edge === 'start' ? offset : offset + args.text.length
      range.setStart(node, rangeOffset)
      range.setEnd(node, rangeOffset)
      const rect = range.getBoundingClientRect()
      if (rect.width || rect.height) return { x: rect.left, y: rect.top + rect.height / 2 }

      const parentRect = node.parentElement?.getBoundingClientRect()
      if (!parentRect) throw new Error(`text has no rect: ${args.text}`)
      return {
        x: args.edge === 'start' ? parentRect.left : parentRect.right,
        y: parentRect.top + parentRect.height / 2,
      }
    }

    throw new Error(`text not found: ${args.text}`)
  }, opts)
}

test.describe('draft flow', () => {
  test.beforeEach(() => {
    clearSidecar()
  })

  test('select text → release → draft card visible + draft mark in reader', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await createAnnotation(page, { substring: 'session token' })

    // Sidebar: exactly one card, in draft variant. The card intentionally does
    // not repeat the selected sentence; it starts at the instruction input.
    const card = page.locator('.anno-card').first()
    await expect(card).toBeVisible()
    await expect(card).not.toContainText(selected)
    await expect(card.locator('textarea[placeholder="告诉 AI 怎么改…"]')).toBeVisible()
    await expect(card.locator('button[aria-label="提交批注"]')).toBeVisible()
    await expect(card.locator('button[aria-label="取消批注"]')).toBeVisible()

    // Reader: a <mark class="anno draft"> wraps the selected text.
    const mark = page.locator('mark.anno.draft')
    await expect(mark).toBeVisible()
    await expect(mark).toHaveText(selected)
    await expect(page.locator('.anno-tail')).toHaveCount(0)
  })

  test('click sentence → creates whole-sentence draft annotation directly', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const sentence = page.locator('.reader [data-sentence-idx]', { hasText: '涉及范围' }).first()
    const sentenceText = (await sentence.textContent())?.trim() ?? ''
    await sentence.click()

    await expect(page.locator('.popover')).toHaveCount(0)
    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(page.locator('.anno-card')).not.toContainText('涉及范围')
    await expect(page.locator('mark.anno.draft')).toHaveText(sentenceText)
  })

  test('cross-paragraph free selection creates one draft with split marks', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const selected = await selectAcrossReaderText(page, {
      startSelector: '.reader p',
      startIndex: 0,
      startText: 'session token',
      endSelector: '.reader p',
      endIndex: 1,
      endText: 'OAuth 回调',
    })
    await commitReaderSelection(page)

    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect.poll(async () => page.locator('mark.anno.draft').count()).toBeGreaterThan(1)
    await expect(page.locator('mark.anno.draft').first()).toContainText('session token')
    await expect(page.locator('mark.anno.draft').last()).toContainText('OAuth 回调')
    const annotationIds = await page
      .locator('mark.anno.draft')
      .evaluateAll((marks) =>
        Array.from(new Set(marks.map((mark) => mark.getAttribute('data-anno-id')))),
      )
    expect(annotationIds).toHaveLength(1)
    expect(selected).toContain('session token')
    expect(selected).toContain('OAuth 回调')
  })

  test('cross-list-item free selection creates one draft', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await selectAcrossReaderText(page, {
      startSelector: '.reader li',
      startIndex: 0,
      startText: '可即时撤销',
      endSelector: '.reader li',
      endIndex: 1,
      endText: '敏感信息泄露风险',
    })
    await commitReaderSelection(page)

    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect.poll(async () => page.locator('mark.anno.draft').count()).toBeGreaterThan(1)
    await expect(page.locator('mark.anno.draft').first()).toContainText('可即时撤销')
    await expect(page.locator('mark.anno.draft').last()).toContainText('敏感信息泄露风险')
  })

  test('fast drag release outside reader still creates one draft', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    const start = await textDragPoint(page, {
      selector: '.reader p',
      text: 'session token',
      edge: 'start',
    })
    const end = await textDragPoint(page, {
      selector: '.reader p',
      text: 'session token',
      edge: 'end',
    })
    const readerBox = await page.locator('.reader').boundingBox()
    if (!readerBox) throw new Error('reader box not found')

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 1 })
    await page.mouse.move(readerBox.x + readerBox.width + 160, end.y, { steps: 1 })
    await page.mouse.up()

    await expect(page.locator('.anno-card')).toHaveCount(1)
    await expect(page.locator('mark.anno.draft')).toContainText('session token')
  })

  test('empty draft disappears after clicking elsewhere', async ({ page }) => {
    await page.goto('/')
    await waitForReaderReady(page)

    await createAnnotation(page, { substring: 'session token' })
    await expect(page.locator('.anno-card')).toHaveCount(1)

    await page.locator('.reader').click({ position: { x: 24, y: 24 } })
    await expect(page.locator('.anno-card')).toHaveCount(0)
    await expect(page.locator('mark.anno.draft')).toHaveCount(0)
  })
})
