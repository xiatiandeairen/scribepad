/**
 * L3 · Graph (图完整性半, deterministic, confidence 1.0). Two sub-classes with
 * different severity:
 *   - BROKEN (dangling ref / duplicate label / prefix-kind mismatch / duplicate
 *     candidate section) → the reference graph is untrustworthy → blocker.
 *   - GAP (未锚定 / 无覆盖 / 位置引用 / 未登记) → the graph is merely incomplete →
 *     warning; these carry through to a "ready" verdict.
 *
 * The semantic half (QLT-*) is the AI mechanism and is not run here.
 */
import type { VerifyContext } from './context.js'
import type { Finding } from './types.js'

const NO_FABRICATION =
  'Do not fabricate facts — register any unknown value as a Q entry with ⚠ TBD + an owner placeholder.'

const LABEL_TOKEN = /\b[GSDBVRPQ]\d+\b/g
const POSITION_REF = /第\s*\d+\s*[条节]/
const TODO_MARK = /\b(?:TODO|TBD)\b|待定|待确认/gi

const PREFIX_KIND: Record<string, string> = {
  G: 'goal',
  S: 'scope',
  D: 'decision',
  B: 'behavior',
  V: 'verification',
  R: 'risk',
  P: 'precondition',
  Q: 'open-question',
}

/** All label tokens in a text (used for rationale / anchor coverage checks). */
function labelsIn(text: string): string[] {
  return [...text.matchAll(LABEL_TOKEN)].map((match) => match[0])
}

export function graphRules(ctx: VerifyContext): Finding[] {
  const findings: Finding[] = []

  broken(ctx, findings)
  gaps(ctx, findings)

  return findings
}

/** Graph-broken → blocker: REF-01 dangling, REF-02 duplicate label, REF-03 prefix-kind, HYG-02 duplicate candidate. */
function broken(ctx: VerifyContext, findings: Finding[]): void {
  // REF-01: a ref that resolves to no defined label pollutes the graph.
  for (const point of ctx.result.points) {
    for (const ref of point.refs) {
      if (ctx.definedLabels.has(ref)) continue
      findings.push({
        ruleId: 'REF-01',
        layer: 'L3',
        aspect: 'graph',
        mechanism: 'rule',
        confidence: 1,
        pointId: point.id,
        label: ref,
        ...(point.anchor
          ? { span: { start: point.anchor.srcStart, end: point.anchor.srcEnd } }
          : {}),
        message: `引用悬空：${point.label ?? point.id} 引用了未定义的 ${ref}。`,
        fixHint: `Define ${ref} or remove the reference. ${NO_FABRICATION}`,
        autoLocatable: point.anchor !== undefined,
      })
    }
  }

  // REF-02: the same label owned by ≥2 points makes every reference ambiguous.
  const counts = new Map<string, number>()
  for (const point of ctx.result.points) {
    if (point.label) counts.set(point.label, (counts.get(point.label) ?? 0) + 1)
  }
  for (const [label, count] of counts) {
    if (count < 2) continue
    findings.push({
      ruleId: 'REF-02',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      label,
      message: `标签 ${label} 被定义 ${count} 次，引用歧义。`,
      fixHint: `Keep a single definition per label; renumber the duplicate. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // REF-03: a point owning a label whose prefix does not map to its kind. The
  // extractor already refuses to assign such labels, so this is a guard that
  // should never fire on rule-extracted input — kept for AI-sourced points.
  for (const point of ctx.result.points) {
    if (!point.label) continue
    const prefix = point.label.charAt(0)
    if (PREFIX_KIND[prefix] === point.kind) continue
    findings.push({
      ruleId: 'REF-03',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      label: point.label,
      message: `标签前缀 ${prefix} 与角色 ${point.kind} 不符，引用图语义被污染。`,
      fixHint: `Use the prefix matching the role, or move the item to its section. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }

  // HYG-02: the same candidate option defined by ≥2 sections — cross-section
  // contradiction (or redundancy), a document-level graph break.
  for (const [key, count] of ctx.candidateKeys) {
    if (count < 2) continue
    findings.push({
      ruleId: 'HYG-02',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      path: 'behavior',
      message: `候选「${key}」被定义 ${count} 次（跨节矛盾/冗余）。`,
      fixHint: `Merge the duplicate候选 sections; keep one, or lift the conflict into a risk. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }
}

/** Graph-gap → warning: REF-04/05/06/08/09, DEC-06, REG-01. */
function gaps(ctx: VerifyContext, findings: Finding[]): void {
  // REF-04: a decided card whose rationale cites no Gn is unanchored to goals.
  for (const card of ctx.decidedCards) {
    const cites = labelsIn(card.rationale).some((ref) => ref.startsWith('G'))
    if (cites) continue
    findings.push({
      ruleId: 'REF-04',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      pointId: card.pointId,
      ...(card.label ? { label: card.label } : {}),
      message: `决策 ${card.label ?? card.pointId} 理由未锚定任何目标约束（Gn）。`,
      fixHint: `Cite the Gn constraints the rationale relies on. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // REF-05: a verification item anchored to no G/D label — unclear what it tests.
  for (const point of ctx.byKind.get('verification') ?? []) {
    if (point.refs.some((ref) => ref.startsWith('G') || ref.startsWith('D'))) continue
    findings.push({
      ruleId: 'REF-05',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.anchor
        ? { span: { start: point.anchor.srcStart, end: point.anchor.srcEnd } }
        : {}),
      message: '验收条目未锚定任何 G/D 约束，不知在验证什么。',
      fixHint: `Anchor the item to the G/D label it verifies. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }

  // REF-06: a goal constraint no verification item references (reverse coverage).
  const verificationRefs = new Set(
    (ctx.byKind.get('verification') ?? []).flatMap((point) => point.refs),
  )
  for (const point of ctx.byKind.get('goal') ?? []) {
    if (!point.label || verificationRefs.has(point.label)) continue
    findings.push({
      ruleId: 'REF-06',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      label: point.label,
      message: `约束 ${point.label} 无任何验收条目覆盖。`,
      fixHint: `Add a verification item that references ${point.label}. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // REF-08: positional reference ("第 N 条") instead of a stable label.
  for (const point of ctx.result.points) {
    if (!POSITION_REF.test(point.text)) continue
    findings.push({
      ruleId: 'REF-08',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      ...(point.label ? { label: point.label } : {}),
      ...(point.anchor
        ? { span: { start: point.anchor.srcStart, end: point.anchor.srcEnd } }
        : {}),
      message: '位置引用（第 N 条）脆弱，插入条目即错位，建议改标签。',
      fixHint: `Replace positional references with the target's stable label. ${NO_FABRICATION}`,
      autoLocatable: point.anchor !== undefined,
    })
  }

  // REF-09: self-reference. The extractor strips it, so this is a guard for AI points.
  for (const point of ctx.result.points) {
    if (!point.label || !point.refs.includes(point.label)) continue
    findings.push({
      ruleId: 'REF-09',
      layer: 'L3',
      aspect: 'graph',
      mechanism: 'rule',
      confidence: 1,
      pointId: point.id,
      label: point.label,
      message: `${point.label} 引用自身，无信息量。`,
      fixHint: `Remove the self-reference. ${NO_FABRICATION}`,
      autoLocatable: false,
    })
  }

  // DEC-06: a detected candidate never processed in any decided card.
  if (ctx.decidedCards.length > 0) {
    const settledText = ctx.decidedCards
      .map((card) => `${card.chosen} ${card.rejected.map((r) => r.option).join(' ')}`)
      .join(' ')
    for (const key of ctx.candidateKeys.keys()) {
      const token = key.split(':')[1] ?? ''
      if (token && new RegExp(token, 'i').test(settledText)) continue
      findings.push({
        ruleId: 'DEC-06',
        layer: 'L3',
        aspect: 'graph',
        mechanism: 'rule',
        confidence: 1,
        path: 'decision',
        message: `候选「${key}」未在任何决策卡中被选或被否。`,
        fixHint: `Process every candidate in the decision card (chosen or rejected). ${NO_FABRICATION}`,
        autoLocatable: false,
      })
    }
  }

  registrationGap(ctx, findings)
}

/** REG-01: prose TODO/TBD markers outstripping registered open-questions. */
function registrationGap(ctx: VerifyContext, findings: Finding[]): void {
  if (!ctx.source) return
  const markers = [...ctx.source.matchAll(TODO_MARK)].length
  const registered = (ctx.byKind.get('open-question') ?? []).length
  if (markers <= registered) return
  findings.push({
    ruleId: 'REG-01',
    layer: 'L3',
    aspect: 'graph',
    mechanism: 'rule',
    confidence: 1,
    path: 'open-question',
    message: `正文有 ${markers} 处待定记号但仅 ${registered} 条已登记，存在未登记待定项。`,
    fixHint: `Register each outstanding TODO/TBD as a Q entry with owner + deadline. ${NO_FABRICATION}`,
    autoLocatable: false,
  })
}
