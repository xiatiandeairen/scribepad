/**
 * core/verify — validate an ExtractResult into Problem[] under three layers:
 * L1 presence / L2 form / L3 graph.
 *
 * Pure and framework-free (E0): depends only on types/ and sibling core modules.
 * The current validator is deterministic (mechanism='rule').
 */
import type { ExtractResult } from '../../types/domain.js'
import type { Problem } from '../../types/verify.js'
import { deriveSeverity } from './severity.js'
import { buildContext } from './rules/context.js'
import { presenceRules } from './rules/presence.js'
import { formRules } from './rules/form.js'
import { graphRules } from './rules/graph.js'
import type { Finding } from './rules/types.js'

export { deriveSeverity } from './severity.js'

export interface VerifyOptions {
  /** Raw markdown; enables form checks (checkbox / ordered / TODO) that need block structure. */
  source?: string
}

/** Validate a plan ExtractResult into problems. Deterministic; never throws on document shape. */
export function verify(result: ExtractResult, opts: VerifyOptions = {}): Problem[] {
  const ctx = buildContext(result, opts.source)

  const findings: Finding[] = [...presenceRules(ctx), ...formRules(ctx), ...graphRules(ctx)]
  return findings.map((finding, index) => finalize(finding, index))
}

/** Assemble a rule Finding into a full Problem: derive severity, fingerprint, id, assert invariants. */
function finalize(finding: Finding, index: number): Problem {
  const severity = deriveSeverity(finding)
  const problem: Problem = {
    id: `${finding.ruleId}#${index}`,
    ruleId: finding.ruleId,
    layer: finding.layer,
    aspect: finding.aspect,
    mechanism: finding.mechanism,
    confidence: finding.confidence,
    severity,
    ...(finding.pointId ? { pointId: finding.pointId } : {}),
    ...(finding.label ? { label: finding.label } : {}),
    ...(finding.path ? { path: finding.path } : {}),
    ...(finding.span ? { span: finding.span } : {}),
    ...(finding.quote !== undefined ? { quote: finding.quote } : {}),
    message: finding.message,
    fixHint: finding.fixHint,
    needsHuman: finding.needsHuman ?? false,
    autoLocatable: finding.autoLocatable,
    fingerprint: fingerprintOf(finding),
  }
  return assertInvariants(problem)
}

/**
 * Schema-layer invariants (Table 2). A violation is a validator self-bug, so we
 * throw rather than emit a malformed problem.
 */
function assertInvariants(problem: Problem): Problem {
  if (problem.confidence !== 1) {
    throw new Error(`verify invariant: deterministic finding ${problem.ruleId} requires conf 1.0`)
  }
  return problem
}

/** Stable hash of ruleId + location + normalised quote — for cross-round dedup / dismiss. */
function fingerprintOf(finding: Finding): string {
  const location = finding.pointId ?? finding.path ?? finding.label ?? ''
  const quote = (finding.quote ?? '').replace(/\s+/g, ' ').trim()
  const key = `${finding.ruleId}|${location}|${quote}`
  let n = 0
  for (let i = 0; i < key.length; i += 1) {
    n = (n * 31 + key.charCodeAt(i)) >>> 0
  }
  return n.toString(36)
}
