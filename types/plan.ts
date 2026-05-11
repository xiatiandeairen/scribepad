export type PlanItemKind = 'goal' | 'scope' | 'behavior' | 'verification' | 'open-question'

export type PlanItemStatus = 'open' | 'locked' | 'stale'

export type ReviewNodeRole = 'checkpoint' | 'detail'

export type ReviewMode = 'auto' | 'structured' | 'annotation-only'

export type EffectiveReviewMode = Exclude<ReviewMode, 'auto'>

export type ReviewStructureQuality = 'ready' | 'partial' | 'unavailable'

export interface PlanItem {
  id: string
  kind: PlanItemKind
  title: string
  sectionTitle?: string
  sectionOrder?: number
  groupTitle?: string
  groupOrder?: number
  itemOrder?: number
  depth?: number
  role: ReviewNodeRole
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

export interface PlanReviewGroup {
  id: string
  title: string
  sectionKind: PlanItemKind
  sectionTitle: string
  order: number
  checkpoint?: PlanItem | undefined
  items: PlanItem[]
  details: PlanItem[]
}

export interface PlanReviewSection {
  id: string
  kind: PlanItemKind
  title: string
  order: number
  items: PlanItem[]
  details: PlanItem[]
  groups: PlanReviewGroup[]
  total: number
  locked: number
  open: number
  stale: number
}

export interface PlanReadinessIssue {
  id: string
  severity: 'warning' | 'info'
  text: string
  itemId?: string
}

export interface PlanReadinessSummary {
  mode: EffectiveReviewMode
  structureQuality: ReviewStructureQuality
  missingRequiredSections: PlanItemKind[]
  total: number
  resolved: number
  locked: number
  byKind: Record<PlanItemKind, number>
  issues: PlanReadinessIssue[]
}
