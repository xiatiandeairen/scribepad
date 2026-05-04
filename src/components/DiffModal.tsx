/**
 * DiffModal — deciding-state modal for reviewing AI rewrite suggestions.
 *
 * Renders the upgraded design from preview/style-preview.html (状态 5b):
 * header w/ meta tags, instruction echo, diff block, delta stats,
 * reprompt input, footer w/ 3 actions.
 *
 * Keyboard:
 *   Esc       → onCancel
 *   Enter     → onAccept
 *   Cmd+Enter → onAcceptAndLock
 */
import { useEffect, useMemo, useState } from 'react'
import type { Annotation } from '../../types/annotation'

export interface DiffModalProps {
  isOpen: boolean
  annotation: Annotation | null
  agentName?: string
  elapsedSeconds?: number
  attempt?: number
  onAccept: () => void
  onAcceptAndLock: () => void
  onCancel: () => void
  onReprompt: (newInstruction: string) => void
}

/** Simple word counter — splits on whitespace and CJK char boundaries. */
function countWords(s: string): number {
  if (!s) return 0
  // Whitespace-separated tokens + each CJK character counts as 1 word.
  const ascii = s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim()
  const asciiWords = ascii ? ascii.split(/\s+/).length : 0
  const cjkChars = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  return asciiWords + cjkChars
}

/** Find tokens shared by both strings (whitespace + CJK). */
function sharedTokens(a: string, b: string): string[] {
  const tokenize = (s: string): string[] => {
    const out: string[] = []
    // ASCII word tokens
    const asciiMatches = s.match(/[A-Za-z][A-Za-z0-9_-]+/g)
    if (asciiMatches) out.push(...asciiMatches)
    // CJK runs of length >=2
    const cjkRuns = s.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g)
    if (cjkRuns) out.push(...cjkRuns)
    return out
  }
  const aSet = new Set(tokenize(a))
  const seen = new Set<string>()
  const out: string[] = []
  for (const tok of tokenize(b)) {
    if (aSet.has(tok) && !seen.has(tok)) {
      seen.add(tok)
      out.push(tok)
    }
  }
  return out.slice(0, 5)
}

interface DiffSplit {
  oldLine: string
  newLine: string
}

/**
 * splitDiff — v0.1 keeps it line-level. Selections are typically a single
 * line, so render old/new as one row each. Future versions may upgrade
 * to per-token diffing.
 */
function splitDiff(oldText: string, newText: string): DiffSplit {
  return {
    oldLine: oldText.replace(/\n+/g, ' ').trim(),
    newLine: newText.replace(/\n+/g, ' ').trim(),
  }
}

export function DiffModal(props: DiffModalProps) {
  const {
    isOpen,
    annotation,
    agentName = 'codex',
    elapsedSeconds,
    attempt,
    onAccept,
    onAcceptAndLock,
    onCancel,
    onReprompt,
  } = props

  const [repromptText, setRepromptText] = useState('')

  // Reset reprompt input each time a new annotation is shown.
  useEffect(() => {
    setRepromptText('')
  }, [annotation?.id])

  // Keyboard shortcuts — only active while open.
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        // Don't hijack Enter while user is typing in the reprompt input —
        // that field has its own onKeyDown handler.
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return
        }
        e.preventDefault()
        if (e.metaKey || e.ctrlKey) {
          onAcceptAndLock()
        } else {
          onAccept()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onAccept, onAcceptAndLock, onCancel])

  const oldText = annotation?.anchor.text ?? ''
  const newText = annotation?.ai_suggestion ?? ''

  const diff = useMemo(() => splitDiff(oldText, newText), [oldText, newText])
  const charDelta = newText.length - oldText.length
  const wordDelta = countWords(newText) - countWords(oldText)
  const kept = useMemo(() => sharedTokens(oldText, newText), [oldText, newText])

  if (!isOpen || !annotation || annotation.ai_suggestion == null) {
    return null
  }

  const fmtDelta = (n: number, unit: string): string => {
    if (n === 0) return `± ${unit} 0`
    const sign = n > 0 ? '▲' : '▼'
    const num = n > 0 ? `+${n}` : `${n}`
    return `${sign} ${unit} ${num}`
  }

  const deltaClass = (n: number): string => (n < 0 ? 'stat shrink' : n > 0 ? 'stat grow' : 'stat')

  const handleReprompt = () => {
    const v = repromptText.trim()
    if (!v) return
    onReprompt(v)
  }

  const handleRepromptKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleReprompt()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 改写预览"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="diff-modal-header">
          <span className="title">✏️ AI 改写预览</span>
          <span className="meta-tag">{agentName}</span>
          {elapsedSeconds != null && <span className="meta-tag">{elapsedSeconds}s</span>}
          {attempt != null && <span className="meta-tag">第 {attempt} 次</span>}
          <button className="close-btn" onClick={onCancel} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="diff-modal-body">
          {annotation.instruction && (
            <div className="modal-section">
              <div className="label">💬 你的指令</div>
              <div className="instruction-box">{annotation.instruction}</div>
            </div>
          )}

          <div className="modal-section">
            <div className="label">📝 变化</div>
            <div className="diff-block">
              <div className="row-del">
                <span className="row-prefix">−</span>
                {diff.oldLine}
              </div>
              <div className="row-add">
                <span className="row-prefix">+</span>
                {diff.newLine}
              </div>
            </div>
            <div className="delta-stats">
              <span className={deltaClass(charDelta)}>{fmtDelta(charDelta, '字符')}</span>
              <span className={deltaClass(wordDelta)}>{fmtDelta(wordDelta, '词')}</span>
              {kept.length > 0 && (
                <span className="stat">保留:{kept.map((t) => `"${t}"`).join(', ')}</span>
              )}
            </div>
          </div>

          <div className="modal-section">
            <div className="label">💭 不满意?换个说法再试</div>
            <div className="reprompt">
              <span className="reprompt-prefix">改</span>
              <input
                type="text"
                placeholder="再压缩到 15 字以内 / 用主动语态 / ..."
                value={repromptText}
                onChange={(e) => setRepromptText(e.target.value)}
                onKeyDown={handleRepromptKey}
              />
              <button onClick={handleReprompt}>↻ 再写</button>
            </div>
          </div>
        </div>

        <div className="diff-modal-footer">
          <span className="footer-meta">段 #{annotation.id} · sample.md</span>
          <div className="footer-actions">
            <button onClick={onCancel}>
              <span className="kbd">Esc</span>取消
            </button>
            <button className="primary" onClick={onAccept}>
              <span className="kbd" style={{ color: 'rgba(255,255,255,0.7)' }}>
                ↵
              </span>
              接受
            </button>
            <button className="primary" onClick={onAcceptAndLock}>
              <span className="kbd" style={{ color: 'rgba(255,255,255,0.7)' }}>
                ⌘↵
              </span>
              接受 + 拍板
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
