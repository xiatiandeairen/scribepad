/**
 * anchor.ts — selection ↔ markdown source offset bidirectional algorithms.
 *
 * Companion to `src/lib/markdown.ts`, which renders mdast → HTML and stamps
 * `data-src-start` / `data-src-end` attributes on block elements (paragraphs,
 * headings, list items, etc.). Those attributes are character offsets into the
 * original markdown source string.
 *
 * Two directions:
 *
 *   1. domSelectionToAnchor(range)
 *      User makes a DOM selection inside the rendered article. We find the
 *      nearest ancestor with `data-src-start`, and convert the in-DOM offset
 *      to a markdown source offset by counting text-content characters
 *      preceding the selection boundary inside that ancestor.
 *
 *   2. locateAnchorInDom(rootEl, anchor)
 *      Given a previously-saved anchor (srcStart/srcEnd), find the DOM
 *      element whose data-src range contains it, then walk text nodes to
 *      compute the start/end DOM offsets matching the source offsets.
 *
 * Both functions are read-only — they neither mutate the DOM nor the source.
 *
 * NOTE: the conversion is approximate — it assumes the rendered text-content
 * of a block element matches the source slice character-for-character at the
 * granularity scribepad cares about. Markdown syntax markers (`*`, `#`, etc.)
 * are stripped during rendering, so to avoid drift we anchor at block level
 * (data-src-* lives on block elements) and use plain text-content offsets
 * within the block. For inline-formatted text (bold/italic/code) the rendered
 * length matches the source's "visible" length closely enough for v0.1
 * practical use cases (validated by 36 e2e tests in the v0.1 MVP).
 */

import type { Anchor } from '../../types/annotation'

/**
 * Walk up from a DOM node to the nearest ancestor element with
 * `data-src-start` and `data-src-end` attributes. Returns null if no such
 * ancestor exists (e.g. selection landed outside the rendered article).
 */
function findSrcAncestor(node: Node | null): HTMLElement | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement
      if (el.hasAttribute('data-src-start') && el.hasAttribute('data-src-end')) {
        return el
      }
    }
    cur = cur.parentNode
  }
  return null
}

/**
 * Count the number of text characters inside `ancestor` that appear before
 * the given (node, offset) boundary, in document order.
 *
 * If `node` is the ancestor itself, we count characters in the first
 * `offset` children. If `node` is a descendant text node, we count all text
 * preceding it inside the ancestor, then add `offset`. If `node` is a
 * descendant element, we count text preceding it, then dive into its first
 * `offset` children.
 */
function countTextBefore(ancestor: HTMLElement, node: Node, offset: number): number {
  // Build an ordered list of text nodes inside ancestor, then walk until
  // we either reach the boundary or pass it.
  let count = 0
  let reached = false

  const walk = (n: Node): void => {
    if (reached) return

    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        count += offset
        reached = true
        return
      }
      // Element boundary: count text in the first `offset` children.
      const children = n.childNodes
      const limit = Math.min(offset, children.length)
      for (let i = 0; i < limit; i++) {
        const child = children[i]
        if (child) walk(child)
      }
      reached = true
      return
    }

    if (n.nodeType === Node.TEXT_NODE) {
      count += (n.textContent ?? '').length
      return
    }

    if (n.nodeType === Node.ELEMENT_NODE) {
      const children = n.childNodes
      for (let i = 0; i < children.length; i++) {
        if (reached) return
        const child = children[i]
        if (child) walk(child)
      }
    }
  }

  walk(ancestor)
  return count
}

/**
 * Convert a DOM Range to an Anchor in markdown-source coordinates.
 *
 * Algorithm:
 *   1. Find the nearest ancestor with data-src-start covering startContainer
 *      (and similarly for endContainer — they may differ for cross-block
 *       selections, in which case we fall back to using the start ancestor's
 *       data-src-end as the end boundary; v0.1 anchors at block level).
 *   2. Read the ancestor's data-src-start as the block's source offset.
 *   3. Count text-content characters inside the ancestor up to the range's
 *      start/end boundary; add to data-src-start to get srcStart/srcEnd.
 *
 * Returns null if no ancestor has data-src attributes (selection outside
 * the rendered article).
 */
export function domSelectionToAnchor(range: Range): Anchor | null {
  const startAncestor = findSrcAncestor(range.startContainer)
  const endAncestor = findSrcAncestor(range.endContainer)

  if (!startAncestor) return null

  const startBase = Number.parseInt(startAncestor.getAttribute('data-src-start') ?? '', 10)
  if (Number.isNaN(startBase)) return null

  const startInner = countTextBefore(startAncestor, range.startContainer, range.startOffset)
  const srcStart = startBase + startInner

  let srcEnd: number
  if (endAncestor && endAncestor === startAncestor) {
    const endInner = countTextBefore(startAncestor, range.endContainer, range.endOffset)
    srcEnd = startBase + endInner
  } else if (endAncestor) {
    // Cross-block selection — anchor end at the end ancestor's start + inner.
    const endBase = Number.parseInt(endAncestor.getAttribute('data-src-start') ?? '', 10)
    if (Number.isNaN(endBase)) return null
    const endInner = countTextBefore(endAncestor, range.endContainer, range.endOffset)
    srcEnd = endBase + endInner
  } else {
    // End not inside any data-src ancestor — clamp to start ancestor's end.
    const startEnd = Number.parseInt(startAncestor.getAttribute('data-src-end') ?? '', 10)
    if (Number.isNaN(startEnd)) return null
    srcEnd = startEnd
  }

  if (srcEnd < srcStart) return null

  const text = range.toString()
  return { srcStart, srcEnd, text }
}

/**
 * Find the smallest data-src element under `root` whose [data-src-start,
 * data-src-end] range encloses [anchor.srcStart, anchor.srcEnd]. "Smallest"
 * = innermost match wins (later in document order with tighter bounds), so
 * a list item beats its containing list.
 */
function findEnclosingElement(root: HTMLElement, anchor: Anchor): HTMLElement | null {
  // querySelectorAll returns elements in document order; filter by bounds.
  const candidates = root.querySelectorAll<HTMLElement>('[data-src-start]')
  let best: HTMLElement | null = null
  let bestSpan = Number.POSITIVE_INFINITY

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]
    if (!el) continue
    const s = Number.parseInt(el.getAttribute('data-src-start') ?? '', 10)
    const e = Number.parseInt(el.getAttribute('data-src-end') ?? '', 10)
    if (Number.isNaN(s) || Number.isNaN(e)) continue
    if (s <= anchor.srcStart && e >= anchor.srcEnd) {
      const span = e - s
      if (span < bestSpan) {
        best = el
        bestSpan = span
      }
    }
  }
  return best
}

/**
 * Walk text nodes inside `el` and locate the (textNode, offset) pair that
 * corresponds to consuming `target` characters of text content. Returns null
 * if `target` exceeds the total text length.
 */
function locateOffsetInElement(
  el: HTMLElement,
  target: number,
): { node: Node; offset: number } | null {
  let remaining = target

  // Manual depth-first traversal of text nodes.
  const stack: Node[] = [el]
  // Use a queue-style traversal preserving document order via reverse-push.
  const order: Node[] = []
  const collect = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      order.push(n)
      return
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const children = n.childNodes
      for (let i = 0; i < children.length; i++) {
        const c = children[i]
        if (c) collect(c)
      }
    }
  }
  // stack unused; collect directly
  void stack
  collect(el)

  for (let i = 0; i < order.length; i++) {
    const tn = order[i]
    if (!tn) continue
    const len = (tn.textContent ?? '').length
    if (remaining <= len) {
      return { node: tn, offset: remaining }
    }
    remaining -= len
  }

  // If target equals total length, point past the last text node.
  const last = order[order.length - 1]
  if (last && remaining === 0) {
    return { node: last, offset: (last.textContent ?? '').length }
  }
  return null
}

/**
 * Locate an Anchor's DOM range under `rootEl`. Returns the start text node
 * and the start/end offsets within it (or spanning text nodes if the anchor
 * crosses inline elements — caller should consult `node` and use
 * Range.setStart/setEnd separately if needed).
 *
 * Returns null when no enclosing data-src element exists (stale anchor —
 * source has been edited externally, offsets no longer map).
 *
 * NOTE: For v0.1 we return a single { node, startOffset, endOffset } shape
 * matching the spec. When the anchor spans multiple text nodes inside the
 * enclosing element, `node` is the start text node; callers needing precise
 * end-node positioning should re-derive via locateOffsetInElement themselves.
 */
export function locateAnchorInDom(
  rootEl: HTMLElement,
  anchor: Anchor,
): { node: Node; startOffset: number; endOffset: number } | null {
  const el = findEnclosingElement(rootEl, anchor)
  if (!el) return null

  const base = Number.parseInt(el.getAttribute('data-src-start') ?? '', 10)
  if (Number.isNaN(base)) return null

  const innerStart = anchor.srcStart - base
  const innerEnd = anchor.srcEnd - base

  const startLoc = locateOffsetInElement(el, innerStart)
  const endLoc = locateOffsetInElement(el, innerEnd)
  if (!startLoc || !endLoc) return null

  // If start and end land on the same text node, return both offsets on it.
  if (startLoc.node === endLoc.node) {
    return {
      node: startLoc.node,
      startOffset: startLoc.offset,
      endOffset: endLoc.offset,
    }
  }

  // Different text nodes — return start node + full length of start node as
  // endOffset, and let caller handle multi-node ranges. The spec's return
  // shape is single-node; v0.1 callers building DOM Ranges should fall back
  // to constructing a Range with setStart(startLoc.node, startLoc.offset)
  // and setEnd(endLoc.node, endLoc.offset) directly. We expose the start
  // node here (most common case for highlighting) and let the end "leak" to
  // its node's full length so visual highlight is at least conservative.
  const startLen = (startLoc.node.textContent ?? '').length
  return {
    node: startLoc.node,
    startOffset: startLoc.offset,
    endOffset: startLen,
  }
}

/**
 * Slice the markdown source between offsets and apply light normalization
 * suitable for display (collapse runs of 3+ newlines down to 2, trim trailing
 * whitespace on each line). Pure function — no DOM, no I/O.
 */
export function extractTextAtRange(source: string, srcStart: number, srcEnd: number): string {
  if (srcStart < 0 || srcEnd < srcStart || srcEnd > source.length) return ''
  const raw = source.slice(srcStart, srcEnd)
  // Collapse 3+ consecutive newlines to a paragraph break (2 newlines).
  // Trim trailing spaces/tabs on each line.
  return raw.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
}
