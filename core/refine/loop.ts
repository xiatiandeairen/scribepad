/**
 * core/refine — the verify-repair loop (plan-schema-layered.md Table 6).
 *
 * Pure orchestration (E0): the LlmRunner is injected, so this has no execa/fs.
 * One iteration is parse(extract) → validate(verify): a document with zero
 * blockers is `ready`; otherwise the still-fixable problems are grouped by point
 * into a repair prompt, the injected LLM rewrites the document, and the loop
 * re-parses. It halts on any of four terminal conditions and always returns the
 * best-so-far document (fewest blockers), never a version a repair regressed.
 *
 * Halting (Table 6):
 *   - ready              — zero blockers (success)
 *   - paused-needs-human — every remaining blocker is needsHuman (AI may only
 *                          draft; escalate to a human, do not spin)
 *   - stalled            — the blocker fingerprint set did not change across two
 *                          consecutive rounds (a repair made no progress)
 *   - max-iter           — the iteration cap was reached
 *
 * needsHuman blockers never enter the repair prompt (invariant 5); suggestion /
 * suppressed findings never enter it either (Table 4) — only the blocker set
 * (minus needsHuman) as the strong-constraint region and warnings as the soft.
 */
import type { LlmRunner } from '../../types/ports.js'
import type { Problem } from '../../types/verify.js'
import { extract } from '../extract/index.js'
import { verify } from '../verify/index.js'

export type RefineStatus = 'ready' | 'paused-needs-human' | 'max-iter' | 'stalled'

export interface RefineResult {
  status: RefineStatus
  /** Best-so-far document — the one whose problems are returned. */
  doc: string
  /** Problems of the returned document (recomputed, never persisted). */
  problems: Problem[]
  /** Number of LLM repair attempts made. */
  iterations: number
}

export interface RefineOptions {
  llm: LlmRunner
  /** Maximum LLM repair attempts before giving up. */
  maxIter?: number
}

interface Snapshot {
  doc: string
  problems: Problem[]
  blockerCount: number
}

/**
 * Drive a plan document to a verify-clean state via the injected LLM.
 *
 * Never throws on document shape (extract/verify degrade). An LLM failure is not
 * a document failure: the loop stops and returns the best-so-far snapshot with
 * status='stalled' — a repair that cannot run cannot make progress.
 */
export async function refine(doc: string, opts: RefineOptions): Promise<RefineResult> {
  const maxIter = opts.maxIter ?? 3
  let current = doc
  let iterations = 0
  let best: Snapshot | undefined
  let prevBlockerFingerprints: Set<string> | undefined

  for (;;) {
    const problems = verify(extract(current), { source: current })
    const blockers = problems.filter((problem) => problem.severity === 'blocker')
    const snapshot: Snapshot = { doc: current, problems, blockerCount: blockers.length }
    best = pickBest(snapshot, best)

    if (blockers.length === 0) {
      return terminal('ready', snapshot, best, iterations)
    }
    if (blockers.every((blocker) => blocker.needsHuman)) {
      return terminal('paused-needs-human', snapshot, best, iterations)
    }

    const blockerFingerprints = fingerprintSet(blockers)
    if (prevBlockerFingerprints && sameSet(prevBlockerFingerprints, blockerFingerprints)) {
      return terminal('stalled', snapshot, best, iterations)
    }
    if (iterations >= maxIter) {
      return terminal('max-iter', snapshot, best, iterations)
    }

    const prompt = buildRepairPrompt(current, problems)
    const run = await opts.llm.run({ prompt })
    iterations += 1
    if (!run.ok) {
      // A repair that cannot run cannot advance — return best-so-far, do not spin.
      return terminal('stalled', snapshot, best, iterations)
    }
    current = stripFence(run.value)
    prevBlockerFingerprints = blockerFingerprints
  }
}

/**
 * Return the terminal result. For 'ready' the current snapshot has zero blockers
 * and is by definition best; otherwise return the best-so-far snapshot so a
 * regressing repair never leaks out. doc and problems always come as a pair.
 */
function terminal(
  status: RefineStatus,
  current: Snapshot,
  best: Snapshot,
  iterations: number,
): RefineResult {
  const winner = status === 'ready' ? current : pickBest(current, best)
  return { status, doc: winner.doc, problems: winner.problems, iterations }
}

/** The snapshot with fewer blockers; ties keep the incumbent (earliest seen). */
function pickBest(candidate: Snapshot, incumbent: Snapshot | undefined): Snapshot {
  if (!incumbent) return candidate
  return candidate.blockerCount < incumbent.blockerCount ? candidate : incumbent
}

function fingerprintSet(problems: Problem[]): Set<string> {
  return new Set(problems.map((problem) => problem.fingerprint))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

/**
 * Build the repair prompt: blockers (minus needsHuman) form the strong-constraint
 * region, warnings the soft; suggestion / suppressed and needsHuman findings are
 * excluded. Problems are grouped by the point / label / path they target so the
 * LLM sees each location's full set of issues together.
 */
function buildRepairPrompt(doc: string, problems: Problem[]): string {
  const mustFix = problems.filter(
    (problem) => problem.severity === 'blocker' && !problem.needsHuman,
  )
  const shouldFix = problems.filter((problem) => problem.severity === 'warning')

  const sections: string[] = [
    '你是研发文档校验闭环里的修复者。下面是一份 markdown plan 文档,校验器发现了若干问题。',
    '请在**严格遵守硬约束**的前提下修订文档,消除所有"必须修复"的问题,并尽量顺带处理"建议修复"的问题。',
    '',
    '## 硬约束(违反即视为修复失败)',
    '1. 只修改被下方问题点名的区间/条目,文档其余部分逐字保留,不得改写、删减或重排。',
    '2. 不得虚构任何事实。未知的值一律写成 open-question(Q) 占位:`- **Q?** <问题> · owner: TBD · ⚠ TBD`,不要编造具体数值/结论凑数。',
    '3. 涉及决策拍板的问题(标注 needsHuman)不在本次修复范围内,原样保留,交由人处理。',
    '4. **只输出修订后的完整 markdown 全文**,不要包裹代码围栏,不要输出任何解释、前言或后记。',
    '',
    '## 必须修复(blocker)',
    formatGroups(groupByLocation(mustFix)) || '(无)',
  ]

  if (shouldFix.length > 0) {
    sections.push('', '## 建议顺带修复(warning)', formatGroups(groupByLocation(shouldFix)))
  }

  sections.push('', '## 待修订文档', '<<<DOC', doc, 'DOC>>>')
  return sections.join('\n')
}

/** Group problems by the location they point at (pointId / label / path). */
function groupByLocation(problems: Problem[]): Map<string, Problem[]> {
  const groups = new Map<string, Problem[]>()
  for (const problem of problems) {
    const key = problem.pointId ?? problem.label ?? problem.path ?? '(文档级)'
    const bucket = groups.get(key)
    if (bucket) bucket.push(problem)
    else groups.set(key, [problem])
  }
  return groups
}

function formatGroups(groups: Map<string, Problem[]>): string {
  const lines: string[] = []
  for (const [location, problems] of groups) {
    lines.push(`### ${location}`)
    for (const problem of problems) {
      lines.push(`- [${problem.ruleId}] ${problem.message}`)
      lines.push(`  修复建议: ${problem.fixHint}`)
      if (problem.quote) lines.push(`  命中原文: ${problem.quote}`)
    }
  }
  return lines.join('\n')
}

/** Strip a single outer ```markdown / ``` fence the LLM may have wrapped the doc in. */
function stripFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/)
  return match ? match[1]!.trim() : trimmed
}
