/**
 * Annotation v0.2 schema — block-scoped, sentence-level anchor.
 *
 * Anchor carries:
 *   - blockId        — addresses a leaf block (paragraph / heading / code)
 *   - sentence range — start/end sentence index within that block
 *   - optional char range — sub-sentence span when start === end
 *
 * This shape forbids cross-block anchors by construction (one blockId only).
 * v0.1's `srcStart/srcEnd` global offsets are removed; sample sidecar must
 * be cleaned before this version mounts.
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

/**
 * Anchor — locates an annotation within a single leaf block (paragraph,
 * heading, or code). Cross-block anchors are not representable.
 *
 * Shapes:
 *   - whole sentence(s):  charStart/charEnd undefined; start ≤ end
 *   - sub-sentence phrase: start === end, charStart < charEnd, both in [0, sentenceLen]
 *
 * `text` is the rendered text captured at creation time, used both for
 * display in the sidebar and for stale detection if the source has drifted.
 */
export interface Anchor {
  blockId: string
  startSentenceIdx: number
  endSentenceIdx: number
  charStart?: number
  charEnd?: number
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
 * version=3 ships with the v0.2 sentence-level anchor; v1/v2 sidecars are
 * not migrated (sample is wiped during the v0.2 rebuild).
 */
export interface Sidecar {
  version: 3
  annotations: Annotation[]
}
