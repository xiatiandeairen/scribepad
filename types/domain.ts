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
 * One column of a GFM table row: the header cell text paired with this row's
 * cell text under it. Column order is source order. This is a structural fact
 * (which column carried which value), not a UI mapping — the frontend adapter
 * decides that, e.g., column 影响 → severity or column 缓解 → mitigation.
 */
export interface CellFact {
  header: string
  text: string
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
  /**
   * Per-column facts when this item came from a GFM table data row: each header
   * cell paired with this row's cell under it, in column order. Absent for
   * non-table items. Structural fact only — the UI maps columns to its own
   * semantics (severity / mitigation / owner …), never the extractor.
   */
  cells?: CellFact[]
  /**
   * The nearest structural sub-group this item falls under: a bold lead-in
   * paragraph's bold text (e.g. 范围内 / 范围外) or, absent that, the enclosing
   * H3 heading. Lets the frontend split a section into subgroups (scope in/out,
   * decision/approach sub-buckets). Structural fact only — no UI role attached.
   */
  group?: string
  /**
   * 1-based ordinal when this item carries an intrinsic sequence number: a GFM
   * ordered-list item (its position under `ordered: true`) or an H3 heading that
   * opens with a literal `N.` (e.g. `### 1. …`). Lets the frontend number
   * behavior steps without re-parsing a fragile literal `N.` prefix out of text.
   * Structural fact only — absent for paragraphs, tables, and unordered lists.
   */
  ordinal?: number
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
  /**
   * The bold selection phrase in the H3 heading (e.g. 服务端 Session（Redis-backed）).
   * Structural fact from the heading's `**…**`, distinct from `chosen` which is
   * read from the body's 选了什么 lead-in. Absent when the heading has no bold.
   */
  pick?: string
  /**
   * The heading's residual text once label / pick / core marker / decided marker
   * are stripped — the question this decision answers (e.g. 会话机制选). Absent
   * when nothing remains.
   */
  question?: string
  /** True when the heading is tagged （核心） / （core） as the section's key decision. */
  core?: true
  /** Body segment led by 代价 — the explicitly accepted cost. Absent when unwritten. */
  cost?: string
  /** Body segment led by 依赖…事实 / 事实 — the grounding facts. Absent when unwritten. */
  facts?: string
}

/**
 * Document-level facts outside the 8 sections: the H1 title and the intro
 * blockquote that follows it (e.g. `> 状态：… | 交付期限：…`). Verbatim text —
 * the frontend parses it into whatever meta chips it wants (title / status /
 * deadline). No field carries a fixed UI meaning.
 */
export interface DocMeta {
  /** The H1 heading text. */
  title?: string
  /** The intro blockquote's text (the `>` line(s) right after the H1). */
  intro?: string
}

/** Full extraction result for one document. Never persisted — recomputed each run. */
export interface ExtractResult {
  points: ExtractedItem[]
  decisions: DecisionCard[]
  /** Document-level meta (H1 + intro blockquote). Absent when the doc has no H1. */
  meta?: DocMeta
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
