/**
 * The shape a rule authors. A rule declares WHAT it found and WHERE (layer,
 * aspect, mechanism, confidence, location) — never the severity. verify()
 * finalizes each Finding into a Problem: derives severity, computes the
 * fingerprint, assigns an id, and asserts the schema-layer invariants.
 */
import type { Problem } from '../../../types/verify.js'

export interface Finding {
  ruleId: string
  layer: Problem['layer']
  aspect: Problem['aspect']
  mechanism: Problem['mechanism']
  /** rule → 1.0; ai → self-score × sampling consistency. */
  confidence: number
  pointId?: string
  label?: string
  path?: string
  span?: { start: number; end: number }
  quote?: string
  message: string
  fixHint: string
  /** Defaults to false when omitted. */
  needsHuman?: boolean
  autoLocatable: boolean
}
