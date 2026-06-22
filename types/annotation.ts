import type { PlanItemKind, PlanItemState } from './plan.js'

/**
 * Annotation schema — source-range anchor.
 *
 * Anchor carries an absolute markdown source range plus the selected text
 * captured at creation time. There is no block/sentence anchor compatibility
 * in this model.
 */

export type AnnotationState =
  | 'draft' // 默认,刚创建
  | 'discussed' // 讨论中
  | 'decided' // 已决定(防 AI 漂移)

export type AnnotationStatus =
  | 'open' // 当前活跃
  | 'applied' // AI 改写已应用,本批注归档
  | 'dismissed' // 用户主动弃

export type AnnotationTemplateHint = 'plan' | 'design' | 'research' | 'analysis'

export interface Anchor {
  srcStart: number
  srcEnd: number
  text: string
}

export type AnnotationTarget =
  | { type: 'selection' }
  | { type: 'plan-item'; planItemId: string; kind: PlanItemKind; title: string }

export type ThreadMessageRole = 'user' | 'assistant' | 'system'

export type ThreadMessageKind =
  | 'note'
  | 'question'
  | 'rewrite-request'
  | 'rewrite-result'
  | 'decision'

export interface ThreadMessage {
  id: string
  role: ThreadMessageRole
  kind: ThreadMessageKind
  text: string
  created_at: string
  agent?: string
  diff?: { before: string; after: string }
}

/**
 * AuditEntry — one row in an annotation's history log.
 * Captures the action, who did it, and (for rewrites) the diff.
 */
export interface AuditEntry {
  ts: string // ISO 8601
  action: 'create' | 'rewrite' | 'state-change' | 'apply' | 'dismiss'
  agent?: string // 'claude' | 'cursor' | 'aider' | ...
  instruction?: string
  diff?: { before: string; after: string }
}

export interface Annotation {
  id: string
  anchor: Anchor
  target?: AnnotationTarget
  thread?: ThreadMessage[]
  instruction?: string
  ai_suggestion?: string | null
  state: AnnotationState
  status: AnnotationStatus
  history: AuditEntry[]
  template_hint?: AnnotationTemplateHint
  created_at: string
}

export interface Sidecar {
  version: 4
  docPath?: string
  docRelativePath?: string
  annotations: Annotation[]
  planState?: PlanItemState[]
}
