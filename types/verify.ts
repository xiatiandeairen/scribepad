/**
 * Verification types for the plan document validator.
 *
 * Severity is a derived field (computed by deriveSeverity from layer × mechanism ×
 * requiredness × confidence). Validators must not hard-code severity values — see
 * the derivation matrix in docs/plan-schema-layered.md Table 2.
 *
 * Invariants enforced at the schema layer (core/schema.ts):
 *   - mechanism='ai'  ⇒  severity ≤ 'warning'
 *   - severity='blocker'  ⇒  mechanism='rule' ∧ confidence===1.0
 *   - confidence < 0.5  ⇒  severity='suppressed'
 */

import type { ExtractResult } from './domain.js'

/** Four-tier problem severity — v2 expansion from the original two-tier blocker/warning. */
export type Severity = 'blocker' | 'warning' | 'suggestion' | 'suppressed'

/**
 * One problem found by the plan validator.
 *
 * `severity` is a derived field — validators compute it via deriveSeverity().
 * `quote` is required for mechanism='ai' problems; a problem without a quote that
 * can be located in the source text is discarded (hallucination guard).
 * `fingerprint` is used for cross-iteration deduplication, convergence detection,
 * and persistent user dismiss.
 */
export interface Problem {
  /** Unique within a single validation run. */
  id: string
  /** Rule identifier from the registry (e.g. 'DEC-01', 'HYG-02'). */
  ruleId: string

  // ── Layer coordinates (L4 = mechanism + confidence, a pervasive attribute) ──
  /** Validation layer. L4 is not a sequential check — it is expressed via mechanism + confidence. */
  layer: 'L1' | 'L2' | 'L3'
  /**
   * Aspect within the layer.
   *   L1 → 'presence'
   *   L2 → 'form' (deterministic) | 'substance' (AI)
   *   L3 → 'graph' (deterministic) | 'semantic' (AI)
   */
  aspect: 'presence' | 'form' | 'substance' | 'graph' | 'semantic'
  /** Renamed from v1 'source' for semantic clarity; 'rule' = deterministic. */
  mechanism: 'rule' | 'ai'
  /**
   * Confidence in [0, 1].
   *   mechanism='rule' → always 1.0
   *   mechanism='ai'   → model self-score × sampling consistency (see Table 4)
   */
  confidence: number
  /**
   * Derived severity — must NOT be manually assigned by validators.
   * Invariant: mechanism='ai' ⇒ severity ≤ 'warning'
   */
  severity: Severity

  // ── Context / location ──
  /** ID of the ExtractedItem this problem points to (when applicable). */
  pointId?: string
  /** Stable label (e.g. G1, D2) of the affected item. */
  label?: string
  /** Section path; used for section-level problems where pointId is absent. */
  path?: string
  /** Source text range; required when autoLocatable=true. */
  span?: { start: number; end: number }
  /**
   * Verbatim quote from the source that triggered this problem.
   * Required for mechanism='ai'; the problem is discarded if the quote cannot
   * be located in the source text (hallucination guard).
   */
  quote?: string

  // ── Human-readable output ──
  /** Problem description shown to the user. */
  message: string
  /**
   * Repair instruction fed to the AI fix prompt.
   * Must include the constraint: "do not fabricate facts — register unknown
   * values as Q entries + ⚠ TBD + owner placeholder".
   */
  fixHint: string

  // ── Routing flags ──
  /**
   * When true the AI may only draft a suggestion; a human must resolve it.
   * Applies to DEC-01 (decision not yet made) and its cascades.
   * needsHuman=true problems never enter the auto-fix dispatch.
   */
  needsHuman: boolean
  /**
   * When true the problem can be mapped to a precise source span.
   * Section-level absence problems are false (document-level location only).
   */
  autoLocatable: boolean

  /**
   * Stable hash used for cross-iteration deduplication, no-progress detection,
   * and persistent user dismiss.
   * Hash of: ruleId + (pointId | path) + normalised(quote)
   */
  fingerprint: string
}

/**
 * Injectable port for the AI half of the layered model (L2 substance / L3
 * semantic — the QLT-* rules). Deterministic rules run inline in verify();
 * AI findings are produced here and merged back.
 *
 * Async by design: a faithful implementation self-scores across k samples
 * (Table 4). This release ships only the deterministic rules, so the composition
 * root injects a no-op returning [] — the seam exists, the AI does not run yet.
 *
 * Contract on returned problems (enforced by verify() before merge):
 *   - mechanism must be 'ai' (⇒ severity clamped to ≤ warning by derivation)
 *   - each problem must carry a `quote` that occurs in `source`, else it is
 *     discarded (hallucination guard, Table 4)
 */
export interface LlmJudge {
  judge(result: ExtractResult, source: string): Promise<Problem[]>
}
