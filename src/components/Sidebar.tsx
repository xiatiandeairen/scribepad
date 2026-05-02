/**
 * Sidebar — annotation list rendered as 2-row cards, one per state.
 *
 * Renders a card for each `status === 'open'` annotation. Cards expose four
 * visual variants tied to the v0.2 state machine (see docs/plan.md §1.4):
 *
 *   draft               → input + ↵ submit (user types instruction for AI)
 *   discussed (no AI)   → ⏳ thinking spinner (AI rewrite in flight)
 *   discussed (with AI) → ✏️ AI returned + 查看 → button (open DiffModal)
 *   decided             → 🔒 locked, AI skip
 *
 * Plan.md uses transitional names "thinking"/"deciding"; both map to the
 * persistent `discussed` state, distinguished here by ai_suggestion presence.
 *
 * The component is presentational: all state mutations are forwarded to
 * callbacks supplied by the parent App coordinator. No api/* imports.
 */
import { useState, type KeyboardEvent } from 'react'
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
  if (variant === 'deciding') classes.push('deciding')
  if (variant === 'decided') classes.push('decided')
  if (props.isActive) classes.push('active')

  return (
    <div className={classes.join(' ')} data-anno-id={anno.id}>
      <div className="head">
        <div className="text">{anno.anchor.text}</div>
        <button
          type="button"
          className="menu-btn"
          aria-label="更多操作"
          // v0.1: render-only; popup menu logic deferred to v0.2+ UX polish.
        >
          ⋯
        </button>
      </div>
      {variant === 'draft' && <DraftRow anno={anno} onSubmit={props.onSubmitInstruction} />}
      {variant === 'thinking' && <div className="status-line thinking">⏳ claude 思考中…</div>}
      {variant === 'deciding' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="status-line deciding">✏️ AI 已返回</span>
          <button type="button" className="primary" onClick={() => props.onOpenModal(anno.id)}>
            查看 →
          </button>
        </div>
      )}
      {variant === 'decided' && <div className="status-line">🔒 已锁定 · AI 跳过</div>}
    </div>
  )
}

function DraftRow(props: {
  anno: Annotation
  onSubmit: (id: string, instruction: string) => void
}): JSX.Element {
  // Local draft text per card; persists across re-renders until parent
  // transitions the card out of draft.
  const [text, setText] = useState<string>(props.anno.instruction ?? '')

  const submit = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    props.onSubmit(props.anno.id, value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="row">
      <input
        type="text"
        placeholder="告诉 AI 怎么改…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="primary" onClick={submit}>
        ↵
      </button>
    </div>
  )
}

type CardVariant = 'draft' | 'thinking' | 'deciding' | 'decided'

/**
 * Map persistent annotation state → card variant.
 *
 * `discussed` splits into thinking vs deciding based on whether the AI
 * suggestion has arrived yet. `executed` shouldn't appear here in practice
 * (status flips to 'applied' on accept), but we render it as decided to be
 * defensive against transient writes.
 */
function pickVariant(anno: Annotation): CardVariant {
  switch (anno.state) {
    case 'draft':
      return 'draft'
    case 'discussed':
      return anno.ai_suggestion ? 'deciding' : 'thinking'
    case 'decided':
      return 'decided'
    case 'executed':
      return 'decided'
  }
}
