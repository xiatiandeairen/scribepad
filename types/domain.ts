/**
 * Domain model for the scribepad core — extraction + confidence confirmation.
 *
 * Hand-written contracts (types/ has no runtime, per docs/architecture.md). The
 * runtime Zod schemas that validate these at boundaries live in `core/schema.ts`
 * and are checked against these types via `satisfies z.ZodType<...>`, so a drift
 * between type and schema is a compile error.
 */

/** Kind of information point extracted from a dev document. */
export type InfoKind =
  | 'goal'
  | 'scope'
  | 'behavior'
  | 'verification'
  | 'risk'
  | 'decision'
  | 'open-question'

/** Absolute markdown source range; mirrors the annotation anchor model. */
export interface SrcAnchor {
  srcStart: number
  srcEnd: number
}

/**
 * One information point the extractor surfaced.
 *
 * `anchor` is optional: a low-confidence extraction may fail to map its text back
 * to a precise source offset (docs/refactor-plan.md WI1 risk). Such items are
 * listed but not source-highlighted, never force-positioned.
 * `confidence` is in [0, 1].
 */
export interface ExtractedItem {
  id: string
  kind: InfoKind
  title: string
  text: string
  anchor?: SrcAnchor
  confidence: number
}

/** A gap = something a ready-to-execute doc should contain but doesn't. */
export type GapKind =
  | 'missing-goal'
  | 'missing-scope'
  | 'missing-verification'
  | 'missing-risk'
  | 'ambiguous-scope'
  | 'unresolved-question'

export interface Gap {
  id: string
  kind: GapKind
  reason: string
  severity: 'high' | 'medium' | 'low'
  confidence: number
}

/** Full extraction result for one document. Never persisted — recomputed each run. */
export interface ExtractResult {
  items: ExtractedItem[]
  gaps: Gap[]
}

/**
 * Confidence confirmation — the human sign-off on an extracted item.
 *
 * Important + low-confidence items enter `open` (待确认); the user moves them to
 * `confirmed` or `rejected`. Confirmed items are protected from AI drift, reusing
 * the existing annotation lock mechanism. Persisted via the ReviewStore port
 * (user state only — never the extraction result itself).
 */
export type ConfirmStatus = 'open' | 'confirmed' | 'rejected'

export interface ConfirmState {
  itemId: string
  status: ConfirmStatus
  /** confidence captured at extraction time, kept for audit. */
  confidence: number
  /** hash of item text at confirm time; a later text change re-opens for review. */
  textHash: string
  updatedAt: string
}

/**
 * Context pack (scenario S5) — assembled context to feed a downstream agent.
 *
 * Seam only: the type reserves the boundary so the core can host it later. The
 * assembly logic (`core/context-pack`) is designed but not implemented this round
 * (docs/refactor-plan.md §3.6 / E3).
 */
export interface ContextPack {
  id: string
  scenario: string
  itemIds: string[]
}
