/**
 * Sidebar — annotation list rendered as 2-row cards, one per state.
 *
 * Renders a card for each `status === 'open'` annotation. Cards expose four
 * visual variants tied to the v0.2 state machine (see docs/plan.md §1.4):
 *
 *   draft               → autosizing textarea + floating confirm/cancel actions
 *   discussed (no AI)   → one-line "codex thinking"
 *   discussed (with AI) → one-line "AI returned"; click card opens DiffModal
 *   decided             → 🔒 locked, AI skip
 *
 * Plan.md uses transitional names "thinking"/"deciding"; both map to the
 * persistent `discussed` state, distinguished here by ai_suggestion presence.
 *
 * The component is presentational: all state mutations are forwarded to
 * callbacks supplied by the parent App coordinator. No api/* imports.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import type { Annotation } from '../../types/annotation'

export interface SidebarProps {
  annotations: Annotation[]
  activeId?: string | undefined
  onSubmitInstruction: (id: string, instruction: string) => void
  onLock: (id: string) => void
  onUnlock: (id: string) => void
  onDelete: (id: string) => void
  onOpenModal: (id: string) => void
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const visible = props.annotations.filter(
    (a) => a.status !== 'applied' && a.status !== 'dismissed',
  )

  if (visible.length === 0) {
    return (
      <aside className="sidebar">
        <div className="empty">📝 选中正文文字 以创建批注</div>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      {visible.map((anno) => (
        <AnnotationCard
          key={anno.id}
          anno={anno}
          isActive={props.activeId === anno.id}
          onSubmitInstruction={props.onSubmitInstruction}
          onLock={props.onLock}
          onUnlock={props.onUnlock}
          onDelete={props.onDelete}
          onOpenModal={props.onOpenModal}
        />
      ))}
    </aside>
  )
}

interface CardProps {
  anno: Annotation
  isActive: boolean
  onSubmitInstruction: (id: string, instruction: string) => void
  onLock: (id: string) => void
  onUnlock: (id: string) => void
  onDelete: (id: string) => void
  onOpenModal: (id: string) => void
}

function AnnotationCard(props: CardProps): JSX.Element {
  const { anno } = props
  const variant = pickVariant(anno)

  // Card-level class: base, variant tint (deciding/decided), and active highlight.
  const classes = ['anno-card']
  if (variant === 'draft') classes.push('draft')
  if (variant === 'deciding') classes.push('deciding')
  if (variant === 'decided') classes.push('decided')
  if (props.isActive) classes.push('active')

  const handleCardClick = (): void => {
    if (variant === 'deciding') props.onOpenModal(anno.id)
  }

  return (
    <div
      className={classes.join(' ')}
      data-anno-id={anno.id}
      onClick={handleCardClick}
      role={variant === 'deciding' ? 'button' : undefined}
      tabIndex={variant === 'deciding' ? 0 : undefined}
      onKeyDown={(e) => {
        if (variant !== 'deciding') return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onOpenModal(anno.id)
        }
      }}
    >
      {variant === 'draft' ? (
        <DraftRow anno={anno} onSubmit={props.onSubmitInstruction} onCancel={props.onDelete} />
      ) : (
        <div className="head">
          {variant === 'thinking' && <span className="status-line thinking">codex 思考中…</span>}
          {variant === 'deciding' && <span className="status-line deciding">AI 已返回</span>}
          {variant === 'decided' && <span className="status-line">已锁定</span>}
        </div>
      )}
    </div>
  )
}

function DraftRow(props: {
  anno: Annotation
  onSubmit: (id: string, instruction: string) => void
  onCancel: (id: string) => void
}): JSX.Element {
  // Local draft text per card; persists across re-renders until parent
  // transitions the card out of draft.
  const [text, setText] = useState<string>(props.anno.instruction ?? '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = (): void => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  const submit = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    props.onSubmit(props.anno.id, value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="draft-row">
      <textarea
        ref={(el) => {
          textareaRef.current = el
          resize()
        }}
        rows={1}
        placeholder="告诉 AI 怎么改…"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          requestAnimationFrame(resize)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="draft-actions" aria-label="批注操作">
        <button
          type="button"
          className="icon-action confirm"
          aria-label="提交批注"
          onClick={submit}
        >
          ✓
        </button>
        <button
          type="button"
          className="icon-action cancel"
          aria-label="取消批注"
          onClick={() => props.onCancel(props.anno.id)}
        >
          ×
        </button>
      </div>
    </div>
  )
}

type CardVariant = 'draft' | 'thinking' | 'deciding' | 'decided'

/**
 * Map persistent annotation state → card variant.
 *
 * `discussed` splits into thinking vs deciding based on whether the AI
 * suggestion has arrived yet.
 */
function pickVariant(anno: Annotation): CardVariant {
  switch (anno.state) {
    case 'draft':
      return 'draft'
    case 'discussed':
      return anno.ai_suggestion ? 'deciding' : 'thinking'
    case 'decided':
      return 'decided'
  }
}
