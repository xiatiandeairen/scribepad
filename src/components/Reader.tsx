/**
 * Reader — markdown article view with annotation marks + selection capture.
 *
 * Two-pass render to keep React owning the article HTML and DOM mutation
 * isolated to a post-render effect:
 *
 *   1. dangerouslySetInnerHTML installs the rendered markdown (output of
 *      lib/markdown.ts) into a contained scroll area, complete with the
 *      data-src-start/end attributes that lib/anchor.ts depends on.
 *   2. A useEffect walks each open annotation, calls locateAnchorInDom to
 *      find its DOM range, and wraps the matching text in a <mark> with the
 *      state-derived class. The wrapping is non-destructive — we restore
 *      the original innerHTML on every content/annotation change before
 *      re-decorating, so accumulation can't drift the offsets.
 *
 * Selection capture:
 *   Listens to document `selectionchange`, debounced 50ms. When the current
 *   range lies inside the reader root and is non-empty, we hand the parent
 *   a fresh Anchor; when collapsed/outside, we send null so the App can
 *   close any selection-driven popover. The popover itself is App-level —
 *   this component owns reading + click reporting only.
 */
import { useEffect, useRef } from 'react'
import type { Annotation, AnnotationState } from '../../types/annotation'
import type { Anchor } from '../../types/annotation'
import { renderMarkdown } from '../lib/markdown'
import { domSelectionToAnchor, locateAnchorInDom } from '../lib/anchor'

export interface ReaderProps {
  content: string
  annotations: Annotation[]
  activeId?: string | undefined
  onSelectionAnchor: (anchor: Anchor | null) => void
  onMarkClick: (id: string) => void
}

/**
 * Map persistent annotation state → mark visual variant. Mirrors Sidebar's
 * pickVariant so a card and its mark always share a class. `discussed`
 * splits into thinking (no AI yet) vs deciding (AI returned).
 */
function markClassFor(anno: Annotation): string {
  const variant = pickVariant(anno.state, anno.ai_suggestion ?? null)
  return `anno ${variant}`
}

function pickVariant(state: AnnotationState, aiSuggestion: string | null): string {
  switch (state) {
    case 'draft':
      return 'draft'
    case 'discussed':
      return aiSuggestion ? 'deciding' : 'thinking'
    case 'decided':
      return 'decided'
    case 'executed':
      return 'decided'
  }
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
  const onMarkClickRef = useRef(props.onMarkClick)
  useEffect(() => {
    onSelectionAnchorRef.current = props.onSelectionAnchor
  }, [props.onSelectionAnchor])
  useEffect(() => {
    onMarkClickRef.current = props.onMarkClick
  }, [props.onMarkClick])

  const baseHtml = renderMarkdown(props.content)
  baseHtmlRef.current = baseHtml

  // Apply marks after every render that could change them (content changes
  // re-mount innerHTML via React; annotation/active changes redo decoration
  // here on the same DOM React just installed).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // Reset to clean rendered HTML before every decoration pass so previous
    // <mark> wrappers don't compound and shift text-node offsets.
    if (root.innerHTML !== baseHtmlRef.current) {
      root.innerHTML = baseHtmlRef.current
    }

    const open = props.annotations.filter((a) => a.status === 'open')

    // Decorate longest-span first so nested anchors (rare) don't get
    // swallowed by an earlier wrap that splits their text node.
    const ordered = [...open].sort(
      (a, b) => b.anchor.srcEnd - b.anchor.srcStart - (a.anchor.srcEnd - a.anchor.srcStart),
    )

    for (const anno of ordered) {
      const loc = locateAnchorInDom(root, anno.anchor)
      if (!loc) continue
      const textNode = loc.node
      if (textNode.nodeType !== Node.TEXT_NODE) continue
      const value = textNode.textContent ?? ''
      const startOffset = Math.max(0, Math.min(loc.startOffset, value.length))
      const endOffset = Math.max(startOffset, Math.min(loc.endOffset, value.length))
      if (endOffset === startOffset) continue

      try {
        const range = document.createRange()
        range.setStart(textNode, startOffset)
        range.setEnd(textNode, endOffset)

        const mark = document.createElement('mark')
        let className = markClassFor(anno)
        if (props.activeId === anno.id) className += ' active'
        mark.className = className
        mark.setAttribute('data-anno-id', anno.id)

        // surroundContents requires the range's start/end share a parent —
        // guaranteed here because we restrict locateAnchorInDom to the
        // single start text node (see anchor.ts return contract).
        range.surroundContents(mark)
      } catch {
        // Skip anchors whose DOM range can't be wrapped (e.g. crossed an
        // inline element boundary). Silent skip is acceptable — Sidebar
        // still shows the card.
      }
    }
  }, [baseHtml, props.annotations, props.activeId])

  // selectionchange listener (document-level — Selection API does not fire
  // events on individual elements). Debounce avoids per-keystroke spam
  // while still feeling immediate.
  useEffect(() => {
    let timer: number | null = null

    const handle = (): void => {
      const root = rootRef.current
      if (!root) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) {
        onSelectionAnchorRef.current(null)
        return
      }
      const range = sel.getRangeAt(0)
      // Selection must be (a) non-collapsed, (b) within the reader root.
      if (sel.isCollapsed) {
        onSelectionAnchorRef.current(null)
        return
      }
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        onSelectionAnchorRef.current(null)
        return
      }
      const anchor = domSelectionToAnchor(range)
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

  // Click delegation — find nearest <mark data-anno-id> ancestor.
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    let el: HTMLElement | null = e.target as HTMLElement
    while (el && el !== e.currentTarget) {
      if (el.tagName === 'MARK') {
        const id = el.getAttribute('data-anno-id')
        if (id) {
          onMarkClickRef.current(id)
          return
        }
      }
      el = el.parentElement
    }
  }

  return (
    <div
      ref={rootRef}
      className="reader"
      onClick={onClick}
      // Initial paint: React installs the rendered markdown HTML. Subsequent
      // paints reuse the same string (the effect above does any decoration).
      dangerouslySetInnerHTML={{ __html: baseHtml }}
    />
  )
}
