/**
 * Reader — markdown article view with sentence-level interaction.
 *
 * Two-pass render — React owns the article HTML; an effect overlays marks:
 *
 *   1. dangerouslySetInnerHTML installs the rendered markdown (output of
 *      lib/markdown.ts) — paragraphs/headings/code carry `data-block-id`,
 *      every sentence is wrapped in `<span data-sentence-idx>` with source
 *      offsets.
 *   2. A useEffect resets innerHTML to the clean base, then walks each
 *      open annotation: locates source-coordinate DOM ranges via
 *      locateSourceRangeInDom and overlays `<mark>` elements. A single
 *      annotation can produce multiple marks when the source range crosses
 *      paragraphs/list items.
 *
 * Two interaction paths feed the parent App:
 *
 *   - hover:    pure CSS affordance — sentence span shows an annotation hint.
 *   - click:    click a bare sentence span → create a whole-sentence draft.
 *   - drag:     non-collapsed selection → pointerup commits the exact
 *               selected source range as a draft.
 *   - mark:     click inside an existing `<mark data-anno-id>` →
 *               onMarkClick(id) so App can activate / open modal.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Annotation, AnnotationState, Anchor } from '../../types/annotation'
import type { PlanItem } from '../../types/plan'
import { renderMarkdown } from '../lib/markdown'
import {
  domSelectionToSourceAnchorInRoot,
  domSelectionToSourceAnchor,
  locateSourceRangeInDom,
  type AnchorLocation,
} from '../lib/anchor'

export interface ReaderProps {
  content: string
  annotations: Annotation[]
  planItems?: PlanItem[]
  activeId?: string | undefined
  highlightedPlanItemId?: string | undefined
  /** Drag-select reported a fresh anchor (or null when selection cleared). */
  onSelectionAnchor: (anchor: Anchor | null) => void
  /** Click landed on a bare sentence span. */
  onCreateAnchor: (anchor: Anchor) => void
  /** Click landed inside a `<mark data-anno-id>`. */
  onMarkClick: (id: string) => void
  /** Click landed on a plan status rail marker. */
  onPlanItemClick?: (id: string) => void
}

/**
 * Map persistent annotation state → mark visual variant. `discussed` splits
 * into thinking (no AI yet) vs deciding (AI returned). Mirrors Sidebar so a
 * card and its mark always share a class.
 */
function pickVariant(state: AnnotationState, aiSuggestion: string | null): string {
  switch (state) {
    case 'draft':
      return 'draft'
    case 'discussed':
      return aiSuggestion ? 'deciding' : 'thinking'
    case 'decided':
      return 'decided'
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function markClassFor(anno: Annotation, isActive: boolean): string {
  const variant = pickVariant(anno.state, anno.ai_suggestion ?? null)
  return `anno ${variant}${isActive ? ' active' : ''}`
}

function parseSourceAttrs(el: HTMLElement): { start: number; end: number } | null {
  const start = Number.parseInt(el.getAttribute('data-src-start') ?? '', 10)
  const end = Number.parseInt(el.getAttribute('data-src-end') ?? '', 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

function locateCharOffset(el: HTMLElement, target: number): { node: Node; offset: number } | null {
  const textNodes: Text[] = []
  const collect = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text)
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let index = 0; index < node.childNodes.length; index++) collect(node.childNodes[index]!)
    }
  }
  collect(el)

  let remaining = target
  for (const textNode of textNodes) {
    const length = (textNode.textContent ?? '').length
    if (remaining <= length) return { node: textNode, offset: remaining }
    remaining -= length
  }

  const last = textNodes[textNodes.length - 1]
  if (last && remaining === 0) return { node: last, offset: (last.textContent ?? '').length }
  return null
}

function rangesFromLocation(location: AnchorLocation, anchor: Anchor): Range[] {
  return location.elements.flatMap((element) => {
    const source = parseSourceAttrs(element)
    if (!source) return []
    const start = Math.max(anchor.srcStart, source.start)
    const end = Math.min(anchor.srcEnd, source.end)
    if (end <= start) return []

    const range = document.createRange()
    if (start === source.start && end === source.end) {
      range.selectNodeContents(element)
      return [range]
    }

    const startLoc = locateCharOffset(element, start - source.start)
    const endLoc = locateCharOffset(element, end - source.start)
    if (!startLoc || !endLoc) return []
    range.setStart(startLoc.node, startLoc.offset)
    range.setEnd(endLoc.node, endLoc.offset)
    return [range]
  })
}

function sentenceElementsForRange(rootEl: HTMLElement, range: Range): HTMLElement[] {
  const sentences = rootEl.querySelectorAll<HTMLElement>('[data-sentence-idx]')
  return Array.from(sentences).filter((sentence) => range.intersectsNode(sentence))
}

function wrapRangeWithMark(range: Range, className: string, annotationId: string): boolean {
  if (range.collapsed) return false
  const mark = document.createElement('mark')
  mark.className = className
  mark.setAttribute('data-anno-id', annotationId)

  try {
    range.surroundContents(mark)
  } catch {
    try {
      const fragment = range.extractContents()
      mark.appendChild(fragment)
      range.insertNode(mark)
    } catch {
      return false
    }
  }
  return true
}

function compareRangesDescending(a: Range, b: Range): number {
  return b.compareBoundaryPoints(Range.START_TO_START, a)
}

interface SelectionGesture {
  pointerId: number
  startX: number
  startY: number
  lastReaderX: number
  lastReaderY: number
  endedOutsideReader: boolean
}

const DRAG_THRESHOLD_PX = 4
const MAX_SELECTION_COMMIT_ATTEMPTS = 2

function caretRangeFromPoint(x: number, y: number): Range | null {
  const docWithCaretRange = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  const range = docWithCaretRange.caretRangeFromPoint?.(x, y)
  if (range) return range

  const position = docWithCaretRange.caretPositionFromPoint?.(x, y)
  if (!position) return null

  const fallbackRange = document.createRange()
  fallbackRange.setStart(position.offsetNode, position.offset)
  fallbackRange.collapse(true)
  return fallbackRange
}

function orderedRangeFromPoints(gesture: SelectionGesture): Range | null {
  const start = caretRangeFromPoint(gesture.startX, gesture.startY)
  const end = caretRangeFromPoint(gesture.lastReaderX, gesture.lastReaderY)
  if (!start || !end) return null

  const range = document.createRange()
  const startsAfterEnd = start.compareBoundaryPoints(Range.START_TO_START, end) > 0

  if (startsAfterEnd) {
    range.setStart(end.startContainer, end.startOffset)
    range.setEnd(start.startContainer, start.startOffset)
  } else {
    range.setStart(start.startContainer, start.startOffset)
    range.setEnd(end.startContainer, end.startOffset)
  }

  return range.collapsed ? null : range
}

export function Reader(props: ReaderProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [railRanges, setRailRanges] = useState<PlanRailRange[]>([])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const selectionGestureRef = useRef<SelectionGesture | null>(null)
  const pendingSelectionCommitRef = useRef<number | null>(null)
  // Cache the renderMarkdown output so we can restore the unmarked HTML
  // before each decoration pass — re-running renderMarkdown on every effect
  // would work but wastes parsing cycles for typical doc sizes.
  const baseHtmlRef = useRef<string>('')

  // Latest callbacks pinned to refs so the long-lived selectionchange
  // listener doesn't need to re-subscribe on every parent re-render.
  const onSelectionAnchorRef = useRef(props.onSelectionAnchor)
  const onCreateAnchorRef = useRef(props.onCreateAnchor)
  const onMarkClickRef = useRef(props.onMarkClick)
  const onPlanItemClickRef = useRef(props.onPlanItemClick)
  useEffect(() => {
    onSelectionAnchorRef.current = props.onSelectionAnchor
  }, [props.onSelectionAnchor])
  useEffect(() => {
    onCreateAnchorRef.current = props.onCreateAnchor
  }, [props.onCreateAnchor])
  useEffect(() => {
    onMarkClickRef.current = props.onMarkClick
  }, [props.onMarkClick])
  useEffect(() => {
    onPlanItemClickRef.current = props.onPlanItemClick
  }, [props.onPlanItemClick])

  useEffect(() => {
    return () => {
      if (pendingSelectionCommitRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionCommitRef.current)
        pendingSelectionCommitRef.current = null
      }
    }
  }, [])

  const baseHtml = renderMarkdown(props.content)
  baseHtmlRef.current = baseHtml

  // ── Mark overlay pass ──────────────────────────────────────────────────
  // Reset to clean base HTML each pass, then re-apply marks. Idempotent —
  // running this multiple times produces the same DOM.
  useLayoutEffect(() => {
    const root = rootRef.current
    const frame = frameRef.current
    if (!root || !frame) return

    if (root.innerHTML !== baseHtmlRef.current) {
      root.innerHTML = baseHtmlRef.current
    }

    const visible = props.annotations.filter((a) => a.status === 'open')

    for (const anno of visible) {
      const location = locateSourceRangeInDom(root, anno.anchor)
      const ranges = location ? rangesFromLocation(location, anno.anchor) : []
      if (ranges.length === 0) continue
      const cls = markClassFor(anno, props.activeId === anno.id)

      for (const range of [...ranges].sort(compareRangesDescending)) {
        const coveredSentences = sentenceElementsForRange(root, range)
        for (const sentence of coveredSentences) sentence.setAttribute('data-anno-covered', anno.id)
        wrapRangeWithMark(range, cls, anno.id)
      }
    }

    for (const block of root.querySelectorAll<HTMLElement>('.plan-block, .plan-block-hover')) {
      block.classList.remove('plan-block', 'plan-block-hover')
      block.removeAttribute('data-plan-item-id')
      block.removeAttribute('data-plan-kind')
      block.removeAttribute('data-plan-status')
    }

    const nextRailRanges: PlanRailRange[] = []
    const frameRect = frame.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const railX =
      rootRect.left -
      frameRect.left +
      Number.parseFloat(window.getComputedStyle(root).paddingLeft) -
      22

    for (const item of props.planItems ?? []) {
      const blocks = blocksForPlanItem(root, item)
      const firstBlock = blocks[0]
      const lastBlock = blocks[blocks.length - 1]
      if (!firstBlock || !lastBlock) continue

      firstBlock.setAttribute('data-plan-item-id', item.id)
      for (const block of blocks) {
        block.classList.add('plan-block')
        if (props.highlightedPlanItemId === item.id) block.classList.add('plan-block-hover')
        block.setAttribute('data-plan-kind', item.kind)
        block.setAttribute('data-plan-status', item.status)
      }

      const firstRect = firstBlock.getBoundingClientRect()
      const lastRect = lastBlock.getBoundingClientRect()
      nextRailRanges.push({
        id: item.id,
        kind: item.kind,
        status: item.status,
        label: planMarkerText(item),
        ariaLabel: `${item.title}: ${item.text}`,
        active: props.highlightedPlanItemId === item.id,
        top: Math.max(0, firstRect.top - frameRect.top),
        height: Math.max(22, lastRect.bottom - firstRect.top),
        lineLeft: railX,
        labelLeft: railX - 94,
      })
    }
    setRailRanges(nextRailRanges)
  }, [
    baseHtml,
    props.annotations,
    props.activeId,
    props.planItems,
    props.highlightedPlanItemId,
    layoutVersion,
  ])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const requestMeasure = (): void => setLayoutVersion((version) => version + 1)
    const observer = new ResizeObserver(requestMeasure)
    observer.observe(root)
    window.addEventListener('resize', requestMeasure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', requestMeasure)
    }
  }, [])

  // ── selectionchange: report exact source-coordinate selection ──────────
  useEffect(() => {
    let timer: number | null = null

    const handle = (): void => {
      const root = rootRef.current
      if (!root) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        onSelectionAnchorRef.current(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        onSelectionAnchorRef.current(null)
        return
      }

      onSelectionAnchorRef.current(domSelectionToSourceAnchor(range))
    }

    const onSelectionChange = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(handle, 50)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  // ── Click delegation: mark / bare sentence ─────────────────────────────
  // Walk up from event target collecting the first mark ancestor we
  // encounter, then dispatch mark hit → onMarkClick(existing annotation).
  // Bare sentence clicks create a whole-sentence draft. If there is a live
  // text selection, drag-select owns the flow and the popover remains visible.
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    let el: HTMLElement | null = e.target as HTMLElement
    let markEl: HTMLElement | null = null
    let sentenceEl: HTMLElement | null = null

    while (el && el !== e.currentTarget) {
      if (el.hasAttribute('data-plan-rail-id')) {
        const id = el.getAttribute('data-plan-rail-id')
        if (id) onPlanItemClickRef.current?.(id)
        return
      }
      if (!markEl && el.tagName === 'MARK' && el.hasAttribute('data-anno-id')) {
        markEl = el
      }
      if (!sentenceEl && el.hasAttribute('data-sentence-idx')) {
        sentenceEl = el
      }
      el = el.parentElement
    }

    if (markEl) {
      const id = markEl.getAttribute('data-anno-id')
      if (id) onMarkClickRef.current(id)
      return
    }

    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    if (!sentenceEl || sentenceEl.hasAttribute('data-anno-covered')) return

    const source = parseSourceAttrs(sentenceEl)
    const text = sentenceEl.textContent ?? ''
    if (!source || !text.trim()) return

    onCreateAnchorRef.current({ srcStart: source.start, srcEnd: source.end, text })
  }

  const commitSelectionAfterPointer = (gesture: SelectionGesture, attempt = 1): void => {
    const root = rootRef.current
    if (!root) {
      pendingSelectionCommitRef.current = null
      return
    }

    const pointRange = gesture.endedOutsideReader ? orderedRangeFromPoints(gesture) : null
    const sel = window.getSelection()
    const selectedRange = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null

    if (!pointRange && !selectedRange) {
      if (attempt < MAX_SELECTION_COMMIT_ATTEMPTS) {
        pendingSelectionCommitRef.current = window.requestAnimationFrame(() =>
          commitSelectionAfterPointer(gesture, attempt + 1),
        )
        return
      }
      pendingSelectionCommitRef.current = null
      return
    }

    const range = pointRange ?? selectedRange
    if (!range) {
      pendingSelectionCommitRef.current = null
      return
    }

    const anchor = domSelectionToSourceAnchorInRoot(root, range)
    if (!anchor) {
      if (attempt < MAX_SELECTION_COMMIT_ATTEMPTS) {
        pendingSelectionCommitRef.current = window.requestAnimationFrame(() =>
          commitSelectionAfterPointer(gesture, attempt + 1),
        )
        return
      }
      pendingSelectionCommitRef.current = null
      return
    }

    onCreateAnchorRef.current(anchor)
    onSelectionAnchorRef.current(null)
    sel?.removeAllRanges()
    pendingSelectionCommitRef.current = null
  }

  const scheduleSelectionCommit = (gesture: SelectionGesture): void => {
    if (pendingSelectionCommitRef.current !== null) return
    pendingSelectionCommitRef.current = window.requestAnimationFrame(() =>
      commitSelectionAfterPointer(gesture, 1),
    )
  }

  // ── Drag-select commit ─────────────────────────────────────────────────
  // A drag selection starts inside the reader but may end outside it when the
  // user moves quickly. Track the gesture from reader pointerdown and finish
  // it from a document-level pointerup after the browser stabilizes selection.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return

    let el: HTMLElement | null = e.target as HTMLElement
    while (el && el !== e.currentTarget) {
      if (el.tagName === 'MARK' && el.hasAttribute('data-anno-id')) {
        selectionGestureRef.current = null
        return
      }
      el = el.parentElement
    }

    selectionGestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastReaderX: e.clientX,
      lastReaderY: e.clientY,
      endedOutsideReader: false,
    }
  }

  useEffect(() => {
    const onDocumentPointerMove = (event: PointerEvent): void => {
      const gesture = selectionGestureRef.current
      const root = rootRef.current
      if (!gesture || !root || event.pointerId !== gesture.pointerId) return

      const hit = document.elementFromPoint(event.clientX, event.clientY)
      if (!hit || !root.contains(hit)) return

      gesture.lastReaderX = event.clientX
      gesture.lastReaderY = event.clientY
    }

    const onDocumentPointerUp = (event: PointerEvent): void => {
      const gesture = selectionGestureRef.current
      const root = rootRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      selectionGestureRef.current = null

      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return

      const hit = document.elementFromPoint(event.clientX, event.clientY)
      gesture.endedOutsideReader = !root || !hit || !root.contains(hit)
      scheduleSelectionCommit(gesture)
    }

    document.addEventListener('pointermove', onDocumentPointerMove, true)
    document.addEventListener('pointerup', onDocumentPointerUp, true)
    return () => {
      document.removeEventListener('pointermove', onDocumentPointerMove, true)
      document.removeEventListener('pointerup', onDocumentPointerUp, true)
    }
  }, [])

  return (
    <div
      ref={frameRef}
      className="reader-frame"
      style={{ '--plan-rail-count': railRanges.length } as CSSProperties}
    >
      <div className="plan-rail-overlay" aria-label="Review checkpoints">
        {railRanges.map((range) => (
          <button
            key={range.id}
            type="button"
            className={`plan-rail-marker ${range.kind} ${range.status} ${range.active ? 'active' : ''}`}
            data-plan-rail-id={range.id}
            aria-label={range.ariaLabel}
            style={
              {
                '--plan-rail-top': `${range.top}px`,
                '--plan-rail-height': `${range.height}px`,
                '--plan-line-left': `${range.lineLeft}px`,
                '--plan-marker-left': `${range.labelLeft}px`,
              } as CSSProperties
            }
            onClick={() => onPlanItemClickRef.current?.(range.id)}
          >
            <span className="plan-rail-label">{range.label}</span>
            <span className="plan-rail-line" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        ref={rootRef}
        className="reader"
        onClick={onClick}
        onPointerDown={onPointerDown}
        // Initial paint installs the rendered markdown; the effect above
        // overlays marks idempotently on subsequent renders.
        dangerouslySetInnerHTML={{ __html: baseHtml }}
      />
    </div>
  )
}

interface PlanRailRange {
  id: string
  kind: PlanItem['kind']
  status: PlanItem['status']
  label: string
  ariaLabel: string
  active: boolean
  top: number
  height: number
  lineLeft: number
  labelLeft: number
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}

function blocksForPlanItem(root: HTMLElement, item: PlanItem): HTMLElement[] {
  const blocks = [
    ...root.querySelectorAll<HTMLElement>('[data-block-id][data-src-start][data-src-end]'),
  ].filter((block) => {
    const start = Number(block.dataset.srcStart)
    const end = Number(block.dataset.srcEnd)
    return (
      Number.isFinite(start) && Number.isFinite(end) && start < item.srcEnd && end > item.srcStart
    )
  })
  if (blocks.length > 0) return blocks
  const block = root.querySelector<HTMLElement>(`[data-block-id="${cssEscape(item.blockId)}"]`)
  return block ? [block] : []
}

function planMarkerText(item: PlanItem): string {
  if (item.status === 'locked') return 'locked'
  if (item.status === 'stale') return 'stale'
  return 'default'
}
