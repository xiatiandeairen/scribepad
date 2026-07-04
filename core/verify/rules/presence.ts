/**
 * L1 · Presence (有无). Deterministic, confidence 1.0. Required roles missing →
 * blocker; soft-required (standard-tier risk) → warning; optional roles never
 * produce a presence problem (铁律：缺席永不 blocker).
 *
 * STR-02 is presence-of-genuine-steps: a "做法" section that is pure candidate
 * comparison carries no executable step, so it counts as absent. Ordered FORM is
 * a separate L2 concern (CHK-02).
 */
import type { VerifyContext } from './context.js'
import type { Finding } from './types.js'

const NO_FABRICATION =
  'Do not fabricate facts — register any unknown value as a Q entry with ⚠ TBD + an owner placeholder.'

export function presenceRules(ctx: VerifyContext): Finding[] {
  const findings: Finding[] = []
  const has = (kind: Parameters<typeof ctx.byKind.get>[0]): boolean =>
    (ctx.byKind.get(kind)?.length ?? 0) > 0

  if (!has('goal')) {
    findings.push({
      ruleId: 'STR-01',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'goal',
      message: '缺目标：agent 无依据取舍，reviewer 无从评判方案。',
      fixHint: `Add a goal section: motivation + labelled success constraints (Gn) each with a decidable standard. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  if (ctx.genuineSteps.length === 0) {
    findings.push({
      ruleId: 'STR-02',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'behavior',
      message: '缺做法：无可执行步骤（只有方案对比不算步骤）。',
      fixHint: `After the decision is settled, add ordered execution steps, each with an action +产物. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  if (!has('verification')) {
    findings.push({
      ruleId: 'STR-03',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'verification',
      message: '缺验收：完成不可判定，闭环无法收口。',
      fixHint: `Add a checkable verification list, each item anchored to a G/D label. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  if (ctx.tier === 'standard' && !has('scope')) {
    findings.push({
      ruleId: 'STR-04',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'scope',
      message: 'standard 级 plan 缺边界节：无边界 agent 会 scope creep。',
      fixHint: `Add a scope section with in-scope and non-goals lists. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // Soft-required: standard-tier plans should carry a risk section, but its
  // absence never blocks (铁律：risk 永不升 required).
  if (ctx.tier === 'standard' && !has('risk')) {
    findings.push({
      ruleId: 'STR-06',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'risk',
      message: 'standard 级 plan 无风险节：降低 reviewer 信息量。',
      fixHint: `Consider adding a risk section (identified risk + impact + mitigation). ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // Decision required (multi-candidate) but no decided card covers it → not
  // ready, and the resolution belongs to a human (AI may only draft).
  if (ctx.multiCandidate && ctx.decidedCards.length === 0) {
    findings.push({
      ruleId: 'DEC-01',
      layer: 'L1',
      aspect: 'presence',
      mechanism: 'rule',
      confidence: 1,
      path: 'decision',
      message: '检测到多候选（≥2）但无 decided 决策卡——不可开工。',
      fixHint: `Draft a three-part decision card (chosen / rationale citing Gn / rejected each with a reason); keep status=pending pending human sign-off. ${NO_FABRICATION}`,
      needsHuman: true,
      autoLocatable: false,
    })
  }

  return findings
}
