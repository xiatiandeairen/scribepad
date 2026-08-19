/**
 * Verification types for the plan document validator.
 *
 * Severity is derived from deterministic rule category and requiredness.
 */

/** Problem severity. Two tiers only — derived, never hand-assigned by a rule. */
export type Severity = 'blocker' | 'warning'

/**
 * One problem found by the plan validator.
 *
 * `severity` is a derived field — validators compute it via deriveSeverity().
 * `fingerprint` is used for cross-iteration deduplication, convergence detection,
 * and persistent user dismiss.
 */
export interface Problem {
  /** Unique within a single validation run. */
  id: string
  /** Rule identifier from the registry (e.g. 'DEC-01', 'HYG-02'). */
  ruleId: string

  // ── Layer coordinates ──
  layer: 'L1' | 'L2' | 'L3'
  /**
   * Aspect within the layer.
   *   L1 → 'presence'
   *   L2 → 'form'
   *   L3 → 'graph'
   */
  aspect: 'presence' | 'form' | 'graph'
  mechanism: 'rule'
  /** Deterministic findings always use confidence 1. */
  confidence: number
  /**
   * Derived severity — must NOT be manually assigned by validators.
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
  /** Verbatim quote from the source that triggered this problem. */
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
