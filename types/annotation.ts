/**
 * Annotation v2 schema — paragraph-level state machine + audit trail.
 *
 * Used by v0.2 (state machine) and prepared for v0.3 (audit trail UI / multi-agent).
 * Defined in this sprint, not yet wired into runtime — sidecar IO still treats
 * unknown fields opaquely so older sidecars are forward-compatible until v0.2 lands.
 */

export type AnnotationState =
  | 'draft' // 默认,刚创建
  | 'discussed' // 讨论中
  | 'decided' // 已决定(防 AI 漂移)
  | 'executed' // 已执行(plan→exec 闭环)

export type AnnotationStatus =
  | 'open' // 当前活跃
  | 'applied' // AI 改写已应用,本批注归档
  | 'dismissed' // 用户主动弃

export type AnnotationTemplateHint = 'plan' | 'design' | 'research' | 'analysis'

/**
 * Anchor — locates a selection in the markdown source.
 * srcStart/srcEnd are character offsets into the markdown source string.
 * `text` is the rendered text at creation time, used for stale detection
 * when source has been edited externally.
 */
export interface Anchor {
  srcStart: number
  srcEnd: number
  text: string
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
  instruction?: string
  ai_suggestion?: string | null
  state: AnnotationState
  status: AnnotationStatus
  history: AuditEntry[]
  template_hint?: AnnotationTemplateHint
  created_at: string
}

/**
 * Sidecar — the on-disk format `.{filename}.annotations.json`.
 * version=2 introduces state/history/template_hint; v1 sidecars (without state)
 * will be migrated by reading code in v0.2 (TBD strategy).
 */
export interface Sidecar {
  version: 2
  annotations: Annotation[]
}
