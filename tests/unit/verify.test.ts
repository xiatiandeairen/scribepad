import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Problem } from '../../types/verify.js'
import { extract } from '../../core/extract/index.js'
import { deriveSeverity, verify } from '../../core/verify/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

const runOn = (name: string): Problem[] => {
  const source = readFixture(name)
  return verify(extract(source), { source })
}

const blockerRuleIds = (problems: Problem[]): string[] =>
  problems
    .filter((problem) => problem.severity === 'blocker')
    .map((problem) => problem.ruleId)
    .sort()

describe('verify(plan-auth-soc2.md) — the compliant benchmark is ready', () => {
  const problems = runOn('tests/fixtures/plan-auth-soc2.md')

  it('produces zero blockers (0 blocker === ready)', () => {
    expect(problems.filter((problem) => problem.severity === 'blocker')).toHaveLength(0)
  })

  it('still surfaces graph-gap warnings (not a rubber stamp)', () => {
    const warnings = new Set(
      problems.filter((problem) => problem.severity === 'warning').map((problem) => problem.ruleId),
    )
    // D2/D3 rationale未打 G 标签; G3 无验收覆盖; Q3/Q5 位置引用.
    expect(warnings.has('REF-04')).toBe(true)
    expect(warnings.has('REF-06')).toBe(true)
    expect(warnings.has('REF-08')).toBe(true)
  })
})

describe('verify(sample.md) — the counter-sample is not ready', () => {
  const problems = runOn('tests/fixtures/sample.md')

  it('produces exactly the five expected blockers', () => {
    expect(blockerRuleIds(problems)).toEqual(['DEC-01', 'HYG-01', 'HYG-02', 'STR-02', 'STR-03'])
  })

  it('marks the decision-not-made blocker needsHuman (拍板归人)', () => {
    const dec01 = problems.find((problem) => problem.ruleId === 'DEC-01')
    expect(dec01?.severity).toBe('blocker')
    expect(dec01?.needsHuman).toBe(true)
  })

  it('flags the duplicate candidate section as a graph break (HYG-02)', () => {
    const hyg02 = problems.find((problem) => problem.ruleId === 'HYG-02')
    expect(hyg02?.layer).toBe('L3')
    expect(hyg02?.aspect).toBe('graph')
    expect(hyg02?.severity).toBe('blocker')
  })

  it('locates the rewrite residue to a span (HYG-01 autoLocatable)', () => {
    const hyg01 = problems.find((problem) => problem.ruleId === 'HYG-01')
    expect(hyg01?.autoLocatable).toBe(true)
    expect(hyg01?.quote).toContain('[改写]')
  })
})

describe('deriveSeverity — the Table 2 matrix', () => {
  const base = { pointId: 'x' }
  const rule = (ruleId: string, layer: Problem['layer'], aspect: Problem['aspect']) =>
    deriveSeverity({ ...base, ruleId, layer, aspect, mechanism: 'rule', confidence: 1 })

  it('rule · required presence → blocker; soft presence → warning', () => {
    expect(rule('STR-01', 'L1', 'presence')).toBe('blocker')
    expect(rule('DEC-01', 'L1', 'presence')).toBe('blocker')
    expect(rule('STR-06', 'L1', 'presence')).toBe('warning')
  })

  it('rule · mandatory form → blocker; recommended form → warning', () => {
    expect(rule('HYG-01', 'L2', 'form')).toBe('blocker')
    expect(rule('DEC-02', 'L2', 'form')).toBe('blocker')
    expect(rule('REF-07', 'L2', 'form')).toBe('warning')
    expect(rule('RSK-01', 'L2', 'form')).toBe('warning')
  })

  it('rule · graph broken → blocker; graph gap → warning', () => {
    expect(rule('REF-01', 'L3', 'graph')).toBe('blocker')
    expect(rule('HYG-02', 'L3', 'graph')).toBe('blocker')
    expect(rule('REF-05', 'L3', 'graph')).toBe('warning')
    expect(rule('REF-06', 'L3', 'graph')).toBe('warning')
  })
})

describe('verify(tests/fixtures/plan-light.md) — light tier, absent optional roles never blocker', () => {
  const lightSource = readFixture('tests/fixtures/plan-light.md')
  const lightProblems = verify(extract(lightSource), { source: lightSource })

  it('produces zero problems — all required roles present, all optionals absent', () => {
    expect(lightProblems).toHaveLength(0)
  })

  it('absent risk / precondition / open-question emit no problem at all (铁律)', () => {
    // None of the optional-role absence rules fire.
    const optionalRuleIds = ['STR-06', 'RSK-01', 'PRE-01', 'REG-01', 'REG-02']
    expect(lightProblems.some((p) => optionalRuleIds.includes(p.ruleId))).toBe(false)
  })
})

describe('verify(tests/fixtures/plan-degraded.md) — auto-fixable single-blocker plan', () => {
  const degradedSource = readFixture('tests/fixtures/plan-degraded.md')
  const degradedProblems = verify(extract(degradedSource), { source: degradedSource })

  it('produces exactly one blocker: STR-03 (missing verification, not needsHuman)', () => {
    const blockers = degradedProblems.filter((p) => p.severity === 'blocker')
    expect(blockers).toHaveLength(1)
    expect(blockers[0]!.ruleId).toBe('STR-03')
    expect(blockers[0]!.needsHuman).toBe(false)
  })

  it('surfaces REF-07 and STR-05 as warnings (recommended substructure missing)', () => {
    const warningRuleIds = new Set(
      degradedProblems.filter((p) => p.severity === 'warning').map((p) => p.ruleId),
    )
    expect(warningRuleIds.has('REF-07')).toBe(true) // decided D1 present, but goal unlabelled
    expect(warningRuleIds.has('STR-05')).toBe(true) // scope has no non-goals
  })
})

describe('verify — dangling reference triggers REF-01 graph-break blocker', () => {
  it('REF-01 fires and is a blocker when a behavior point refs an undefined label', () => {
    const source = [
      '# Plan',
      '',
      '## 目标',
      '- **G1** 目标，可判定标准：明确结果。',
      '',
      '## 做法',
      '1. 完成配置迁移，依赖 G9 不存在的约束标签。',
      '',
      '## 验收',
      '- [ ] **G1** 验收通过。',
    ].join('\n')
    const result = extract(source)
    const problems = verify(result, { source })
    const ref01 = problems.filter((p) => p.ruleId === 'REF-01')
    expect(ref01.length).toBeGreaterThan(0)
    expect(ref01.some((p) => p.label === 'G9')).toBe(true)
    expect(ref01[0]!.severity).toBe('blocker')
    expect(ref01[0]!.layer).toBe('L3')
    expect(ref01[0]!.aspect).toBe('graph')
  })
})
