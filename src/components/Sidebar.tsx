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
import type { Annotation, ThreadMessage, ThreadMessageKind } from '../../types/annotation'

export interface SidebarProps {
  annotations: Annotation[]
  activeId?: string | undefined
  onSubmitInstruction: (id: string, instruction: string) => void
  onAddNote: (id: string, text: string) => void
  onDecide: (id: string, text: string) => void
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
          onAddNote={props.onAddNote}
          onDecide={props.onDecide}
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
  onAddNote: (id: string, text: string) => void
  onDecide: (id: string, text: string) => void
  onLock: (id: string) => void
  onUnlock: (id: string) => void
  onDelete: (id: string) => void
  onOpenModal: (id: string) => void
}

function AnnotationCard(props: CardProps): JSX.Element {
  const { anno } = props
  const variant = pickVariant(anno)
  const [expanded, setExpanded] = useState(() => props.isActive || variant === 'draft')

  // Card-level class: base, variant tint (deciding/decided), and active highlight.
  const classes = ['anno-card']
  if (variant === 'draft') classes.push('draft')
  if (variant === 'deciding') classes.push('deciding')
  if (variant === 'decided') classes.push('decided')
  if (props.isActive) classes.push('active')

  return (
    <div
      className={classes.join(' ')}
      data-anno-id={anno.id}
      onClick={(event) => {
        if (variant !== 'deciding') return
        const target = event.target as HTMLElement | null
        if (target?.closest('button, textarea')) return
        props.onOpenModal(anno.id)
      }}
    >
      <button
        type="button"
        className="anno-card-summary"
        aria-expanded={expanded}
        onClick={() => {
          if (variant === 'deciding') {
            props.onOpenModal(anno.id)
            return
          }
          setExpanded((current) => !current)
        }}
      >
        <span className="anno-card-title">{titleFor(anno)}</span>
        <span className={`status-line ${variant}`}>{variantLabel(variant)}</span>
      </button>
      <p className="anno-card-excerpt">{latestSummary(anno)}</p>
      {expanded && (
        <>
          <ThreadTimeline anno={anno} />
          {variant === 'deciding' && (
            <button
              type="button"
              className="thread-review-diff"
              onClick={() => props.onOpenModal(anno.id)}
            >
              Review diff
            </button>
          )}
          {variant !== 'decided' && (
            <ThreadComposer
              anno={anno}
              onSubmitInstruction={props.onSubmitInstruction}
              onAddNote={props.onAddNote}
              onDecide={props.onDecide}
              onCancel={props.onDelete}
            />
          )}
          {variant === 'decided' && (
            <div className="actions-row">
              <button type="button" onClick={() => props.onUnlock(anno.id)}>
                解除锁定
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ThreadComposer(props: {
  anno: Annotation
  onSubmitInstruction: (id: string, instruction: string) => void
  onAddNote: (id: string, text: string) => void
  onDecide: (id: string, text: string) => void
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

  const submitRewrite = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    props.onSubmitInstruction(props.anno.id, value)
    setText('')
  }

  const submitNote = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    props.onAddNote(props.anno.id, value)
    setText('')
  }

  const submitDecision = (): void => {
    const value = text.trim()
    if (value.length === 0) return
    props.onDecide(props.anno.id, value)
    setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submitRewrite()
    }
  }

  return (
    <div className="draft-row thread-composer">
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
          aria-label="追加 note"
          onClick={submitNote}
        >
          N
        </button>
        <button
          type="button"
          className="icon-action confirm"
          aria-label="请求 AI 改写"
          onClick={submitRewrite}
        >
          AI
        </button>
        <button
          type="button"
          className="icon-action confirm"
          aria-label="写成决定并锁定"
          onClick={submitDecision}
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

function ThreadTimeline(props: { anno: Annotation }): JSX.Element {
  const messages = messagesFor(props.anno)
  if (messages.length === 0) {
    return <div className="thread-empty">还没有 thread 记录。</div>
  }

  return (
    <div className="thread-timeline">
      {messages.map((message) => (
        <div key={message.id} className={`thread-message ${message.kind}`}>
          <div className="thread-message-meta">
            <span>{messageKindLabel(message.kind)}</span>
            <time dateTime={message.created_at}>{shortTime(message.created_at)}</time>
          </div>
          <p>{messageText(message)}</p>
        </div>
      ))}
    </div>
  )
}

function messagesFor(anno: Annotation): ThreadMessage[] {
  const messages = [...(anno.thread ?? [])]
  if (messages.length === 0 && anno.instruction) {
    messages.push(
      legacyMessage('legacy-instruction', 'rewrite-request', anno.instruction, anno.created_at),
    )
  }
  if (messages.length === 0 && anno.ai_suggestion) {
    messages.push(
      legacyMessage('legacy-suggestion', 'rewrite-result', anno.ai_suggestion, anno.created_at),
    )
  }
  return messages
}

function legacyMessage(
  id: string,
  kind: ThreadMessageKind,
  text: string,
  createdAt: string,
): ThreadMessage {
  return {
    id,
    role: kind === 'rewrite-result' ? 'assistant' : 'user',
    kind,
    text,
    created_at: createdAt,
  }
}

function titleFor(anno: Annotation): string {
  if (anno.target?.type === 'plan-item')
    return `${kindLabel(anno.target.kind)} · ${anno.target.title}`
  return '选区批注'
}

function latestSummary(anno: Annotation): string {
  const messages = messagesFor(anno)
  const latest = messages[messages.length - 1]
  return messageText(latest).replace(/\s+/g, ' ').trim()
}

function messageText(message: ThreadMessage | undefined): string {
  if (!message) return '还没有 thread 记录。'
  if (message.kind === 'rewrite-result') return 'AI 已生成改写建议'
  return message.text
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    goal: '目标',
    scope: '范围',
    behavior: '方案',
    verification: '验收',
    'open-question': '待确认',
  }
  return labels[kind] ?? kind
}

function messageKindLabel(kind: ThreadMessageKind): string {
  const labels: Record<ThreadMessageKind, string> = {
    note: 'Note',
    question: 'Question',
    'rewrite-request': 'Rewrite',
    'rewrite-result': 'AI',
    decision: 'Decision',
  }
  return labels[kind]
}

function shortTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

function variantLabel(variant: CardVariant): string {
  switch (variant) {
    case 'draft':
      return 'Open'
    case 'thinking':
      return 'codex 思考中…'
    case 'deciding':
      return 'AI 已返回'
    case 'decided':
      return '已锁定'
  }
}
