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
 *   4. open DiffModal from mark click or AI-returned sidebar card
 *   5. accept (apply rewrite to source + saveDocument)
 *   6. accept+lock (apply rewrite + state=decided)
 *   7. lock / unlock / delete from sidebar; cancel from modal reverts to draft
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, Anchor, AnnotationStatus, ThreadMessage } from '../types/annotation'
import { Reader } from './components/Reader'
import { Sidebar } from './components/Sidebar'
import { DiffModal } from './components/DiffModal'
import { PlanPanel } from './components/PlanPanel'
import { SessionActions } from './components/SessionActions'
import {
  closeSession,
  connectDocumentSession,
  disconnectDocumentSession,
  doneDocumentSession,
  getAiConfig,
  getAiStatus,
  getAnnotations,
  getDocumentSession,
  getFile,
  getPlanState,
  getSession,
  heartbeatDocumentSession,
  heartbeatSession,
  normalizeReviewDocument,
  requestRewrite,
  saveAiConfig,
  saveAnnotations,
  saveDocument,
  savePlanState,
  testAiConfig,
} from './lib/api'
import { inspectPlan } from './lib/plan-inspector'
import { validateNormalizedReview } from './lib/review-normalize-validation'
import type { AiConfig, AiStatusResponse, SessionResponse } from '../types/api'
import type { PlanItem, PlanItemState, PlanItemStatus } from '../types/plan'

/** Generate a sortable, collision-resistant id without bringing in a uuid dep. */
function makeAnnotationId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `a-${Date.now()}-${rand}`
}

function makeThreadMessageId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `m-${Date.now()}-${rand}`
}

function threadMessage(
  kind: ThreadMessage['kind'],
  text: string,
  role: ThreadMessage['role'] = 'user',
): ThreadMessage {
  return {
    id: makeThreadMessageId(),
    role,
    kind,
    text,
    created_at: new Date().toISOString(),
  }
}

function sessionIdFromLocation(): string | undefined {
  const match = window.location.pathname.match(/^\/s\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}

function isValidSourceRange(anchor: Anchor, sourceLength: number): boolean {
  return (
    Number.isInteger(anchor.srcStart) &&
    Number.isInteger(anchor.srcEnd) &&
    anchor.srcStart >= 0 &&
    anchor.srcEnd > anchor.srcStart &&
    anchor.srcEnd <= sourceLength
  )
}

function remapAnnotationsAfterSourceRewrite(
  annotations: Annotation[],
  rewrittenId: string,
  rewrittenRange: [number, number],
  replacementLength: number,
): Annotation[] {
  const [rewriteStart, rewriteEnd] = rewrittenRange
  const delta = replacementLength - (rewriteEnd - rewriteStart)

  return annotations.map((anno) => {
    if (anno.id === rewrittenId || anno.status !== 'open') return anno

    const { srcStart, srcEnd } = anno.anchor
    if (srcEnd <= rewriteStart) return anno
    if (srcStart >= rewriteEnd) {
      return {
        ...anno,
        anchor: {
          ...anno.anchor,
          srcStart: srcStart + delta,
          srcEnd: srcEnd + delta,
        },
      }
    }

    return { ...anno, status: 'dismissed' as const }
  })
}

const SIGNAL_SECTION_LABELS: Partial<Record<PlanItem['kind'], string>> = {
  goal: '目标',
  scope: '范围',
  behavior: '方案',
  verification: '验收',
  'open-question': '待确认',
}

type HeaderSignal = {
  id: string
  label: string
  severity: 'warning' | 'info'
}

type AiPanelMode =
  | 'editing'
  | 'saving'
  | 'saved'
  | 'testing'
  | 'test-success'
  | 'test-error'
  | 'save-error'

const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'codex-cli',
  timeoutMs: 120_000,
  codex: {
    command: 'codex',
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    sandbox: 'read-only',
  },
  claude: {
    command: 'claude',
    args: ['-p'],
  },
}

export function App(): JSX.Element {
  const documentSessionId = useMemo(() => sessionIdFromLocation(), [])
  const clientIdRef = useRef<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [path, setPath] = useState<string>('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [planState, setPlanState] = useState<PlanItemState[]>([])
  const [hoveredPlanItemId, setHoveredPlanItemId] = useState<string | undefined>(undefined)
  const [rightRailTab, setRightRailTab] = useState<'review' | 'comments'>('review')
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [selectionAnchor, setSelectionAnchor] = useState<Anchor | null>(null)
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [decidingModalFor, setDecidingModalFor] = useState<string | null>(null)
  // `busy` is kept for state-machine completeness (future UX: dim card while
  // AI is in flight). Currently read only to satisfy noUnusedLocals; see the
  // `data-busy-count` attribute on the layout below.
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [sessionClosed, setSessionClosed] = useState(false)
  const [closingSession, setClosingSession] = useState(false)
  const [normalizingReview, setNormalizingReview] = useState(false)
  const [pendingReviewNormalization, setPendingReviewNormalization] = useState<string | null>(null)
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG)
  const [aiDraftConfig, setAiDraftConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG)
  const [aiStatus, setAiStatus] = useState<AiStatusResponse>({
    provider: DEFAULT_AI_CONFIG.provider,
    label: 'Codex CLI',
    state: 'unknown',
    available: false,
  })
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiLoadError, setAiLoadError] = useState<string | null>(null)
  const [aiPanelMode, setAiPanelMode] = useState<AiPanelMode>('editing')
  const [aiPanelMessage, setAiPanelMessage] = useState<string | null>(null)

  // ── Persistence helper ─────────────────────────────────────────────────
  // Centralised so every optimistic update goes through one error-handling path.
  // We intentionally don't await the network — the caller already updated React
  // state. On failure we surface a toast; rollback (if any) is the caller's job.
  const persistAnnotations = useCallback(
    (next: Annotation[]): void => {
      saveAnnotations(next, documentSessionId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'save annotations failed'
        setError(message)
      })
    },
    [documentSessionId],
  )

  const persistPlanState = useCallback(
    (next: PlanItemState[]): void => {
      savePlanState(next, documentSessionId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'save plan state failed'
        setError(message)
      })
    },
    [documentSessionId],
  )

  // ── Loader ─────────────────────────────────────────────────────────────
  const reload = useCallback(async (): Promise<void> => {
    try {
      const [file, anns, planStateResp] = await Promise.all([
        getFile(documentSessionId),
        getAnnotations(documentSessionId),
        getPlanState(documentSessionId),
      ])
      setContent(file.content)
      setPath(file.path)
      setAnnotations(anns.annotations)
      setPlanState(planStateResp.planState)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'load failed'
      setError(message)
    }
  }, [documentSessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let stopped = false
    Promise.all([getAiConfig(), getAiStatus()])
      .then(([configResp, statusResp]) => {
        if (stopped) return
        setAiConfig(configResp.config)
        setAiDraftConfig(configResp.config)
        setAiStatus(statusResp)
        setAiLoadError(null)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'load AI config failed'
        setAiConfig(DEFAULT_AI_CONFIG)
        setAiDraftConfig(DEFAULT_AI_CONFIG)
        setAiStatus({
          provider: DEFAULT_AI_CONFIG.provider,
          label: 'Codex CLI',
          state: 'error',
          available: false,
          reason: message,
        })
        setAiLoadError(message)
      })
    return () => {
      stopped = true
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const load = documentSessionId ? getDocumentSession(documentSessionId) : getSession()
    load
      .then((next) => {
        if (!stopped) setSession(next)
      })
      .catch(() => {
        // Session API is optional in development; keep the editor usable.
      })
    return () => {
      stopped = true
    }
  }, [documentSessionId])

  useEffect(() => {
    if (!documentSessionId) return
    let stopped = false
    connectDocumentSession(documentSessionId)
      .then((connected) => {
        if (stopped) return
        clientIdRef.current = connected.clientId
        setSession(connected.session)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'connect session failed'
        setError(message)
      })

    return () => {
      stopped = true
      const clientId = clientIdRef.current
      if (clientId) disconnectDocumentSession(documentSessionId, clientId)
      clientIdRef.current = null
    }
  }, [documentSessionId])

  useEffect(() => {
    if (!session || sessionClosed) return
    const timer = window.setInterval(() => {
      const clientId = clientIdRef.current
      const heartbeat =
        documentSessionId && clientId
          ? heartbeatDocumentSession(documentSessionId, clientId)
          : heartbeatSession()
      heartbeat.then(setSession).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'heartbeat failed'
        setError(message)
      })
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [documentSessionId, session, sessionClosed])

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

  const closeAiPanel = useCallback((): void => {
    setAiDraftConfig(aiConfig)
    setAiPanelMode('editing')
    setAiPanelMessage(null)
    setAiPanelOpen(false)
  }, [aiConfig])

  const handleSaveAiConfig = useCallback(async (): Promise<void> => {
    setAiPanelMode('saving')
    setAiPanelMessage('正在保存…')
    try {
      const resp = await saveAiConfig(aiDraftConfig)
      const status = await getAiStatus()
      setAiConfig(resp.config)
      setAiDraftConfig(resp.config)
      setAiStatus(status)
      setAiLoadError(null)
      setAiPanelMode('saved')
      setAiPanelMessage('已保存')
      window.setTimeout(() => {
        setAiPanelOpen(false)
        setAiPanelMode('editing')
        setAiPanelMessage(null)
      }, 600)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'save AI config failed'
      setAiPanelMode('save-error')
      setAiPanelMessage(`保存失败：${message}`)
    }
  }, [aiDraftConfig])

  const handleSaveAndTestAiConfig = useCallback(async (): Promise<void> => {
    const label = aiDraftConfig.provider === 'codex-cli' ? 'Codex CLI' : 'Claude Code CLI'
    setAiPanelMode('testing')
    setAiPanelMessage(`正在测试 ${label}…`)
    try {
      const resp = await saveAiConfig(aiDraftConfig)
      setAiConfig(resp.config)
      setAiDraftConfig(resp.config)
      setAiLoadError(null)
      const status = await testAiConfig()
      setAiStatus(status)
      if (status.state === 'ready') {
        setAiPanelMode('test-success')
        setAiPanelMessage(`测试成功：${status.label} 可用`)
        window.setTimeout(() => {
          setAiPanelOpen(false)
          setAiPanelMode('editing')
          setAiPanelMessage(null)
        }, 1200)
      } else {
        setAiPanelMode('test-error')
        setAiPanelMessage(`测试失败：${status.reason ?? 'AI provider 不可用'}`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'save and test AI config failed'
      setAiLoadError(message)
      setAiPanelMode('test-error')
      setAiPanelMessage(`测试失败：${message}`)
      setAiStatus({
        provider: aiDraftConfig.provider,
        label: aiDraftConfig.provider === 'codex-cli' ? 'Codex CLI' : 'Claude Code CLI',
        state: 'error',
        available: false,
        reason: message,
      })
      getAiStatus()
        .then(setAiStatus)
        .catch(() => undefined)
    }
  }, [aiDraftConfig])

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
      if (target.closest('.reader')) {
        const startX = event.clientX
        const startY = event.clientY
        const onPointerUp = (upEvent: PointerEvent): void => {
          document.removeEventListener('pointerup', onPointerUp, true)
          const dx = upEvent.clientX - startX
          const dy = upEvent.clientY - startY
          const sel = window.getSelection()
          if (Math.hypot(dx, dy) >= 4 || (sel && !sel.isCollapsed)) return
          dismissDraft(activeDraft.id)
          clearSelection()
        }
        document.addEventListener('pointerup', onPointerUp, true)
        return
      }
      dismissDraft(activeDraft.id)
      clearSelection()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [annotations, activeId, dismissDraft, clearSelection])

  // ── Mark click → activate + maybe open modal ───────────────────────────
  const handleMarkClick = useCallback(
    (id: string): void => {
      setRightRailTab('comments')
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
        target: { type: 'selection' },
        thread: [],
        state: 'draft',
        status: 'open',
        history: [],
        created_at: new Date().toISOString(),
        ai_suggestion: null,
      }
      const next = [...annotations, fresh]
      setAnnotations(next)
      setActiveId(fresh.id)
      setRightRailTab('comments')
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
        a.id === id
          ? {
              ...a,
              state: 'discussed' as const,
              instruction,
              ai_suggestion: null,
              thread: [...(a.thread ?? []), threadMessage('rewrite-request', instruction)],
            }
          : a,
      )
      setAnnotations(thinking)
      setBusy((prev) => ({ ...prev, [id]: true }))
      setAiStatus((prev) => (prev ? { ...prev, state: 'running' } : prev))
      persistAnnotations(thinking)

      try {
        const resp = await requestRewrite(
          {
            fullDoc: content,
            items: [{ id, selection: target.anchor.text, instruction }],
          },
          documentSessionId,
        )
        const result = resp.results.find((r) => r.id === id)
        if (!result) {
          throw new Error('rewrite returned no result for this annotation')
        }
        // Merge into the latest annotations snapshot using the functional
        // setter — concurrent edits (delete, lock) are preserved.
        setAnnotations((prev) => {
          const next = prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  ai_suggestion: result.rewritten,
                  thread: [
                    ...(a.thread ?? []),
                    threadMessage('rewrite-result', result.rewritten, 'assistant'),
                  ],
                }
              : a,
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
        getAiStatus()
          .then(setAiStatus)
          .catch(() => undefined)
        setBusy((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    },
    [annotations, content, documentSessionId, persistAnnotations],
  )

  const handleAddNote = useCallback(
    (id: string, text: string): void => {
      const next = annotations.map((a) =>
        a.id === id
          ? {
              ...a,
              state: a.state === 'decided' ? a.state : ('discussed' as const),
              thread: [...(a.thread ?? []), threadMessage('note', text)],
            }
          : a,
      )
      setAnnotations(next)
      persistAnnotations(next)
    },
    [annotations, persistAnnotations],
  )

  const handleDecide = useCallback(
    (id: string, text: string): void => {
      const next = annotations.map((a) =>
        a.id === id
          ? {
              ...a,
              state: 'decided' as const,
              thread: [...(a.thread ?? []), threadMessage('decision', text)],
            }
          : a,
      )
      setAnnotations(next)
      persistAnnotations(next)
    },
    [annotations, persistAnnotations],
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

  const handleTogglePlanItemLocked = useCallback(
    (item: PlanItem): void => {
      const now = new Date().toISOString()
      const status: Exclude<PlanItemStatus, 'stale'> = item.status === 'locked' ? 'open' : 'locked'
      const nextState: PlanItemState = {
        id: item.id,
        status,
        textHash: item.textHash,
        updatedAt: now,
      }
      const exists = planState.some((state) => state.id === item.id)
      const next = exists
        ? planState.map((state) => (state.id === item.id ? nextState : state))
        : [...planState, nextState]
      setPlanState(next)
      persistPlanState(next)
    },
    [planState, persistPlanState],
  )

  const handleSelectPlanItem = useCallback((id: string): void => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-plan-item-id="${cssEscape(id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [])

  const handleCreatePlanItemThread = useCallback(
    (item: PlanItem): void => {
      const existing = annotations.find(
        (annotation) =>
          annotation.status === 'open' &&
          annotation.target?.type === 'plan-item' &&
          annotation.target.planItemId === item.id,
      )
      if (existing) {
        setActiveId(existing.id)
        setRightRailTab('comments')
        return
      }

      const fresh: Annotation = {
        id: makeAnnotationId(),
        anchor: {
          srcStart: item.srcStart,
          srcEnd: item.srcEnd,
          text: content.slice(item.srcStart, item.srcEnd) || item.text,
        },
        target: {
          type: 'plan-item',
          planItemId: item.id,
          kind: item.kind,
          title: item.text,
        },
        thread: [],
        state: 'draft',
        status: 'open',
        history: [],
        created_at: new Date().toISOString(),
        ai_suggestion: null,
      }
      const next = [...annotations, fresh]
      setAnnotations(next)
      setActiveId(fresh.id)
      setRightRailTab('comments')
      persistAnnotations(next)
    },
    [annotations, content, persistAnnotations],
  )

  const planReadiness = useMemo(() => inspectPlan(content, planState, 'auto'), [content, planState])

  const handleNormalizeReview = useCallback(async (): Promise<void> => {
    try {
      setNormalizingReview(true)
      setAiStatus((prev) => (prev ? { ...prev, state: 'running' } : prev))
      const result = await normalizeReviewDocument(content, documentSessionId)
      validateNormalizedReview(content, result.content)
      setPendingReviewNormalization(result.content)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'normalize review failed'
      setError(message)
    } finally {
      setNormalizingReview(false)
      getAiStatus()
        .then(setAiStatus)
        .catch(() => undefined)
    }
  }, [content, documentSessionId])

  const handleApplyReviewNormalization = useCallback(async (): Promise<void> => {
    if (!pendingReviewNormalization) return
    try {
      await saveDocument(pendingReviewNormalization, documentSessionId)
      await savePlanState([], documentSessionId)
      setContent(pendingReviewNormalization)
      setPlanState([])
      setHoveredPlanItemId(undefined)
      setPendingReviewNormalization(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'apply normalized review failed'
      setError(message)
    }
  }, [documentSessionId, pendingReviewNormalization])

  const handleDone = useCallback(async (): Promise<void> => {
    try {
      setClosingSession(true)
      if (documentSessionId) {
        await doneDocumentSession(documentSessionId, content)
      } else {
        await saveDocument(content)
        await closeSession(true)
      }
      setSessionClosed(true)
      window.alert('已完成任务，网页将自动关闭。')
      window.close()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'close session failed'
      setError(message)
      setClosingSession(false)
    }
  }, [content, documentSessionId])

  // ── Modal actions ──────────────────────────────────────────────────────
  // applyRewrite — splice the AI rewrite directly into the markdown source
  // by the stored source-range anchor. The accepted annotation is archived,
  // later anchors shift by the source delta, and overlapping open annotations
  // are dismissed in v1 to avoid applying stale ranges.
  const applyRewrite = useCallback(
    (id: string, lock: boolean): void => {
      const target = annotations.find((a) => a.id === id)
      if (!target || target.ai_suggestion == null) return

      if (!isValidSourceRange(target.anchor, content.length)) {
        setError('anchor source range is invalid')
        return
      }

      const { srcStart, srcEnd } = target.anchor
      const newContent = content.slice(0, srcStart) + target.ai_suggestion + content.slice(srcEnd)

      const rebased = remapAnnotationsAfterSourceRewrite(
        annotations,
        id,
        [srcStart, srcEnd],
        target.ai_suggestion.length,
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
      setActiveId(undefined)

      saveDocument(newContent, documentSessionId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'save document failed'
        setError(message)
      })
      persistAnnotations(next)
    },
    [annotations, content, documentSessionId, persistAnnotations],
  )

  const handleAccept = useCallback((): void => {
    if (decidingModalFor) applyRewrite(decidingModalFor, false)
  }, [decidingModalFor, applyRewrite])

  const handleDiscardRewrite = useCallback((): void => {
    if (decidingModalFor) handleDelete(decidingModalFor)
  }, [decidingModalFor, handleDelete])

  // Close only dismisses the modal. It does not change annotation state:
  // AI-returned cards remain reopenable, and in-flight reprompts keep running.
  const handleCloseModal = useCallback((): void => {
    setDecidingModalFor(null)
  }, [])

  const handleReprompt = useCallback(
    (newInstruction: string): void => {
      const id = decidingModalFor
      if (!id) return
      void handleSubmitInstruction(id, newInstruction)
    },
    [decidingModalFor, handleSubmitInstruction],
  )

  // ── Derived view-state ─────────────────────────────────────────────────
  const decidingAnnotation = decidingModalFor
    ? (annotations.find((a) => a.id === decidingModalFor) ?? null)
    : null
  const modalOpen =
    !!decidingAnnotation &&
    decidingAnnotation.status === 'open' &&
    decidingAnnotation.state === 'discussed'

  const visibleCount = annotations.filter((a) => a.status === 'open').length
  const badgeText =
    planReadiness.summary.mode === 'annotation-only'
      ? `${visibleCount} 批注 · 批注模式`
      : `${visibleCount} 批注 · ${planReadiness.summary.resolved}/${planReadiness.summary.total} reviewed`
  const readinessProgress =
    planReadiness.summary.total === 0
      ? 0
      : Math.round((planReadiness.summary.resolved / planReadiness.summary.total) * 100)
  const headerSignals = planReadiness.items
    .filter((item) => item.status === 'open' || item.status === 'stale')
    .reduce<HeaderSignal[]>((signals, item) => {
      const section = SIGNAL_SECTION_LABELS[item.kind]
      if (!section) return signals
      const existing = signals.find((signal) => signal.id === item.kind)
      const severity = item.status === 'stale' ? 'warning' : 'info'
      if (existing) {
        if (severity === 'warning') existing.severity = 'warning'
        return signals
      }
      signals.push({
        id: item.kind,
        label: `${section} ${item.status === 'stale' ? '需复核' : '未确认'}`,
        severity,
      })
      return signals
    }, [])
  const signalCount = headerSignals.length
  const warningSignalCount = headerSignals.filter((signal) => signal.severity === 'warning').length
  const aiLabel = aiStatus?.label ?? 'AI'
  const aiState = aiStatus?.state ?? 'untested'
  const aiStateLabel =
    aiState === 'ready'
      ? 'Ready'
      : aiState === 'running'
        ? 'Running'
        : aiState === 'testing'
          ? 'Testing'
          : aiState === 'unknown'
            ? 'Unknown'
            : aiState === 'error'
              ? 'Error'
              : 'Untested'
  const aiPanelLocked = aiPanelMode === 'saving' || aiPanelMode === 'testing'

  // Hide popover while a modal is up — otherwise the popover floats over the
  // backdrop and steals clicks meant for cancel.
  const showPopover = !!selectionAnchor && !!selectionRect && !modalOpen

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <strong>scribepad</strong>
          <span>{documentSessionId ? `session ${documentSessionId}` : 'local review'}</span>
        </div>
        <div className="app-file">
          <span className="app-file-label">Document</span>
          <span className="path">{path}</span>
        </div>
        <div className="app-header-metrics" aria-label="文档状态">
          <button
            type="button"
            className={`metric-pill ai-trigger ${aiState}`}
            onClick={() => {
              setAiDraftConfig(aiConfig)
              setAiPanelMode('editing')
              setAiPanelMessage(null)
              setAiPanelOpen(true)
            }}
          >
            <b>AI</b>
            {aiLabel} · {aiStateLabel}
          </button>
          <span className="metric-pill ready">
            <b>{readinessProgress}%</b>
            Readiness
          </span>
          <span className="metric-pill">
            <b>{visibleCount}</b>
            Comments
          </span>
          <div className="signals-menu">
            <button
              type="button"
              className={`metric-pill signals-trigger ${signalCount > 0 ? 'has-signals' : ''}`}
              aria-describedby="header-signals-popover"
            >
              <b>{signalCount}</b>
              Signals
            </button>
            <div
              id="header-signals-popover"
              className="signals-popover"
              role="tooltip"
              aria-label="Review signals"
            >
              <div className="signals-popover-head">
                <strong>Signals</strong>
                <span>
                  {warningSignalCount > 0
                    ? `${warningSignalCount} warnings`
                    : 'No blocking warnings'}
                </span>
              </div>
              {signalCount > 0 ? (
                headerSignals.slice(0, 8).map((signal) => (
                  <div key={signal.id} className={`signal-item ${signal.severity}`}>
                    <strong>{signal.label}</strong>
                  </div>
                ))
              ) : (
                <div className="signals-empty">Review 面板当前没有待处理项。</div>
              )}
            </div>
          </div>
        </div>
        <span className="badge">{badgeText}</span>
        <SessionActions
          session={session}
          closing={closingSession}
          onDone={() => void handleDone()}
        />
        <button type="button" onClick={() => void reload()} aria-label="重新加载">
          ↻
        </button>
      </header>

      {sessionClosed && (
        <div className="session-closed" role="status">
          已完成任务。若浏览器没有自动关闭，请手动关闭此标签页。
        </div>
      )}

      <main className="layout" data-busy-count={Object.keys(busy).length}>
        <Reader
          content={content}
          annotations={annotations}
          planItems={planReadiness.items}
          activeId={activeId}
          highlightedPlanItemId={hoveredPlanItemId}
          onSelectionAnchor={handleSelectionAnchor}
          onCreateAnchor={handleCreateFromAnchor}
          onMarkClick={handleMarkClick}
          onPlanItemClick={handleSelectPlanItem}
        />
        <aside className="right-rail">
          <section className="review-shell">
            <div className="review-tabs" role="tablist" aria-label="右侧面板">
              <button
                type="button"
                role="tab"
                aria-selected={rightRailTab === 'review'}
                className={rightRailTab === 'review' ? 'active' : ''}
                onClick={() => setRightRailTab('review')}
              >
                Review
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightRailTab === 'comments'}
                className={rightRailTab === 'comments' ? 'active' : ''}
                onClick={() => setRightRailTab('comments')}
              >
                Comments <span>{visibleCount}</span>
              </button>
            </div>
            <div className="review-tab-panel" role="tabpanel">
              {rightRailTab === 'review' ? (
                <PlanPanel
                  sections={planReadiness.sections}
                  summary={planReadiness.summary}
                  normalizing={normalizingReview}
                  onSelectItem={handleSelectPlanItem}
                  onHoverItem={setHoveredPlanItemId}
                  onToggleLocked={handleTogglePlanItemLocked}
                  onCreateThread={handleCreatePlanItemThread}
                  onNormalize={() => void handleNormalizeReview()}
                />
              ) : (
                <Sidebar
                  annotations={annotations}
                  activeId={activeId}
                  onSubmitInstruction={(id, instruction) => {
                    void handleSubmitInstruction(id, instruction)
                  }}
                  onAddNote={handleAddNote}
                  onDecide={handleDecide}
                  onLock={handleLock}
                  onUnlock={handleUnlock}
                  onDelete={handleDelete}
                  onOpenModal={handleOpenModal}
                />
              )}
            </div>
          </section>
        </aside>
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

      {aiPanelOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!aiPanelLocked) closeAiPanel()
          }}
        >
          <section
            className="ai-config-modal"
            role="dialog"
            aria-modal="true"
            aria-label="AI 配置"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="ai-config-head">
              <div>
                <span>AI Assistant</span>
                <strong>{`${aiStatus.label} · ${aiStateLabel}`}</strong>
              </div>
              <button
                type="button"
                aria-label="关闭 AI 配置"
                onClick={closeAiPanel}
                disabled={aiPanelLocked}
              >
                ✕
              </button>
            </div>

            <div className="ai-provider-options" role="radiogroup" aria-label="AI Provider">
              <button
                type="button"
                className={aiDraftConfig.provider === 'codex-cli' ? 'selected' : ''}
                disabled={aiPanelLocked}
                onClick={() => setAiDraftConfig({ ...aiDraftConfig, provider: 'codex-cli' })}
              >
                <strong>Codex CLI</strong>
                <span>{aiStatus.provider === 'codex-cli' ? aiStateLabel : '可选'}</span>
              </button>
              <button
                type="button"
                className={aiDraftConfig.provider === 'claude-code-cli' ? 'selected' : ''}
                disabled={aiPanelLocked}
                onClick={() => setAiDraftConfig({ ...aiDraftConfig, provider: 'claude-code-cli' })}
              >
                <strong>Claude Code</strong>
                <span>{aiStatus.provider === 'claude-code-cli' ? aiStateLabel : '可选'}</span>
              </button>
            </div>

            <div className="ai-config-grid">
              {aiDraftConfig.provider === 'codex-cli' ? (
                <>
                  <label className="ai-config-field">
                    <span>Codex command</span>
                    <input
                      disabled={aiPanelLocked}
                      value={aiDraftConfig.codex.command}
                      onChange={(event) =>
                        setAiDraftConfig({
                          ...aiDraftConfig,
                          codex: { ...aiDraftConfig.codex, command: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="ai-config-field">
                    <span>Codex model</span>
                    <input
                      disabled={aiPanelLocked}
                      value={aiDraftConfig.codex.model}
                      onChange={(event) =>
                        setAiDraftConfig({
                          ...aiDraftConfig,
                          codex: { ...aiDraftConfig.codex, model: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="ai-config-field">
                    <span>Reasoning</span>
                    <select
                      disabled={aiPanelLocked}
                      value={aiDraftConfig.codex.reasoningEffort}
                      onChange={(event) =>
                        setAiDraftConfig({
                          ...aiDraftConfig,
                          codex: {
                            ...aiDraftConfig.codex,
                            reasoningEffort: event.target
                              .value as AiConfig['codex']['reasoningEffort'],
                          },
                        })
                      }
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="xhigh">xhigh</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="ai-config-field">
                    <span>Claude command</span>
                    <input
                      disabled={aiPanelLocked}
                      value={aiDraftConfig.claude.command}
                      onChange={(event) =>
                        setAiDraftConfig({
                          ...aiDraftConfig,
                          claude: { ...aiDraftConfig.claude, command: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="ai-config-field">
                    <span>Claude args</span>
                    <input
                      disabled={aiPanelLocked}
                      value={aiDraftConfig.claude.args.join(' ')}
                      onChange={(event) =>
                        setAiDraftConfig({
                          ...aiDraftConfig,
                          claude: {
                            ...aiDraftConfig.claude,
                            args: event.target.value.split(/\s+/).filter(Boolean),
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label className="ai-config-field">
                <span>Timeout seconds</span>
                <input
                  disabled={aiPanelLocked}
                  type="number"
                  min={10}
                  value={Math.round(aiDraftConfig.timeoutMs / 1000)}
                  onChange={(event) =>
                    setAiDraftConfig({
                      ...aiDraftConfig,
                      timeoutMs: Math.max(10, Number(event.target.value) || 10) * 1000,
                    })
                  }
                />
              </label>
            </div>

            {aiPanelMessage && (
              <div className={`ai-config-message ${aiPanelMode}`}>{aiPanelMessage}</div>
            )}

            {(aiLoadError || aiStatus.reason) && !aiPanelMessage && (
              <div className="ai-config-error">{aiLoadError ?? aiStatus.reason}</div>
            )}

            <div className="ai-config-actions">
              <button
                type="button"
                onClick={() => void handleSaveAiConfig()}
                disabled={aiPanelLocked}
              >
                {aiPanelMode === 'saving' ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleSaveAndTestAiConfig()}
                disabled={aiPanelLocked}
              >
                {aiPanelMode === 'testing' ? '测试中…' : '保存并测试'}
              </button>
            </div>
          </section>
        </div>
      )}

      <DiffModal
        isOpen={modalOpen}
        annotation={decidingAnnotation}
        onAccept={handleAccept}
        onCancel={handleCloseModal}
        onDiscard={handleDiscardRewrite}
        onReprompt={handleReprompt}
      />

      {pendingReviewNormalization && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingReviewNormalization(null)}
        >
          <section
            className="review-normalize-modal"
            role="dialog"
            aria-modal="true"
            aria-label="规范化文档预览"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="review-normalize-modal-head">
              <div>
                <span>Normalize Preview</span>
                <strong>确认后才会写回文档</strong>
              </div>
              <button
                type="button"
                aria-label="关闭规范化预览"
                onClick={() => setPendingReviewNormalization(null)}
              >
                ✕
              </button>
            </div>
            <pre className="review-normalize-preview">{pendingReviewNormalization}</pre>
            <div className="review-normalize-actions">
              <button type="button" onClick={() => setPendingReviewNormalization(null)}>
                取消
              </button>
              <button type="button" onClick={() => void handleApplyReviewNormalization()}>
                应用到文档
              </button>
            </div>
          </section>
        </div>
      )}

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
