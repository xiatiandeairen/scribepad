/**
 * DiffModal — deciding-state modal for reviewing AI rewrite suggestions.
 *
 * Renders the deciding-state decision panel:
 * Focused rewrite review panel: title + close, AI text as the main content,
 * original text as one muted line, and a single-line action bar.
 *
 * Keyboard:
 *   Esc       → onCancel
 *   Enter     → onAccept (outside the input)
 *   Cmd+Enter → onAccept
 *   Enter     → onReprompt (inside the input, when non-empty)
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
  onCancel: () => void
  onReprompt: (newInstruction: string) => void
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
  const { isOpen, annotation, onAccept, onCancel, onReprompt } = props

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
        onAccept()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onAccept, onCancel])

  const oldText = annotation?.anchor.text ?? ''
  const newText = annotation?.ai_suggestion ?? ''

  const diff = useMemo(() => splitDiff(oldText, newText), [oldText, newText])
  const isAnalyzing = annotation != null && annotation.ai_suggestion == null
  const suggestionSizeClass =
    isAnalyzing || diff.newLine.length < 80
      ? 'compact'
      : diff.newLine.length > 240
        ? 'long'
        : 'normal'

  if (!isOpen || !annotation) {
    return null
  }

  const handleReprompt = () => {
    const v = repromptText.trim()
    if (!v) return
    setRepromptText('')
    onReprompt(v)
  }

  const handleRepromptKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleReprompt()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className={`diff-modal ${suggestionSizeClass}`}
        role="dialog"
        aria-modal="true"
        aria-label="改写建议"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="diff-modal-header">
          <span className="title">改写建议</span>
          <button className="close-btn" onClick={onCancel} aria-label="关闭，Esc">
            ✕
          </button>
        </div>

        <div className="diff-modal-body">
          <div className="modal-section diff-section">
            <div className="diff-block">
              <div className={`row-add ${isAnalyzing ? 'analyzing' : ''}`}>
                {isAnalyzing ? (
                  <span className="analysis-status">
                    正在分析中
                    <span className="spinner-dots" />
                  </span>
                ) : (
                  diff.newLine
                )}
              </div>
              <div className="row-del">{diff.oldLine}</div>
            </div>
          </div>

          <div className="modal-section reprompt-section">
            <div className="reprompt">
              <textarea
                rows={1}
                placeholder="继续修改..."
                value={repromptText}
                onChange={(e) => setRepromptText(e.target.value)}
                onKeyDown={handleRepromptKey}
              />
              <button
                className="reprompt-submit"
                onClick={handleReprompt}
                disabled={isAnalyzing || repromptText.trim().length === 0}
              >
                提交 <span className="kbd">Enter</span>
              </button>
              <button className="primary" onClick={onAccept} disabled={isAnalyzing}>
                接受 <span className="kbd">⌘↵</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
