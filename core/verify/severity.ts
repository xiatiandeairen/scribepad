/**
 * Severity derivation — the code form of Table 2 (severity推导矩阵).
 *
 * Severity is never hand-assigned by a rule; it is a pure function of
 * (layer × aspect × mechanism × confidence), classified per ruleId. This is the
 * single place the four tiers blocker/warning/suggestion/suppressed are decided,
 * so the schema-layer invariants hold by construction:
 *   - mechanism='ai'      ⇒ severity ≤ 'warning'  (an AI finding can never block)
 *   - severity='blocker'  ⇒ mechanism='rule' ∧ confidence===1.0
 *   - confidence < 0.5    ⇒ severity='suppressed'
 */
import type { Problem, Severity } from '../../types/verify.js'

/** The minimal shape deriveSeverity reads — every Finding/Problem satisfies it. */
export type SeverityInput = Pick<
  Problem,
  'ruleId' | 'layer' | 'aspect' | 'mechanism' | 'confidence'
>

/** L1 presence of a required role/section → blocker (incl. DEC-01 decision not made). */
const HARD_PRESENCE = new Set(['STR-01', 'STR-02', 'STR-03', 'STR-04', 'DEC-01'])

/** L2 form, mandatory substructure → blocker (decision three-part, checkable, ordered, residue). */
const MANDATORY_FORM = new Set([
  'DEC-02',
  'DEC-03',
  'DEC-04',
  'DEC-05',
  'CHK-01',
  'CHK-02',
  'HYG-01',
])

/**
 * L3 graph BROKEN → blocker (the graph is untrustworthy): dangling ref, duplicate
 * label, prefix/kind mismatch, cross-section contradiction. Graph GAPS (未锚定 /
 * 无覆盖 / 位置引用 / 未登记) are not here — they derive to warning.
 */
const GRAPH_BROKEN = new Set(['REF-01', 'REF-02', 'REF-03', 'HYG-02'])

/**
 * Derive the four-tier severity for one problem.
 *
 * Rule mechanism (confidence 1.0): a hard hit on required-presence /
 * mandatory-form / graph-broken → blocker; everything else deterministic
 * (soft-required, recommended substructure, optional-role field, graph gap) →
 * warning. AI mechanism: confidence bands it into warning / suggestion /
 * suppressed and can never exceed warning.
 *
 * Optional-role cap (risk / precondition / open-question L1·L2 ≤ warning) holds
 * automatically: no optional-role ruleId is registered in HARD_PRESENCE or
 * MANDATORY_FORM. The sole exception — a dangling ref inside a risk mitigation —
 * is REF-01, which lives in GRAPH_BROKEN and is document-level, so it correctly
 * escapes the cap.
 */
export function deriveSeverity(p: SeverityInput): Severity {
  if (p.mechanism === 'ai') {
    if (p.confidence >= 0.8) return 'warning'
    if (p.confidence >= 0.5) return 'suggestion'
    return 'suppressed'
  }

  // mechanism === 'rule' → confidence is 1.0 by construction.
  if (p.layer === 'L1' && p.aspect === 'presence') {
    return HARD_PRESENCE.has(p.ruleId) ? 'blocker' : 'warning'
  }
  if (p.layer === 'L2' && p.aspect === 'form') {
    return MANDATORY_FORM.has(p.ruleId) ? 'blocker' : 'warning'
  }
  if (p.layer === 'L3' && p.aspect === 'graph') {
    return GRAPH_BROKEN.has(p.ruleId) ? 'blocker' : 'warning'
  }
  return 'warning'
}
