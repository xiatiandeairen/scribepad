/**
 * L2 · Form (形态半, deterministic, confidence 1.0). Mandatory substructure
 * (decision three-part, checkable verification, ordered steps, placeholder
 * residue) → blocker; recommended substructure and optional-role fields →
 * warning. The substance half (QLT-*) is the AI mechanism and is not run here.
 *
 * CHK-01 / CHK-02 need block structure the ExtractedItem does not carry (a task
 * marker / ordered marker), so they read the raw source via each point's anchor.
 * With no source they degrade to skip rather than false-fire.
 */
import type { ExtractedItem } from '../../../types/domain.js'
import type { VerifyContext } from './context.js'
import type { Finding } from './types.js'

const NO_FABRICATION =
  'Do not fabricate facts — register any unknown value as a Q entry with ⚠ TBD + an owner placeholder.'

const CHECKBOX_RE = /\[[ xX]\]/
const ORDERED_RE = /^\s*\d+\.\s/
const RESIDUE_RE = /(\[[^\][\r\n]{1,20}\])\s*\1/
const LOREM_RE = /lorem ipsum/i
const NON_GOAL_RE = /范围外|non-?goal|不做|不改|不动/i

/** Raw markdown slice for a point, when the source and its anchor are available. */
function rawOf(ctx: VerifyContext, point: ExtractedItem): string | undefined {
  if (!ctx.source || !point.anchor) return undefined
  return ctx.source.slice(point.anchor.srcStart, point.anchor.srcEnd)
}

export function formRules(ctx: VerifyContext): Finding[] {
  const findings: Finding[] = []

  decisionForm(ctx, findings)
  checkableAndOrdered(ctx, findings)
  hygieneResidue(ctx, findings)
  recommendedSubstructure(ctx, findings)

  return findings
}

/** DEC-02/03/05 on every decided card; DEC-04 at the document level. */
function decisionForm(ctx: VerifyContext, findings: Finding[]): void {
  for (const card of ctx.decidedCards) {
    const where = { pointId: card.pointId, ...(card.label ? { label: card.label } : {}) }

    if (card.chosen.trim() === '') {
      findings.push({
        ruleId: 'DEC-02',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        ...where,
        message: `决策 ${card.label ?? card.pointId} 标记已定但缺 chosen。`,
        fixHint: `State the single chosen option + its key parameters. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }

    // rationale is mandatory only for a contested (multi-candidate) decision;
    // a single-stance decided card may justify inline without a为什么 segment.
    const contested = card.rejected.length >= 1
    if (contested && card.rationale.trim() === '') {
      findings.push({
        ruleId: 'DEC-03',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        ...where,
        message: `决策 ${card.label ?? card.pointId} 无理由，不可追溯。`,
        fixHint: `Add a rationale citing the Gn constraints it satisfies. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }

    for (const rejected of card.rejected) {
      if (rejected.option.trim() !== '' && rejected.reason.trim() !== '') continue
      findings.push({
        ruleId: 'DEC-05',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        ...where,
        message: `决策 ${card.label ?? card.pointId} 的 rejected 条目缺 option/reason。`,
        fixHint: `Give each rejected option a non-empty option name and reason. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }
  }

  // Candidates were detected and a decision was made, yet none of the decided
  // cards processed the alternatives — the fork was never closed.
  if (
    ctx.candidateKeys.size >= 2 &&
    ctx.decidedCards.length > 0 &&
    ctx.decidedCards.every((card) => card.rejected.length === 0)
  ) {
    const card = ctx.decidedCards[0]!
    findings.push({
      ruleId: 'DEC-04',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      pointId: card.pointId,
      ...(card.label ? { label: card.label } : {}),
      message: '有候选对比但决策卡未处置任何候选（rejected 为空）。',
      fixHint: `List each considered candidate under rejected with its reason. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }
}

/** CHK-01 checkable verification form; CHK-02 ordered behavior form. Both need raw source. */
function checkableAndOrdered(ctx: VerifyContext, findings: Finding[]): void {
  const verification = ctx.byKind.get('verification') ?? []
  if (ctx.source && verification.length > 0) {
    const hasCheckbox = verification.some((point) => {
      const raw = rawOf(ctx, point)
      return raw !== undefined && CHECKBOX_RE.test(raw)
    })
    if (!hasCheckbox) {
      findings.push({
        ruleId: 'CHK-01',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        path: 'verification',
        message: '验收非可勾形态（无 checkbox），无法逐条追踪。',
        fixHint: `Rewrite verification items as \`- [ ]\` checkboxes. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }
  }

  if (ctx.source && ctx.genuineSteps.length > 0) {
    const hasOrdered = ctx.genuineSteps.some((point) => {
      const raw = rawOf(ctx, point)
      return raw !== undefined && ORDERED_RE.test(raw)
    })
    if (!hasOrdered) {
      findings.push({
        ruleId: 'CHK-02',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        path: 'behavior',
        message: '做法非有序步骤形态（无编号），执行顺序不明确。',
        fixHint: `Present 做法 as an ordered list so step sequence is explicit. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }
  }
}

/** HYG-01: placeholder / generation residue — repeated bracket token or lorem. */
function hygieneResidue(ctx: VerifyContext, findings: Finding[]): void {
  for (const point of ctx.result.points) {
    if (!RESIDUE_RE.test(point.text) && !LOREM_RE.test(point.text)) continue
    findings.push({
      ruleId: 'HYG-01',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.label ? { label: point.label } : {}),
      ...(point.anchor
        ? { span: { start: point.anchor.srcStart, end: point.anchor.srcEnd } }
        : {}),
      quote: point.text.slice(0, 120),
      message: '占位/生成残留（改写标记连续重复或 lorem），非待定内容。',
      fixHint: `Delete the residue and restore the intended content; register anything unknown as a Q entry. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }
}

/** Recommended substructure / optional-role fields — all warning-tier. */
function recommendedSubstructure(ctx: VerifyContext, findings: Finding[]): void {
  // REF-07: with a decision present, goal constraints should be labelled (Gn).
  if (ctx.decidedCards.length > 0) {
    const labelledGoal = (ctx.byKind.get('goal') ?? []).some((point) => point.label)
    if (!labelledGoal) {
      findings.push({
        ruleId: 'REF-07',
        layer: 'L2',
        aspect: 'form',
        mechanism: 'rule',
        confidence: 1,
        path: 'goal',
        message: '目标约束未标签化（无 Gn），rationale 与验收无处锚定。',
        fixHint: `Label each goal constraint Gn with a decidable standard. ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }
  }

  // STR-05: scope should carry a non-goals / 范围外 block.
  const scope = ctx.byKind.get('scope') ?? []
  if (scope.length > 0 && !scope.some((point) => NON_GOAL_RE.test(point.text))) {
    findings.push({
      ruleId: 'STR-05',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      path: 'scope',
      message: '边界只有范围内，无 non-goals，无法防 scope creep。',
      fixHint: `Add a 范围外 / non-goals list. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // RSK-01: each risk entry should carry a mitigation (optional-role field, capped warning).
  for (const point of ctx.byKind.get('risk') ?? []) {
    if (point.role !== 'detail' && !point.label) continue
    if (point.text.split('|').length >= 3) continue // table row with影响+缓解 columns
    findings.push({
      ruleId: 'RSK-01',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.label ? { label: point.label } : {}),
      message: `风险 ${point.label ?? point.id} 缺缓解字段。`,
      fixHint: `Add an impact + mitigation for the risk. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }

  // PRE-01: each precondition should carry owner + a "卡什么" reference.
  for (const point of ctx.byKind.get('precondition') ?? []) {
    if (/owner|负责|卡\s*§|卡\s*[GSDBVRPQ]\d/i.test(point.text)) continue
    findings.push({
      ruleId: 'PRE-01',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.label ? { label: point.label } : {}),
      message: `前置 ${point.label ?? point.id} 缺 owner 或未声明卡哪一步。`,
      fixHint: `Add owner + the step it blocks (by label / §). ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }

  // REG-02: each open-question should carry owner + 卡什么 + 截止.
  for (const point of ctx.byKind.get('open-question') ?? []) {
    if (point.role !== 'detail' && point.text.split('|').length >= 4) continue
    if (/owner|负责/.test(point.text) && /截止|deadline|前/.test(point.text)) continue
    findings.push({
      ruleId: 'REG-02',
      layer: 'L2',
      aspect: 'form',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.label ? { label: point.label } : {}),
      message: `待确认 ${point.label ?? point.id} 缺 owner/卡什么/截止，无法追责排期。`,
      fixHint: `Add owner + the blocked target (by label) + a deadline. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }
}
