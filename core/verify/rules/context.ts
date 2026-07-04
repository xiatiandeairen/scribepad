/**
 * Precomputed facts every rule reads — built once per verify() call so the rule
 * functions stay pure derivations over a shared view instead of re-scanning the
 * result. Tier, the multi-candidate trigger and the genuine-step set are the
 * three facts that drive presence severity, so they are resolved here.
 */
import type { DecisionCard, ExtractResult, ExtractedItem, InfoKind } from '../../../types/domain.js'

/** A candidate-option heading: `方案|候选|Option|Alternative` + an id token. */
const CANDIDATE_RE = /^\s*(方案|候选|option|alternative)\s*([A-Za-z0-9]+)/i

export interface VerifyContext {
  result: ExtractResult
  /** Raw markdown; present enables form checks that need block structure (checkbox/ordered). */
  source?: string

  byKind: Map<InfoKind, ExtractedItem[]>
  /** Behavior points that are genuine execution steps — not candidate-option comparison. */
  genuineSteps: ExtractedItem[]

  /** Distinct candidate key → occurrence count (a count>1 is a duplicated option, HYG-02). */
  candidateKeys: Map<string, number>
  /** ≥2 distinct candidates OR any DecisionCard present → decision becomes required. */
  multiCandidate: boolean

  tier: 'light' | 'standard'
  decidedCards: DecisionCard[]
  /** Every label a point owns — the resolvable target set for ref checks. */
  definedLabels: Set<string>
}

/** True when text reads as a candidate-option heading. */
export function isCandidateText(text: string): boolean {
  return CANDIDATE_RE.test(text)
}

/** Normalised candidate key (e.g. `方案:b`), or undefined when not a candidate heading. */
export function candidateKeyOf(text: string): string | undefined {
  const match = CANDIDATE_RE.exec(text)
  if (!match) return undefined
  return `${match[1]!.toLowerCase()}:${match[2]!.toLowerCase()}`
}

export function buildContext(result: ExtractResult, source?: string): VerifyContext {
  const byKind = new Map<InfoKind, ExtractedItem[]>()
  const definedLabels = new Set<string>()
  for (const point of result.points) {
    const bucket = byKind.get(point.kind)
    if (bucket) bucket.push(point)
    else byKind.set(point.kind, [point])
    if (point.label) definedLabels.add(point.label)
  }

  const behavior = byKind.get('behavior') ?? []

  // A step is genuine only when neither it nor its group reads as a candidate
  // option — a plan whose "做法" is nothing but 方案 A/B/C comparison has no steps.
  const genuineSteps = behavior.filter(
    (point) =>
      !isCandidateText(point.text) &&
      !(point.path.groupTitle !== undefined && isCandidateText(point.path.groupTitle)),
  )

  const candidateKeys = new Map<string, number>()
  for (const point of behavior) {
    if (point.role !== 'checkpoint') continue
    const key = candidateKeyOf(point.text)
    if (key) candidateKeys.set(key, (candidateKeys.get(key) ?? 0) + 1)
  }

  const multiCandidate = result.decisions.length > 0 || candidateKeys.size >= 2
  const decidedCards = result.decisions.filter((card) => card.status === 'decided')

  // Tier is derived from document shape, never user-declared (v1 §0): a
  // multi-candidate decision, >3 steps, or >8 points all imply a standard plan.
  const tier: 'light' | 'standard' =
    multiCandidate || genuineSteps.length > 3 || result.points.length > 8 ? 'standard' : 'light'

  return {
    result,
    ...(source !== undefined ? { source } : {}),
    byKind,
    genuineSteps,
    candidateKeys,
    multiCandidate,
    tier,
    decidedCards,
    definedLabels,
  }
}
