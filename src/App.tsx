/**
 * App — top-level coordinator for scribepad v0.1.
 *
 * Owns the source-of-truth for: document content, file path, annotation list,
 * the currently-active annotation id, the live text selection (anchor + bounding
 * rect for popover positioning), the modal target id, per-annotation busy
 * flags (AI rewrite in flight), and a toast-style error string.
 *
 * Persistence is fire-and-forget optimistic: we update React state first, then
 * call saveAnnotations / saveDocument; failures surface as a toast and revert
 * the offending change. This matches the "Optimistic UI" entry in
 * docs/plan.md §1.3.
 *
 * The 7 user flows from §1.2 wire through here as callbacks passed down to
 * Reader / Sidebar / DiffModal:
 *   1. load file/annotations on mount + reload button
 *   2. create draft from popover
 *   3. submit instruction → discussed (thinking) → rewrite → discussed (deciding)
 *   4. open DiffModal from mark click or sidebar 查看 button
 *   5. accept (apply rewrite to source + saveDocument)
 *   6. accept+lock (apply rewrite + state=decided)
 *   7. lock / unlock / delete from sidebar; cancel from modal reverts to draft
 */

import { useCallback, useEffect, useState } from 'react'
import type { Annotation, Anchor, AnnotationStatus } from '../types/annotation'
import { Reader } from './components/Reader'
import { Sidebar } from './components/Sidebar'
import { DiffModal } from './components/DiffModal'
import { getAnnotations, getFile, requestRewrite, saveAnnotations, saveDocument } from './lib/api'
import { remapAnchorsAfterRewrite, resolveAnchorToSourceRange } from './lib/anchor'
import { renderMarkdown } from './lib/markdown'

/** Generate a sortable, collision-resistant id without bringing in a uuid dep. */
function makeAnnotationId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `a-${Date.now()}-${rand}`
}

export function App(): JSX.Element {
  const [content, setContent] = useState<string>('')
  const [path, setPath] = useState<string>('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [selectionAnchor, setSelectionAnchor] = useState<Anchor | null>(null)
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [decidingModalFor, setDecidingModalFor] = useState<string | null>(null)
  // `busy` is kept for state-machine completeness (future UX: dim card while
  // AI is in flight). Currently read only to satisfy noUnusedLocals; see the
  // `data-busy-count` attribute on the layout below.
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  // ── Persistence helper ─────────────────────────────────────────────────
  // Centralised so every optimistic update goes through one error-handling path.
  // We intentionally don't await the network — the caller already updated React
  // state. On failure we surface a toast; rollback (if any) is the caller's job.
  const persistAnnotations = useCallback((next: Annotation[]): void => {
    saveAnnotations(next).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'save annotations failed'
      setError(message)
    })
  }, [])

  // ── Loader ─────────────────────────────────────────────────────────────
  const reload = useCallback(async (): Promise<void> => {
    try {
      const [file, anns] = await Promise.all([getFile(), getAnnotations()])
      setContent(file.content)
      setPath(file.path)
      setAnnotations(anns.annotations)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'load failed'
      setError(message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // ── Selection / popover ────────────────────────────────────────────────
  // Reader debounces selectionchange and reports the source-coordinate Anchor
  // here. We additionally read the live DOM range to remember the bounding
  // rect — needed for absolute popover positioning.
  const handleSelectionAnchor = useCallback((anchor: Anchor | null): void => {
    setSelectionAnchor(anchor)
    if (!anchor) {
      setSelectionRect(null)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionRect(null)
      return
    }
    const range = sel.getRangeAt(0)
    // For multi-line selections, getBoundingClientRect's .right is the
    // widest line's right edge (often the paragraph's right margin), which
    // is far from where the user actually finished selecting. Use the LAST
    // line rect so the popover anchors to the visual end of the selection.
    const rects = range.getClientRects()
    const endRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
    setSelectionRect(endRect as DOMRect)
  }, [])

  const clearSelection = useCallback((): void => {
    setSelectionAnchor(null)
    setSelectionRect(null)
    const sel = window.getSelection()
    sel?.removeAllRanges()
  }, [])

  const dismissDraft = useCallback(
    (id: string): void => {
      const next = annotations.filter((a) => a.id !== id)
      setAnnotations(next)
      persistAnnotations(next)
      if (activeId === id) setActiveId(undefined)
    },
    [annotations, activeId, persistAnnotations],
  )

  useEffect(() => {
    const activeDraft =
      activeId != null
        ? (annotations.find(
            (a) =>
              a.id === activeId &&
              a.status === 'open' &&
              a.state === 'draft' &&
              !a.instruction &&
              a.ai_suggestion == null,
          ) ?? null)
        : null

    if (!activeDraft) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.popover')) return
      if (target.closest(`.anno-card[data-anno-id="${activeDraft.id}"]`)) return
      dismissDraft(activeDraft.id)
      clearSelection()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [annotations, activeId, dismissDraft, clearSelection])

  // ── Mark click → activate + maybe open modal ───────────────────────────
  const handleMarkClick = useCallback(
    (id: string): void => {
      setActiveId(id)
      const anno = annotations.find((a) => a.id === id)
      if (!anno) return
      if (anno.state === 'discussed' && anno.ai_suggestion) {
        setDecidingModalFor(id)
      }
    },
    [annotations],
  )

  // ── Create draft annotation from any anchor ─────────────────────────────
  // Shared by both creation paths:
  //   - popover click (drag-select committed) → uses selectionAnchor
  //   - sentence click (Reader's onCreateAnchor) → direct create, no popover
  const handleCreateFromAnchor = useCallback(
    (anchor: Anchor): void => {
      const fresh: Annotation = {
        id: makeAnnotationId(),
        anchor,
        state: 'draft',
        status: 'open',
        history: [],
        created_at: new Date().toISOString(),
        ai_suggestion: null,
      }
      const next = [...annotations, fresh]
      setAnnotations(next)
      setActiveId(fresh.id)
      persistAnnotations(next)
    },
    [annotations, persistAnnotations],
  )

  const handleCreateAnnotation = useCallback((): void => {
    if (!selectionAnchor) return
    handleCreateFromAnchor(selectionAnchor)
    clearSelection()
  }, [selectionAnchor, handleCreateFromAnchor, clearSelection])

  // ── Submit instruction → request AI rewrite ────────────────────────────
  // Two-phase optimistic update:
  //   phase A: state='discussed' + instruction set, ai_suggestion still null
  //            → Sidebar shows "thinking" spinner.
  //   phase B: ai_suggestion populated → "deciding" card.
  // On error: revert to 'draft' so the user can retry without losing input.
  const handleSubmitInstruction = useCallback(
    async (id: string, instruction: string): Promise<void> => {
      const target = annotations.find((a) => a.id === id)
      if (!target) return

      const thinking = annotations.map((a) =>
        a.id === id ? { ...a, state: 'discussed' as const, instruction, ai_suggestion: null } : a,
      )
      setAnnotations(thinking)
      setBusy((prev) => ({ ...prev, [id]: true }))
      persistAnnotations(thinking)

      try {
        const resp = await requestRewrite({
          fullDoc: content,
          items: [{ id, selection: target.anchor.text, instruction }],
        })
        const result = resp.results.find((r) => r.id === id)
        if (!result) {
          throw new Error('rewrite returned no result for this annotation')
        }
        // Merge into the latest annotations snapshot using the functional
        // setter — concurrent edits (delete, lock) are preserved.
        setAnnotations((prev) => {
          const next = prev.map((a) =>
            a.id === id ? { ...a, ai_suggestion: result.rewritten } : a,
          )
          persistAnnotations(next)
          return next
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'rewrite failed'
        setError(message)
        setAnnotations((prev) => {
          const reverted = prev.map((a) =>
            a.id === id ? { ...a, state: 'draft' as const, ai_suggestion: null } : a,
          )
          persistAnnotations(reverted)
          return reverted
        })
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [annotations, content, persistAnnotations],
  )

  // ── Lock / Unlock / Delete ─────────────────────────────────────────────
  const handleLock = useCallback(
    (id: string): void => {
      const next = annotations.map((a) => (a.id === id ? { ...a, state: 'decided' as const } : a))
      setAnnotations(next)
      persistAnnotations(next)
    },
    [annotations, persistAnnotations],
  )

  const handleUnlock = useCallback(
    (id: string): void => {
      const next = annotations.map((a) => (a.id === id ? { ...a, state: 'draft' as const } : a))
      setAnnotations(next)
      persistAnnotations(next)
    },
    [annotations, persistAnnotations],
  )

  const handleDelete = useCallback(
    (id: string): void => {
      const next = annotations.filter((a) => a.id !== id)
      setAnnotations(next)
      persistAnnotations(next)
      if (activeId === id) setActiveId(undefined)
      if (decidingModalFor === id) setDecidingModalFor(null)
    },
    [annotations, activeId, decidingModalFor, persistAnnotations],
  )

  const handleOpenModal = useCallback((id: string): void => {
    setDecidingModalFor(id)
    setActiveId(id)
  }, [])

  // ── Modal actions ──────────────────────────────────────────────────────
  // applyRewrite — splice the AI rewrite into the source at the anchor's
  // location, mark the annotation status='applied' (so it leaves the
  // sidebar), and persist both the .md and the sidecar. `lock` flips
  // state='decided' before applying.
  //
  // The anchor → source-range mapping reads `data-src-start/end` on the
  // target sentence span(s). For sub-sentence anchors on plain-text spans
  // we splice precisely; for spans containing inline markdown formatting
  // we degrade to the full-sentence range (preserves `**` / `*` / etc.).
  const applyRewrite = useCallback(
    (id: string, lock: boolean): void => {
      const target = annotations.find((a) => a.id === id)
      if (!target || target.ai_suggestion == null) return

      const reader = document.querySelector<HTMLDivElement>('.reader')
      if (!reader) {
        setError('reader not mounted')
        return
      }
      const range = resolveAnchorToSourceRange(reader, target.anchor)
      if (!range) {
        setError('anchor no longer locatable in document')
        return
      }
      const [srcStart, srcEnd] = range
      const newContent = content.slice(0, srcStart) + target.ai_suggestion + content.slice(srcEnd)

      const oldRoot = document.createElement('div')
      oldRoot.innerHTML = renderMarkdown(content)
      const newRoot = document.createElement('div')
      newRoot.innerHTML = renderMarkdown(newContent)

      const rebased = remapAnchorsAfterRewrite(
        oldRoot,
        newRoot,
        annotations,
        id,
        [srcStart, srcEnd],
        target.ai_suggestion,
      )
      const next = rebased.map((a) =>
        a.id === id
          ? {
              ...a,
              state: lock ? ('decided' as const) : a.state,
              status: 'applied' as AnnotationStatus,
              ai_suggestion: null,
            }
          : a,
      )

      setContent(newContent)
      setAnnotations(next)
      setDecidingModalFor(null)

      saveDocument(newContent).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'save document failed'
        setError(message)
      })
      persistAnnotations(next)
    },
    [annotations, content, persistAnnotations],
  )

  const handleAccept = useCallback((): void => {
    if (decidingModalFor) applyRewrite(decidingModalFor, false)
  }, [decidingModalFor, applyRewrite])

  const handleAcceptAndLock = useCallback((): void => {
    if (decidingModalFor) applyRewrite(decidingModalFor, true)
  }, [decidingModalFor, applyRewrite])

  // Cancel: drop the AI suggestion and roll the annotation back to draft so
  // the user can either tweak the instruction or delete the card outright.
  const handleCancel = useCallback((): void => {
    const id = decidingModalFor
    setDecidingModalFor(null)
    if (!id) return
    const next = annotations.map((a) =>
      a.id === id ? { ...a, ai_suggestion: null, state: 'draft' as const } : a,
    )
    setAnnotations(next)
    persistAnnotations(next)
  }, [annotations, decidingModalFor, persistAnnotations])

  const handleReprompt = useCallback(
    (newInstruction: string): void => {
      const id = decidingModalFor
      setDecidingModalFor(null)
      if (!id) return
      void handleSubmitInstruction(id, newInstruction)
    },
    [decidingModalFor, handleSubmitInstruction],
  )

  // ── Derived view-state ─────────────────────────────────────────────────
  const decidingAnnotation = decidingModalFor
    ? (annotations.find((a) => a.id === decidingModalFor) ?? null)
    : null
  const modalOpen = !!decidingAnnotation && !!decidingAnnotation.ai_suggestion

  const visibleCount = annotations.filter((a) => a.status === 'open').length
  const decidedCount = annotations.filter(
    (a) => a.status === 'open' && a.state === 'decided',
  ).length
  const badgeText = `${visibleCount} 批注 · ${decidedCount} 已定`

  // Hide popover while a modal is up — otherwise the popover floats over the
  // backdrop and steals clicks meant for cancel.
  const showPopover = !!selectionAnchor && !!selectionRect && !modalOpen

  return (
    <div className="app">
      <header className="app-header">
        <strong>scribepad</strong>
        <span className="path">{path}</span>
        <span className="badge">{badgeText}</span>
        <button type="button" onClick={() => void reload()} aria-label="重新加载">
          ↻
        </button>
      </header>

      <main className="layout" data-busy-count={Object.keys(busy).length}>
        <Reader
          content={content}
          annotations={annotations}
          activeId={activeId}
          onSelectionAnchor={handleSelectionAnchor}
          onCreateAnchor={handleCreateFromAnchor}
          onMarkClick={handleMarkClick}
        />
        <Sidebar
          annotations={annotations}
          activeId={activeId}
          onSubmitInstruction={(id, instruction) => {
            void handleSubmitInstruction(id, instruction)
          }}
          onLock={handleLock}
          onUnlock={handleUnlock}
          onDelete={handleDelete}
          onOpenModal={handleOpenModal}
        />
      </main>

      {showPopover &&
        selectionRect &&
        (() => {
          // Inline placement: sit on the same baseline as the selection's last
          // line, just to its right. Flip to the left side when the selection
          // ends near the viewport's right edge so the popover stays on screen.
          const POPOVER_WIDTH_PX = 80
          const GAP_PX = 8
          const VIEWPORT_PAD_PX = 12
          const overflowsRight =
            selectionRect.right + GAP_PX + POPOVER_WIDTH_PX > window.innerWidth - VIEWPORT_PAD_PX
          const left = overflowsRight
            ? Math.max(VIEWPORT_PAD_PX, selectionRect.left - GAP_PX - POPOVER_WIDTH_PX)
            : selectionRect.right + GAP_PX
          return (
            <div
              className="popover popover-inline"
              style={{
                position: 'fixed',
                top: selectionRect.top,
                left,
                transform: 'none',
                bottom: 'auto',
                zIndex: 999,
              }}
              onMouseDown={(e) => {
                // Prevent the click from collapsing the selection before our
                // handler fires (mousedown clears native selection in most browsers).
                e.preventDefault()
              }}
              onClick={handleCreateAnnotation}
            >
              💬 批注
            </div>
          )
        })()}

      <DiffModal
        isOpen={modalOpen}
        annotation={decidingAnnotation}
        onAccept={handleAccept}
        onAcceptAndLock={handleAcceptAndLock}
        onCancel={handleCancel}
        onReprompt={handleReprompt}
      />

      {error && (
        <div
          className="toast"
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'var(--shadow-md)',
            zIndex: 1000,
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="关闭提示"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
