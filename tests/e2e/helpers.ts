/**
 * E2E helpers — shared utilities for scribepad Playwright specs.
 *
 * Responsibilities:
 *   1. clearSidecar() — wipe sample.md document state so each spec starts
 *      from a known-empty state.
 *   2. mockRewrite() — register a deterministic /api/rewrite handler that
 *      returns `<selection> [改写]` per item. Avoids real CLI agent calls
 *      so tests run offline + fast.
 *   3. mockRewriteError() — register an error response for /api/rewrite (for
 *      防漂移 / failure-path tests).
 *   4. selectTextInReader() — programmatically select a contiguous text run
 *      inside `.reader` using the Range API. Returns the selected text so the
 *      caller can assert against the resulting annotation.
 *   5. createAnnotation() — high-level: select text and wait for the
 *      resulting `.anno-card` to appear.
 */
import { type Page, type Route, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import { documentStatePath, legacySidecarPath } from '../../server/paths'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const SAMPLE_PATH = resolve(REPO_ROOT, 'sample.md')

/** Absolute path to the XDG document state JSON for sample.md. */
export function sidecarPath(): string {
  return documentStatePath(REPO_ROOT, SAMPLE_PATH, process.env)
}

/** Best-effort delete document state; no-op when missing. Synchronous because
 *  Playwright `beforeEach` accepts sync work and we want the FS state settled
 *  before the dev server reads it on page load. */
export function clearSidecar(): void {
  for (const p of [sidecarPath(), legacySidecarPath(SAMPLE_PATH)]) {
    if (existsSync(p)) {
      unlinkSync(p)
    }
  }
}

/** Install a /api/rewrite mock that echoes selection + ' [改写]' for each item. */
export async function mockRewrite(page: Page): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    const req = route.request()
    const body = req.postDataJSON() as { items: { id: string; selection: string }[] }
    const results = (body.items ?? []).map((it) => ({
      id: it.id,
      rewritten: it.selection + ' [改写]',
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    })
  })
}

/** Install a /api/rewrite mock that returns 500 with the 防漂移 error message. */
export async function mockRewriteError(
  page: Page,
  message = 'all selected items are state=decided; cannot rewrite',
): Promise<void> {
  await page.route('**/api/rewrite', async (route: Route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: message }),
    })
  })
}

/**
 * Programmatically select a substring of text inside the reader's first
 * paragraph (or the paragraph matching `paragraphSelector`). Dispatches a
 * `selectionchange` so the Reader's debounced listener fires.
 *
 * Returns the actually-selected substring (for assertions).
 */
export async function selectTextInReader(
  page: Page,
  opts: { paragraphSelector?: string; substring?: string } = {},
): Promise<string> {
  const paragraphSelector = opts.paragraphSelector ?? '.reader p'
  const substring = opts.substring ?? null

  const selected = await page.evaluate(
    (args: { paragraphSelector: string; substring: string | null }) => {
      const root = document.querySelector(args.paragraphSelector)
      if (!root) throw new Error('paragraph not found: ' + args.paragraphSelector)

      // Find a text node inside this paragraph; if substring given, locate it.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let target: Text | null = null
      let startOffset = 0
      let endOffset = 0
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text
        const value = tn.data
        if (args.substring) {
          const idx = value.indexOf(args.substring)
          if (idx >= 0) {
            target = tn
            startOffset = idx
            endOffset = idx + args.substring.length
            break
          }
        } else if (value.trim().length >= 4) {
          // Default: pick the first 6 chars of a non-trivial text node.
          target = tn
          startOffset = 0
          endOffset = Math.min(6, value.length)
          break
        }
      }
      if (!target) throw new Error('no suitable text node found')

      const range = document.createRange()
      range.setStart(target, startOffset)
      range.setEnd(target, endOffset)
      const sel = window.getSelection()
      if (!sel) throw new Error('no Selection API')
      sel.removeAllRanges()
      sel.addRange(range)
      // Force the listener to fire (jsdom-style environments need this; in
      // real Chromium the addRange already triggers selectionchange, but the
      // explicit dispatch is harmless and increases determinism).
      document.dispatchEvent(new Event('selectionchange'))
      return range.toString()
    },
    { paragraphSelector, substring },
  )

  return selected
}

/**
 * Full create-annotation flow: wait for reader render, select text, release
 * the pointer-equivalent path, then wait for the resulting `.anno-card` to
 * be visible. Programmatic selection does not naturally fire pointerup, so
 * this helper dispatches one to mirror the real user gesture.
 */
export async function createAnnotation(
  page: Page,
  opts: { paragraphSelector?: string; substring?: string } = {},
): Promise<string> {
  await expect(page.locator('.reader p').first()).toBeVisible()
  const commentsTab = page.getByRole('tab', { name: /Comments/ })
  if ((await commentsTab.getAttribute('aria-selected')) !== 'true') {
    await commentsTab.click()
  }
  const readerBox = await page.locator('.reader').boundingBox()
  if (!readerBox) throw new Error('reader box not found')
  const startX = readerBox.x + 10
  const startY = readerBox.y + 10
  await page.locator('.reader').dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    clientX: startX,
    clientY: startY,
    bubbles: true,
  })
  const selected = await selectTextInReader(page, opts)
  await page.evaluate(
    ({ clientX, clientY }) => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'mouse',
          pointerId: 1,
          clientX,
          clientY,
          bubbles: true,
        }),
      )
    },
    { clientX: startX + 30, clientY: startY },
  )
  await expect(page.locator('.anno-card').first()).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async (text) => {
        const res = await fetch('/api/annotations')
        const data = (await res.json()) as {
          annotations?: Array<{ anchor?: { text?: string } }>
        }
        return (data.annotations ?? []).some((annotation) => annotation.anchor?.text === text)
      }, selected),
    )
    .toBe(true)
  return selected
}

export async function releaseReaderDragSelection(page: Page): Promise<void> {
  const readerBox = await page.locator('.reader').boundingBox()
  if (!readerBox) throw new Error('reader box not found')
  const startX = readerBox.x + 10
  const startY = readerBox.y + 10
  await page.locator('.reader').dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    clientX: startX,
    clientY: startY,
    bubbles: true,
  })
  await page.evaluate(
    ({ clientX, clientY }) => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'mouse',
          pointerId: 1,
          clientX,
          clientY,
          bubbles: true,
        }),
      )
    },
    { clientX: startX + 30, clientY: startY },
  )
  await expect(page.locator('.anno-card').first()).toBeVisible()
}

/**
 * Wait for the reader to have populated content (markdown rendered into
 * paragraphs with data-src attributes installed).
 */
export async function waitForReaderReady(page: Page): Promise<void> {
  await expect(page.locator('.reader p').first()).toBeVisible()
}
