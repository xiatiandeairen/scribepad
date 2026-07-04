/**
 * Domain model for the scribepad core — extraction + confidence confirmation.
 *
 * Hand-written contracts (types/ has no runtime, per docs/architecture.md). The
 * runtime Zod schemas that validate these at boundaries live in `core/schema.ts`
 * and are checked against these types via `satisfies z.ZodType<...>`, so a drift
 * between type and schema is a compile error.
 */

/** Kind of information point extracted from a dev document. 8 roles per plan schema. */
export type InfoKind =
  | 'goal'
  | 'scope'
  | 'decision'
  | 'behavior'
  | 'verification'
  | 'risk'
  | 'precondition'
  | 'open-question'

/** Absolute markdown source range; mirrors the annotation anchor model. */
export interface SrcAnchor {
  srcStart: number
  srcEnd: number
}

/** Section path — where in the document hierarchy the item lives. */
export interface ItemPath {
  sectionTitle: string
  groupTitle?: string
}

/**
 * One information point the extractor surfaced.
 *
 * `anchor` is optional: a low-confidence extraction may fail to map its text back
 * to a precise source offset. `confidence` is optional (rule-based extractors
 * produce deterministic results and omit it; AI extractors set it in [0, 1]).
 */
export interface ExtractedItem {
  id: string
  kind: InfoKind
  /** Stable label (e.g. G1, D2) assigned by the extractor when the item carries one. */
  label?: string
  title: string
  text: string
  anchor?: SrcAnchor
  /** Cross-reference targets this item declares (e.g. ['G1', 'D2', '§4.3']). */
  refs: string[]
  /** Where in the document hierarchy this item lives. */
  path: ItemPath
  /** Structural role in the review tree. */
  role: 'checkpoint' | 'detail'
  /** SHA-1 of the item text at extraction time; used to detect stale state. */
  textHash: string
  /** Whether this item was produced by a deterministic rule or an AI pass. */
  source: 'rule' | 'ai'
  /** Confidence in [0, 1]. Required for source='ai'; omitted for source='rule'. */
  confidence?: number
}

/**
 * Decision card — the three-part structure for a key architectural choice.
 *
 * A DecisionCard is extracted when the extractor detects a decision point
 * (multi-candidate trigger). status='pending' means the decision has not yet
 * been made; status='decided' means all three parts are present.
 */
export interface DecisionCard {
  /** Stable ID of the corresponding ExtractedItem (kind='decision'). */
  pointId: string
  /** Stable label (e.g. D1) when the item carries one. */
  label?: string
  /** The chosen option (required when status='decided'). */
  chosen: string
  /** Why this option was chosen (required when status='decided'). */
  rationale: string
  /** Options that were considered and rejected. */
  rejected: Array<{ option: string; reason: string }>
  status: 'decided' | 'pending'
}

/** Full extraction result for one document. Never persisted — recomputed each run. */
export interface ExtractResult {
  points: ExtractedItem[]
  decisions: DecisionCard[]
}

/**
 * Sign-off — the human confirmation that one information point is settled.
 *
 * Persisted user state (via the ReviewStore port). Unlike the retired lock
 * model, a sign-off carries no anti-drift guarantee; it is an audit record of
 * who approved which point and when.
 */
export interface Signoff {
  /** Stable id of the signed-off ExtractedItem (== its label when it has one). */
  pointId: string
  /** Human-facing label of the point at sign-off time (e.g. G1, D2). */
  label: string
  /** When the sign-off happened (ISO 8601). */
  signedAt: string
}
