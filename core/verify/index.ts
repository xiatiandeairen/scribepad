/**
 * core/verify — validate an ExtractResult into Problem[] under the v2 four-layer
 * model (L1 presence / L2 form / L3 graph; L4 = mechanism + confidence pervasive).
 *
 * Pure and framework-free (E0): depends only on types/ and sibling core modules.
 * This release ships the deterministic rules only (mechanism='rule'); the AI half
 * (QLT-*) is a designed-but-idle LlmJudge seam. AI findings, when a judge is wired
 * later, are merged via `opts.aiFindings` — they are quote-verified against the
 * source and severity-derived (hence clamped ≤ warning) exactly like everything
 * else, so they can never introduce a blocker.
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
export { emptyJudge } from './judge.js'

export interface VerifyOptions {
  /** Raw markdown; enables form checks (checkbox / ordered / TODO) that need block structure. */
  source?: string
  /**
   * Pre-resolved AI findings (mechanism='ai') from an LlmJudge. Empty by default.
   * Each is quote-verified against `source` and re-derived through deriveSeverity.
   */
  aiFindings?: Problem[]
}

/** Validate a plan ExtractResult into problems. Deterministic; never throws on document shape. */
export function verify(result: ExtractResult, opts: VerifyOptions = {}): Problem[] {
  const ctx = buildContext(result, opts.source)

  const findings: Finding[] = [...presenceRules(ctx), ...formRules(ctx), ...graphRules(ctx)]
  const problems = findings.map((finding, index) => finalize(finding, index))

  for (const candidate of opts.aiFindings ?? []) {
    if (!admitAiFinding(candidate, opts.source)) continue
    const severity = deriveSeverity(candidate)
    const problem = assertInvariants({ ...candidate, severity })
    problems.push(problem)
  }

  return problems
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
 * Hallucination guard: an AI finding is admitted only when it carries a quote
 * that occurs in the source. With no source we cannot verify, so we drop it —
 * an unverifiable AI accusation never enters the problem list.
 */
function admitAiFinding(candidate: Problem, source: string | undefined): boolean {
  if (candidate.mechanism !== 'ai') return false
  if (!candidate.quote || !source) return false
  return source.includes(candidate.quote)
}

/**
 * Schema-layer invariants (Table 2). A violation is a validator self-bug, so we
 * throw rather than emit a malformed problem.
 */
function assertInvariants(problem: Problem): Problem {
  if (problem.mechanism === 'ai' && problem.severity === 'blocker') {
    throw new Error(`verify invariant: AI finding ${problem.ruleId} cannot be a blocker`)
  }
  if (problem.severity === 'blocker' && (problem.mechanism !== 'rule' || problem.confidence !== 1)) {
    throw new Error(`verify invariant: blocker ${problem.ruleId} requires rule mechanism ∧ conf 1.0`)
  }
  if (problem.confidence < 0.5 && problem.severity !== 'suppressed') {
    throw new Error(`verify invariant: conf<0.5 ${problem.ruleId} must be suppressed`)
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
