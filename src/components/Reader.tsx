/**
 * Reader — markdown article view with sentence-level interaction.
 *
 * Two-pass render — React owns the article HTML; an effect overlays marks:
 *
 *   1. dangerouslySetInnerHTML installs the rendered markdown (output of
 *      lib/markdown.ts) — paragraphs/headings/code carry `data-block-id`,
 *      every sentence is wrapped in `<span data-sentence-idx>`.
 *   2. A useEffect resets innerHTML to the clean base, then walks each
 *      open annotation: locates its block + sentence spans via
 *      locateAnchorInDom and overlays a `<mark>` element. Whole-sentence
 *      anchors get one `<mark>` per covered sentence span; sub-sentence
 *      anchors wrap the in-sentence DOM range directly.
 *
 * Two interaction paths feed the parent App:
 *
 *   - hover:    pure CSS affordance — sentence span shows an annotation hint.
 *   - click:    click a bare sentence span → create a whole-sentence draft.
 *   - drag:     non-collapsed selection → snap to whole-sentence boundaries
 *               when crossing sentences (visually too) → pointerup commits
 *               the selected range as a draft.
 *   - mark:     click inside an existing `<mark data-anno-id>` →
 *               onMarkClick(id) so App can activate / open modal.
 */
import { useEffect, useRef } from 'react'
import type { Annotation, AnnotationState, Anchor } from '../../types/annotation'
import type { PlanItem } from '../../types/plan'
import { renderMarkdown } from '../lib/markdown'
import { domSelectionToAnchor, locateAnchorInDom } from '../lib/anchor'

export interface ReaderProps {
  content: string
  annotations: Annotation[]
  planItems?: PlanItem[]
  activeId?: string | undefined
  activePlanItemId?: string | undefined
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

export function Reader(props: ReaderProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
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

  const baseHtml = renderMarkdown(props.content)
  baseHtmlRef.current = baseHtml

  // ── Mark overlay pass ──────────────────────────────────────────────────
  // Reset to clean base HTML each pass, then re-apply marks. Idempotent —
  // running this multiple times produces the same DOM.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    if (root.innerHTML !== baseHtmlRef.current) {
      root.innerHTML = baseHtmlRef.current
    }

    const visible = props.annotations.filter((a) => a.status === 'open')

    for (const anno of visible) {
      const loc = locateAnchorInDom(root, anno.anchor)
      if (!loc) continue
      const cls = markClassFor(anno, props.activeId === anno.id)

      if (loc.subRange) {
        // Sub-sentence: wrap the in-sentence DOM range. surroundContents
        // throws if the range partially crosses an inline element — fall
        // through to whole-sentence highlighting in that case.
        try {
          const mark = document.createElement('mark')
          mark.className = cls
          mark.setAttribute('data-anno-id', anno.id)
          loc.subRange.surroundContents(mark)
          loc.sentences[0]?.setAttribute('data-anno-covered', anno.id)
          continue
        } catch {
          // fall through to whole-sentence path
        }
      }

      // Whole-sentence (or sub-sentence fallback): wrap each covered
      // sentence span's contents with its own `<mark>`.
      for (const span of loc.sentences) {
        try {
          const range = document.createRange()
          range.selectNodeContents(span)
          const mark = document.createElement('mark')
          mark.className = cls
          mark.setAttribute('data-anno-id', anno.id)
          range.surroundContents(mark)
          span.setAttribute('data-anno-covered', anno.id)
        } catch {
          // Span has incompatible structure for surroundContents — flag it
          // covered so click won't try to create a duplicate, but skip the
          // visual mark for this span.
          span.setAttribute('data-anno-covered', anno.id)
        }
      }
    }

    for (const item of props.planItems ?? []) {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${cssEscape(item.blockId)}"]`)
      if (!block) continue
      const blockLeft = block.getBoundingClientRect().left - root.getBoundingClientRect().left
      const railX = Number.parseFloat(window.getComputedStyle(root).paddingLeft) - 22
      block.style.setProperty('--plan-line-left', `${railX - blockLeft}px`)
      block.style.setProperty('--plan-marker-left', `${railX - 94 - blockLeft}px`)
      block.classList.add('plan-block')
      if (props.activePlanItemId === item.id) block.classList.add('plan-block-active')
      block.setAttribute('data-plan-item-id', item.id)
      block.setAttribute('data-plan-kind', item.kind)
      block.setAttribute('data-plan-status', item.status)

      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = `plan-rail-marker ${item.kind} ${item.status}`
      marker.setAttribute('data-plan-rail-id', item.id)
      marker.setAttribute('aria-label', `${item.title}: ${item.text}`)
      const label = document.createElement('span')
      label.className = 'plan-rail-label'
      label.textContent = planMarkerText(item)
      marker.append(label)
      if (item.status === 'locked') {
        const lock = document.createElement('span')
        lock.className = 'plan-rail-lock'
        lock.setAttribute('aria-hidden', 'true')
        lock.textContent = '🔒'
        marker.append(lock)
      }
      block.prepend(marker)
    }
  }, [baseHtml, props.annotations, props.activeId, props.planItems, props.activePlanItemId])

  // ── selectionchange + visual snap to sentence boundaries ────────────────
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

      const anchor = domSelectionToAnchor(range)

      // Cross-sentence anchors auto-snap the visual selection to whole-
      // sentence boundaries so what the user sees matches the anchor we'll
      // commit. Skip when already snapped to avoid a redundant set.
      if (anchor && anchor.startSentenceIdx !== anchor.endSentenceIdx) {
        const loc = locateAnchorInDom(root, anchor)
        if (loc && loc.sentences.length > 0) {
          const first = loc.sentences[0]!
          const last = loc.sentences[loc.sentences.length - 1]!
          const alreadySnapped =
            range.startContainer === first &&
            range.startOffset === 0 &&
            range.endContainer === last &&
            range.endOffset === last.childNodes.length
          if (!alreadySnapped) {
            const snapped = document.createRange()
            snapped.setStart(first, 0)
            snapped.setEnd(last, last.childNodes.length)
            sel.removeAllRanges()
            sel.addRange(snapped)
          }
        }
      }

      onSelectionAnchorRef.current(anchor)
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
    let blockEl: HTMLElement | null = null

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
      if (!blockEl && el.hasAttribute('data-block-id')) {
        blockEl = el
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
    if (!sentenceEl || !blockEl || sentenceEl.hasAttribute('data-anno-covered')) return

    const blockId = blockEl.getAttribute('data-block-id')
    const sentenceIdx = Number.parseInt(sentenceEl.getAttribute('data-sentence-idx') ?? '', 10)
    const text = (sentenceEl.textContent ?? '').trim()
    if (!blockId || Number.isNaN(sentenceIdx) || !text) return

    onCreateAnchorRef.current({
      blockId,
      startSentenceIdx: sentenceIdx,
      endSentenceIdx: sentenceIdx,
      text,
    })
  }

  // ── Drag-select commit ─────────────────────────────────────────────────
  // Mouse/touch drag selection is a single gesture: release the pointer and
  // immediately create a draft for that range. The App-level popover remains
  // available only for non-pointer selection paths.
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const root = rootRef.current
    if (!root) return

    let el: HTMLElement | null = e.target as HTMLElement
    while (el && el !== e.currentTarget) {
      if (el.tagName === 'MARK' && el.hasAttribute('data-anno-id')) return
      el = el.parentElement
    }

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return

    const anchor = domSelectionToAnchor(range)
    if (!anchor) return

    onCreateAnchorRef.current(anchor)
    onSelectionAnchorRef.current(null)
    sel.removeAllRanges()
  }

  return (
    <div
      ref={rootRef}
      className="reader"
      onClick={onClick}
      onPointerUp={onPointerUp}
      // Initial paint installs the rendered markdown; the effect above
      // overlays marks idempotently on subsequent renders.
      dangerouslySetInnerHTML={{ __html: baseHtml }}
    />
  )
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}

function planMarkerText(item: PlanItem): string {
  if (item.status === 'locked') return 'locked'
  if (item.status === 'stale') return 'stale'
  return 'default'
}
