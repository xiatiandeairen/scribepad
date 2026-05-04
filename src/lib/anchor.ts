/**
 * anchor.ts — selection ↔ block-scoped sentence anchor.
 *
 * Bidirectional:
 *
 *   1. domSelectionToAnchor(range)
 *      User makes a DOM selection inside the rendered article. We require
 *      both endpoints to land inside `[data-sentence-idx]` spans within the
 *      same `[data-block-id]` block. Cross-block selections return null.
 *      Same-sentence selections produce a sub-sentence anchor with
 *      charStart/charEnd; cross-sentence selections snap to whole
 *      sentence boundaries (charStart/charEnd undefined).
 *
 *   2. locateAnchorInDom(rootEl, anchor)
 *      Given a stored Anchor, find the block element and the contiguous
 *      sentence spans it covers. For sub-sentence anchors we additionally
 *      construct a DOM Range for the in-sentence char span.
 *
 * Both functions are read-only — they neither mutate the DOM nor the source.
 */

import type { Anchor, Annotation } from '../../types/annotation'

/**
 * AnchorLocation — what locateAnchorInDom returns when an anchor is alive.
 *
 * `sentences` is contiguous, ordered ascending by sentence-idx, length ≥ 1.
 * `subRange` is set only when the anchor is sub-sentence (charStart/charEnd
 * present and start === end); it carries the in-sentence char span as a
 * native DOM Range that callers can wrap with `<mark>` directly.
 */
export interface AnchorLocation {
  block: HTMLElement
  sentences: HTMLElement[]
  subRange?: Range
}

const isBlockEl = (el: Element): boolean => el.hasAttribute('data-block-id')
const isSentenceEl = (el: Element): boolean => el.hasAttribute('data-sentence-idx')

/** Walk up from `node` until an element matching `predicate` is found. */
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

/**
 * Count plain-text characters inside `root` that appear before the
 * (boundaryNode, boundaryOffset) DOM-Range boundary, in document order.
 *
 * If `boundaryNode` is a text node, we count `boundaryOffset` chars of it.
 * If it's an element, we count text in its first `boundaryOffset` children.
 */
function charsBeforeBoundary(
  root: HTMLElement,
  boundaryNode: Node,
  boundaryOffset: number,
): number {
  let count = 0
  let done = false

  const walk = (n: Node): void => {
    if (done) return

    if (n === boundaryNode) {
      if (n.nodeType === Node.TEXT_NODE) {
        count += boundaryOffset
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const kids = n.childNodes
        const limit = Math.min(boundaryOffset, kids.length)
        for (let i = 0; i < limit; i++) walk(kids[i]!)
      }
      done = true
      return
    }

    if (n.nodeType === Node.TEXT_NODE) {
      count += (n.textContent ?? '').length
      return
    }

    if (n.nodeType === Node.ELEMENT_NODE) {
      const kids = n.childNodes
      for (let i = 0; i < kids.length; i++) {
        if (done) return
        walk(kids[i]!)
      }
    }
  }

  walk(root)
  return count
}

/**
 * Locate the (textNode, offset) inside `el` that corresponds to consuming
 * `target` characters of plain text content. Returns null when `target`
 * exceeds the element's total text length.
 */
function locateCharOffset(el: HTMLElement, target: number): { node: Node; offset: number } | null {
  const textNodes: Text[] = []
  const collect = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      textNodes.push(n as Text)
      return
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < n.childNodes.length; i++) collect(n.childNodes[i]!)
    }
  }
  collect(el)

  let remaining = target
  for (const tn of textNodes) {
    const len = (tn.textContent ?? '').length
    if (remaining <= len) return { node: tn, offset: remaining }
    remaining -= len
  }
  // target equals total length → point past the last text node
  const last = textNodes[textNodes.length - 1]
  if (last && remaining === 0) return { node: last, offset: (last.textContent ?? '').length }
  return null
}

/**
 * CSS.escape with safe fallback for environments lacking the API.
 *
 * Used to embed anchor.blockId in a querySelector — block ids are
 * `b-{number}` so escaping is mostly defensive.
 */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)
}

/**
 * Convert a DOM Range to a block-scoped sentence Anchor.
 *
 * Returns null when:
 *   - either endpoint lies outside any `[data-block-id]` block
 *   - the two endpoints lie in different blocks (cross-block forbidden)
 *   - either endpoint is in inter-sentence whitespace (no sentence span)
 *   - the range is collapsed within a single sentence (zero-width phrase)
 *
 * When start and end land in the same sentence span, returns a sub-sentence
 * anchor with `charStart/charEnd` set. Otherwise returns a multi-sentence
 * anchor whose `[startSentenceIdx, endSentenceIdx]` covers all sentences
 * touched by the original range — equivalent to auto-snapping the visual
 * selection out to whole-sentence boundaries.
 */
export function domSelectionToAnchor(range: Range): Anchor | null {
  const startBlock = findClosestAncestor(range.startContainer, isBlockEl)
  const endBlock = findClosestAncestor(range.endContainer, isBlockEl)
  if (!startBlock || !endBlock || startBlock !== endBlock) return null

  const blockId = startBlock.getAttribute('data-block-id')
  if (!blockId) return null

  const startSentence = findClosestAncestor(range.startContainer, isSentenceEl)
  const endSentence = findClosestAncestor(range.endContainer, isSentenceEl)
  if (!startSentence || !endSentence) return null
  // Both sentences must be within the same block (defensive — sentence spans
  // are only emitted inside blocks, but covers nested-edge weirdness).
  if (!startBlock.contains(startSentence) || !startBlock.contains(endSentence)) return null

  const startIdx = Number.parseInt(startSentence.getAttribute('data-sentence-idx') ?? '', 10)
  const endIdx = Number.parseInt(endSentence.getAttribute('data-sentence-idx') ?? '', 10)
  if (Number.isNaN(startIdx) || Number.isNaN(endIdx)) return null

  // Phrase mode — same sentence span.
  if (startIdx === endIdx && startSentence === endSentence) {
    const charStart = charsBeforeBoundary(startSentence, range.startContainer, range.startOffset)
    const charEnd = charsBeforeBoundary(startSentence, range.endContainer, range.endOffset)
    if (charEnd <= charStart) return null
    return {
      blockId,
      startSentenceIdx: startIdx,
      endSentenceIdx: endIdx,
      charStart,
      charEnd,
      text: range.toString(),
    }
  }

  // Multi-sentence — snap to whole sentences. Order endpoints in case the
  // user dragged backward.
  const lo = Math.min(startIdx, endIdx)
  const hi = Math.max(startIdx, endIdx)
  let text = ''
  const allSentences = startBlock.querySelectorAll<HTMLElement>('[data-sentence-idx]')
  allSentences.forEach((s) => {
    const idx = Number.parseInt(s.getAttribute('data-sentence-idx') ?? '', 10)
    if (Number.isNaN(idx)) return
    if (idx >= lo && idx <= hi) text += s.textContent ?? ''
  })

  return {
    blockId,
    startSentenceIdx: lo,
    endSentenceIdx: hi,
    text,
  }
}

/**
 * Find the DOM elements (and optional sub-range) the anchor refers to.
 *
 * Returns null when the named block no longer exists or none of the
 * referenced sentence indices are present (source drift).
 */
export function locateAnchorInDom(rootEl: HTMLElement, anchor: Anchor): AnchorLocation | null {
  const block = rootEl.querySelector<HTMLElement>(`[data-block-id="${cssEscape(anchor.blockId)}"]`)
  if (!block) return null

  const sentences: HTMLElement[] = []
  const allSentences = block.querySelectorAll<HTMLElement>('[data-sentence-idx]')
  allSentences.forEach((s) => {
    const idx = Number.parseInt(s.getAttribute('data-sentence-idx') ?? '', 10)
    if (Number.isNaN(idx)) return
    if (idx >= anchor.startSentenceIdx && idx <= anchor.endSentenceIdx) {
      sentences.push(s)
    }
  })
  if (sentences.length === 0) return null

  // Sub-sentence: construct DOM Range for the in-sentence char span.
  if (
    anchor.startSentenceIdx === anchor.endSentenceIdx &&
    anchor.charStart != null &&
    anchor.charEnd != null
  ) {
    const span = sentences[0]!
    const startLoc = locateCharOffset(span, anchor.charStart)
    const endLoc = locateCharOffset(span, anchor.charEnd)
    if (startLoc && endLoc) {
      const subRange = document.createRange()
      subRange.setStart(startLoc.node, startLoc.offset)
      subRange.setEnd(endLoc.node, endLoc.offset)
      return { block, sentences, subRange }
    }
    // Char offsets out of bounds — fall back to whole-sentence highlight.
  }

  return { block, sentences }
}

/**
 * Resolve an Anchor to a `[srcStart, srcEnd]` source-character range so the
 * caller can splice the markdown source.
 *
 * Strategy:
 *   - whole-sentence (or sub-sentence on a span containing inline elements):
 *     use `[firstSentence.data-src-start, lastSentence.data-src-end]` directly
 *   - sub-sentence on a plain-text span (no `<strong>` / `<em>` / etc.):
 *     refine to `[srcStart + charStart, srcStart + charEnd]` since rendered
 *     text positions equal source positions for plain text
 *
 * Returns null when the anchor's block or sentence span(s) are not found in
 * `rootEl` (source has drifted since the anchor was created).
 */
export function resolveAnchorToSourceRange(
  rootEl: HTMLElement,
  anchor: Anchor,
): [number, number] | null {
  const block = rootEl.querySelector<HTMLElement>(`[data-block-id="${cssEscape(anchor.blockId)}"]`)
  if (!block) return null

  const allSentences = block.querySelectorAll<HTMLElement>('[data-sentence-idx]')
  let startSpan: HTMLElement | null = null
  let endSpan: HTMLElement | null = null
  allSentences.forEach((s) => {
    const idx = Number.parseInt(s.getAttribute('data-sentence-idx') ?? '', 10)
    if (Number.isNaN(idx)) return
    if (idx === anchor.startSentenceIdx) startSpan = s
    if (idx === anchor.endSentenceIdx) endSpan = s
  })
  if (!startSpan || !endSpan) return null
  // Local aliases — TS narrows now that we've null-checked above.
  const startEl: HTMLElement = startSpan
  const endEl: HTMLElement = endSpan

  const startSrc = Number.parseInt(startEl.getAttribute('data-src-start') ?? '', 10)
  const endSrc = Number.parseInt(endEl.getAttribute('data-src-end') ?? '', 10)
  if (Number.isNaN(startSrc) || Number.isNaN(endSrc)) return null

  // Sub-sentence with plain text: refine to char-precise splice.
  const isSubSentence =
    anchor.startSentenceIdx === anchor.endSentenceIdx &&
    anchor.charStart != null &&
    anchor.charEnd != null
  const isPlain = startEl.getAttribute('data-plain') === '1'

  if (isSubSentence && isPlain) {
    const charStart = anchor.charStart!
    const charEnd = anchor.charEnd!
    const refinedStart = startSrc + charStart
    const refinedEnd = startSrc + charEnd
    if (refinedStart >= startSrc && refinedEnd <= endSrc && refinedStart < refinedEnd) {
      return [refinedStart, refinedEnd]
    }
  }

  // Whole-sentence range, or sub-sentence on a complex span (degrade to
  // splicing the whole sentence — preserves markdown markers, AI rewrites
  // the full sentence).
  return [startSrc, endSrc]
}

interface AnchorCandidate {
  anchor: Anchor
  srcStart: number
  key: string
}

function sentenceText(el: HTMLElement): string {
  return el.textContent ?? ''
}

function sentenceSrcStart(el: HTMLElement): number | null {
  const raw = Number.parseInt(el.getAttribute('data-src-start') ?? '', 10)
  return Number.isNaN(raw) ? null : raw
}

function getBlockSentences(block: HTMLElement): HTMLElement[] {
  return Array.from(block.querySelectorAll<HTMLElement>('[data-sentence-idx]'))
}

function buildAnchorCandidates(rootEl: HTMLElement, target: Anchor): AnchorCandidate[] {
  const blocks = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-block-id]'))
  const targetText = target.text
  const out: AnchorCandidate[] = []

  const isSubSentence =
    target.startSentenceIdx === target.endSentenceIdx &&
    target.charStart != null &&
    target.charEnd != null

  for (const block of blocks) {
    const blockId = block.getAttribute('data-block-id')
    if (!blockId) continue
    const sentences = getBlockSentences(block)

    if (isSubSentence) {
      for (const span of sentences) {
        const text = sentenceText(span)
        if (!text) continue
        let from = 0
        while (from <= text.length) {
          const idx = text.indexOf(targetText, from)
          if (idx < 0) break
          const sentenceIdx = Number.parseInt(span.getAttribute('data-sentence-idx') ?? '', 10)
          const srcStart = sentenceSrcStart(span)
          if (!Number.isNaN(sentenceIdx) && srcStart != null) {
            const anchor: Anchor = {
              blockId,
              startSentenceIdx: sentenceIdx,
              endSentenceIdx: sentenceIdx,
              charStart: idx,
              charEnd: idx + targetText.length,
              text: targetText,
            }
            out.push({
              anchor,
              srcStart: srcStart + idx,
              key: `${blockId}:${sentenceIdx}:${idx}:${idx + targetText.length}`,
            })
          }
          from = idx + 1
        }
      }
      continue
    }

    for (let start = 0; start < sentences.length; start++) {
      let combined = ''
      for (let end = start; end < sentences.length; end++) {
        combined += sentenceText(sentences[end]!)
        if (!targetText.startsWith(combined)) break
        if (combined !== targetText) continue

        const startIdx = Number.parseInt(
          sentences[start]!.getAttribute('data-sentence-idx') ?? '',
          10,
        )
        const endIdx = Number.parseInt(sentences[end]!.getAttribute('data-sentence-idx') ?? '', 10)
        const srcStart = sentenceSrcStart(sentences[start]!)
        if (Number.isNaN(startIdx) || Number.isNaN(endIdx) || srcStart == null) continue
        out.push({
          anchor: {
            blockId,
            startSentenceIdx: startIdx,
            endSentenceIdx: endIdx,
            text: targetText,
          },
          srcStart,
          key: `${blockId}:${startIdx}:${endIdx}`,
        })
        break
      }
    }
  }

  return out
}

function chooseNearestCandidate(
  candidates: AnchorCandidate[],
  expectedStart: number,
  usedKeys: Set<string>,
): Anchor | null {
  let best: AnchorCandidate | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (usedKeys.has(candidate.key)) continue
    const distance = Math.abs(candidate.srcStart - expectedStart)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  if (!best) return null
  usedKeys.add(best.key)
  return best.anchor
}

/**
 * Re-anchor surviving annotations after a source rewrite.
 *
 * The rewritten annotation itself is left untouched by this helper; callers
 * typically mark it `status='applied'` and hide it from the live UI. For all
 * other open annotations we try to find the same visible `anchor.text` in the
 * freshly-rendered document and migrate `blockId` / sentence indexes to the
 * nearest source position after applying the rewrite delta.
 */
export function remapAnchorsAfterRewrite(
  oldRootEl: HTMLElement,
  newRootEl: HTMLElement,
  annotations: Annotation[],
  rewrittenId: string,
  rewrittenRange: [number, number],
  replacement: string,
): Annotation[] {
  const [rewriteStart, rewriteEnd] = rewrittenRange
  const delta = replacement.length - (rewriteEnd - rewriteStart)
  const usedKeys = new Set<string>()

  return annotations.map((anno) => {
    if (anno.id === rewrittenId || anno.status !== 'open') return anno

    const oldRange = resolveAnchorToSourceRange(oldRootEl, anno.anchor)
    if (!oldRange) return anno

    const [oldStart, oldEnd] = oldRange
    if (oldEnd <= rewriteStart) return anno

    const expectedStart = oldStart >= rewriteEnd ? oldStart + delta : oldStart
    const nextAnchor = chooseNearestCandidate(
      buildAnchorCandidates(newRootEl, anno.anchor),
      expectedStart,
      usedKeys,
    )

    return nextAnchor ? { ...anno, anchor: nextAnchor } : anno
  })
}

/**
 * Slice the markdown source between offsets and apply light normalization
 * suitable for display (collapse runs of 3+ newlines down to 2, trim trailing
 * whitespace on each line). Pure function — no DOM, no I/O.
 *
 * Kept for callers that still need raw source slicing during the v0.2
 * transition; sentence-level anchors do their own slicing in P3/P4.
 */
export function extractTextAtRange(source: string, srcStart: number, srcEnd: number): string {
  if (srcStart < 0 || srcEnd < srcStart || srcEnd > source.length) return ''
  const raw = source.slice(srcStart, srcEnd)
  return raw.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
}
