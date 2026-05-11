/**
 * anchor.ts — selection ↔ markdown source-range anchor.
 *
 * Rendered markdown is expected to expose source-bearing DOM elements with
 * `data-src-start` and `data-src-end` attributes. A selection endpoint is
 * mapped to the nearest such element, then refined by the endpoint's rendered
 * text offset inside that element.
 */

import type { Anchor } from '../../types/annotation'

export interface AnchorLocation {
  root: HTMLElement
  elements: HTMLElement[]
  range: Range
  text: string
}

interface SourceElementRange {
  el: HTMLElement
  srcStart: number
  srcEnd: number
}

interface BoundaryLocation {
  node: Node
  offset: number
}

function parseSourceElement(el: Element): SourceElementRange | null {
  const srcStart = Number.parseInt(el.getAttribute('data-src-start') ?? '', 10)
  const srcEnd = Number.parseInt(el.getAttribute('data-src-end') ?? '', 10)
  if (!Number.isFinite(srcStart) || !Number.isFinite(srcEnd) || srcEnd < srcStart) return null
  return { el: el as HTMLElement, srcStart, srcEnd }
}

function isSourceElement(el: Element): boolean {
  return parseSourceElement(el) !== null
}

function findClosestAncestor(
  node: Node | null,
  predicate: (el: Element) => boolean,
): HTMLElement | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && predicate(cur as Element)) {
      return cur as HTMLElement
    }
    cur = cur.parentNode
  }
  return null
}

function findClosestSourceElement(node: Node | null): SourceElementRange | null {
  const el = findClosestAncestor(node, isSourceElement)
  return el ? parseSourceElement(el) : null
}

function textLength(node: Node): number {
  return node.textContent?.length ?? 0
}

/**
 * Count rendered text characters inside `root` before a DOM Range boundary.
 */
function charsBeforeBoundary(
  root: HTMLElement,
  boundaryNode: Node,
  boundaryOffset: number,
): number {
  let count = 0
  let done = false

  const walk = (node: Node): void => {
    if (done) return

    if (node === boundaryNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += Math.max(0, Math.min(boundaryOffset, textLength(node)))
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const kids = node.childNodes
        const limit = Math.max(0, Math.min(boundaryOffset, kids.length))
        for (let i = 0; i < limit; i++) walk(kids[i]!)
      }
      done = true
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      count += textLength(node)
      return
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]!)
    }
  }

  walk(root)
  return count
}

function sourceOffsetForBoundary(boundaryNode: Node, boundaryOffset: number): number | null {
  const carrier = findClosestSourceElement(boundaryNode)
  if (!carrier) return null

  const localOffset = charsBeforeBoundary(carrier.el, boundaryNode, boundaryOffset)
  const sourceOffset = carrier.srcStart + localOffset
  if (sourceOffset < carrier.srcStart || sourceOffset > carrier.srcEnd) return null
  return sourceOffset
}

function collectSourceElements(rootEl: HTMLElement): SourceElementRange[] {
  const candidates: SourceElementRange[] = []
  const selector = '[data-src-start][data-src-end]'

  const rootRange = parseSourceElement(rootEl)
  if (rootRange && rootEl.querySelectorAll(selector).length === 0) candidates.push(rootRange)

  for (const el of rootEl.querySelectorAll<HTMLElement>(selector)) {
    if (el.querySelectorAll(selector).length > 0) continue
    const sourceEl = parseSourceElement(el)
    if (sourceEl) candidates.push(sourceEl)
  }

  return candidates.sort((a, b) => a.srcStart - b.srcStart || a.srcEnd - b.srcEnd)
}

function locateRenderedOffset(el: HTMLElement, target: number): BoundaryLocation | null {
  if (target < 0 || target > textLength(el)) return null

  const textNodes: Text[] = []
  const collect = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text)
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) collect(node.childNodes[i]!)
    }
  }
  collect(el)

  let remaining = target
  for (const textNode of textNodes) {
    const len = textLength(textNode)
    if (remaining <= len) return { node: textNode, offset: remaining }
    remaining -= len
  }

  if (target === 0) return { node: el, offset: 0 }
  const last = textNodes[textNodes.length - 1]
  return last ? { node: last, offset: textLength(last) } : null
}

/**
 * Convert a DOM selection range into an absolute source-range Anchor.
 */
export function domSelectionToSourceAnchor(range: Range): Anchor | null {
  if (range.collapsed) return null

  const start = sourceOffsetForBoundary(range.startContainer, range.startOffset)
  const end = sourceOffsetForBoundary(range.endContainer, range.endOffset)
  if (start == null || end == null || start === end) return null

  const srcStart = Math.min(start, end)
  const srcEnd = Math.max(start, end)
  const text = range.toString()
  if (!text) return null

  return { srcStart, srcEnd, text }
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

/**
 * Convert a DOM selection into a source-range Anchor, clipped to `rootEl`.
 *
 * Fast drag gestures may release outside the reader, leaving one selection
 * boundary outside the source-bearing DOM. In that case, keep the precise
 * boundary that is still inside `rootEl` and clamp the outside edge to the
 * first/last intersected source element.
 */
export function domSelectionToSourceAnchorInRoot(rootEl: HTMLElement, range: Range): Anchor | null {
  if (range.collapsed) return null

  const exact = domSelectionToSourceAnchor(range)
  if (exact) return exact

  const sourceElements = collectSourceElements(rootEl).filter((sourceEl) =>
    rangeIntersectsNode(range, sourceEl.el),
  )
  if (sourceElements.length === 0) return null

  const first = sourceElements[0]!
  const last = sourceElements[sourceElements.length - 1]!
  const start = rootEl.contains(range.startContainer)
    ? sourceOffsetForBoundary(range.startContainer, range.startOffset)
    : null
  const end = rootEl.contains(range.endContainer)
    ? sourceOffsetForBoundary(range.endContainer, range.endOffset)
    : null

  const boundedStart = start ?? first.srcStart
  const boundedEnd = end ?? last.srcEnd
  const srcStart = Math.max(first.srcStart, Math.min(boundedStart, boundedEnd))
  const srcEnd = Math.min(last.srcEnd, Math.max(boundedStart, boundedEnd))
  if (srcEnd <= srcStart) return null

  const location = locateSourceRangeInDom(rootEl, { srcStart, srcEnd, text: '' })
  const text = location?.text || range.toString()
  if (!text.trim()) return null

  return { srcStart, srcEnd, text }
}

/**
 * Locate a source-range Anchor in rendered DOM.
 *
 * Returns null when the range cannot be represented by the currently rendered
 * source-bearing DOM nodes.
 */
export function locateSourceRangeInDom(rootEl: HTMLElement, anchor: Anchor): AnchorLocation | null {
  if (anchor.srcStart < 0 || anchor.srcEnd <= anchor.srcStart) return null

  const sourceElements = collectSourceElements(rootEl).filter(
    (sourceEl) => sourceEl.srcStart < anchor.srcEnd && sourceEl.srcEnd > anchor.srcStart,
  )
  if (sourceElements.length === 0) return null

  const first = sourceElements[0]!
  const last = sourceElements[sourceElements.length - 1]!
  if (anchor.srcStart < first.srcStart || anchor.srcEnd > last.srcEnd) return null

  const start = locateRenderedOffset(first.el, anchor.srcStart - first.srcStart)
  const end = locateRenderedOffset(last.el, anchor.srcEnd - last.srcStart)
  if (!start || !end) return null

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  return {
    root: rootEl,
    elements: sourceElements.map((sourceEl) => sourceEl.el),
    range,
    text: range.toString(),
  }
}

/**
 * Slice the markdown source between offsets and apply light normalization
 * suitable for display.
 */
export function extractTextAtRange(source: string, srcStart: number, srcEnd: number): string {
  if (srcStart < 0 || srcEnd < srcStart || srcEnd > source.length) return ''
  const raw = source.slice(srcStart, srcEnd)
  return raw.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
}
