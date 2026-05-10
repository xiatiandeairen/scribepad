export type PlanItemKind =
  | 'goal'
  | 'scope'
  | 'behavior'
  | 'task'
  | 'verification'
  | 'risk'
  | 'decision'
  | 'open-question'

export type PlanItemStatus = 'open' | 'locked' | 'stale'

export type ReviewMode = 'auto' | 'structured' | 'lightweight' | 'annotation-only'

export type EffectiveReviewMode = Exclude<ReviewMode, 'auto'>

export interface PlanItem {
  id: string
  kind: PlanItemKind
  title: string
  text: string
  textHash: string
  blockId: string
  srcStart: number
  srcEnd: number
  status: PlanItemStatus
}

export interface PlanItemState {
  id: string
  status: Exclude<PlanItemStatus, 'stale'>
  textHash: string
  updatedAt: string
}

export interface PlanReadinessIssue {
  id: string
  severity: 'warning' | 'info'
  text: string
  itemId?: string
}

export interface PlanReadinessSummary {
  mode: EffectiveReviewMode
  total: number
  resolved: number
  locked: number
  byKind: Record<PlanItemKind, number>
  issues: PlanReadinessIssue[]
}
