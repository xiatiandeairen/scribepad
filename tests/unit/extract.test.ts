import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { byLabel, extract, relatedPoints } from '../../core/extract/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

const soc2 = extract(readFixture('tests/fixtures/plan-auth-soc2.md'))
const sample = extract(readFixture('tests/fixtures/sample.md'))
const degraded = extract(readFixture('tests/fixtures/plan-degraded.md'))
const light = extract(readFixture('tests/fixtures/plan-light.md'))
const dataBackend = extract(readFixture('tests/fixtures/plan-data-backend.md'))

describe('extract(plan-auth-soc2.md) — the compliant benchmark', () => {
  it('recognizes all 8 sections (one point per InfoKind)', () => {
    const kinds = new Set(soc2.points.map((point) => point.kind))
    expect([...kinds].sort()).toEqual([
      'behavior',
      'decision',
      'goal',
      'open-question',
      'precondition',
      'risk',
      'scope',
      'verification',
    ])
  })

  it('extracts four labelled goal constraints G1–G4', () => {
    const labels = soc2.points
      .filter((point) => point.kind === 'goal' && point.label)
      .map((point) => point.label)
    expect(labels).toEqual(['G1', 'G2', 'G3', 'G4'])
  })

  it('extracts three decision cards, D1 fully parsed and decided', () => {
    expect(soc2.decisions).toHaveLength(3)
    const d1 = soc2.decisions.find((card) => card.label === 'D1')
    expect(d1).toBeDefined()
    expect(d1!.status).toBe('decided')
    expect(d1!.chosen.length).toBeGreaterThan(0)
    expect(d1!.rationale.length).toBeGreaterThan(0)
    expect(d1!.rejected).toHaveLength(2)
    for (const rejected of d1!.rejected) {
      expect(rejected.option.length).toBeGreaterThan(0)
      expect(rejected.reason.length).toBeGreaterThan(0)
    }
  })

  it('labels the remaining role points (R/P/Q) by table/list prefix', () => {
    const labelsFor = (kind: string) =>
      soc2.points.filter((point) => point.kind === kind && point.label).map((point) => point.label)
    expect(labelsFor('risk')).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect(labelsFor('precondition')).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(labelsFor('open-question')).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5'])
  })

  it('grounds cross-references: labelled ids, self-nav, prefix/kind isolation', () => {
    // D4 rule: a labelled point's id is its label.
    const g1 = byLabel(soc2)['G1']
    expect(g1?.id).toBe('G1')

    // R2's mitigation cites （G1 ...）; the ref graph must capture it.
    expect(soc2.points.find((point) => point.label === 'R2')?.refs).toContain('G1')

    // A verification checkbox prefixed **G2** references goal G2, it does NOT
    // become a V-owned label — otherwise two items collide on the same id.
    const verification = soc2.points.filter((point) => point.kind === 'verification')
    expect(verification.every((point) => point.label === undefined)).toBe(true)
    expect(
      verification.filter((point) => point.refs.some((ref) => /^[GD]/.test(ref))).length,
    ).toBeGreaterThanOrEqual(7)

    // byLabel navigates a decision label to its decision point.
    expect(byLabel(soc2)['D2']?.kind).toBe('decision')
  })

  it('relatedPoints walks the reference graph off a label', () => {
    const related = relatedPoints(soc2, 'G1')
    // R2 references G1, so it must appear as an in-edge neighbour.
    expect(related.some((point) => point.label === 'R2')).toBe(true)
  })
})

describe('extract(sample.md) — the degraded counter-sample', () => {
  it('detects the multi-candidate options 方案 B/C/D without a decision section', () => {
    const candidates = new Set(
      sample.points
        .filter((point) => point.kind === 'behavior')
        .flatMap((point) => {
          const match = point.text.match(/方案\s*([BCD])/)
          return match ? [match[1]!] : []
        }),
    )
    expect([...candidates].sort()).toEqual(['B', 'C', 'D'])
    // No 决策 section present -> no decision cards, and no throw.
    expect(sample.decisions).toHaveLength(0)
  })

  it('degrades a non-8-section document to a partial result instead of throwing', () => {
    const kinds = new Set(sample.points.map((point) => point.kind))
    expect([...kinds].sort()).toEqual(['behavior', 'goal', 'open-question', 'scope'])
  })

  it('never throws on a document with no recognizable sections', () => {
    expect(() => extract('# just a title\n\nsome prose, no H2 sections at all.')).not.toThrow()
    expect(extract('plain text').points).toHaveLength(0)
  })
})

describe('extract(tests/fixtures/plan-light.md) — light-tier fixture', () => {
  it('recognizes exactly goal / behavior / verification (three-role light plan)', () => {
    const kinds = new Set(light.points.map((point) => point.kind))
    expect([...kinds].sort()).toEqual(['behavior', 'goal', 'verification'])
  })

  it('extracts one labelled goal constraint G1', () => {
    const g1 = light.points.filter((point) => point.kind === 'goal' && point.label === 'G1')
    expect(g1).toHaveLength(1)
  })

  it('produces no decision cards (no multi-candidate trigger in light plans)', () => {
    expect(light.decisions).toHaveLength(0)
  })

  it('verification point refs G1 (grounding the acceptance to the goal)', () => {
    const vPoints = light.points.filter((point) => point.kind === 'verification')
    expect(vPoints.some((point) => point.refs.includes('G1'))).toBe(true)
  })
})

describe('extract(tests/fixtures/plan-degraded.md) — decided D1 with missing verification', () => {
  it('extracts four roles: goal / scope / decision / behavior (no verification section)', () => {
    const kinds = new Set(degraded.points.map((point) => point.kind))
    expect([...kinds].sort()).toEqual(['behavior', 'decision', 'goal', 'scope'])
  })

  it('extracts one decided decision card D1 with full three-part structure', () => {
    expect(degraded.decisions).toHaveLength(1)
    const d1 = degraded.decisions[0]!
    expect(d1.label).toBe('D1')
    expect(d1.status).toBe('decided')
    expect(d1.chosen.length).toBeGreaterThan(0)
    expect(d1.rationale.length).toBeGreaterThan(0)
    expect(d1.rejected).toHaveLength(1)
    expect(d1.rejected[0]!.option.length).toBeGreaterThan(0)
    expect(d1.rejected[0]!.reason.length).toBeGreaterThan(0)
  })
})

describe('extract — P2 structural fidelity (cells / group / meta / decision heading)', () => {
  it('keeps risk table columns as cells (header × cell), text form unchanged', () => {
    const r1 = soc2.points.find((point) => point.label === 'R1')
    expect(r1?.cells).toEqual([
      { header: '#', text: 'R1' },
      { header: '风险', text: 'Redis 成鉴权单点，配合 D2 = 故障即全站不可用' },
      { header: '影响', text: '高' },
      {
        header: '缓解',
        text: 'managed multi-AZ（P1）；50ms 快失败；故障 runbook 演练后才全量',
      },
    ])
    // The flattened text form the frontend may still read is not broken.
    expect(r1?.text).toContain('R1 |')
    expect(r1?.text).toContain('| 高 |')
  })

  it('keeps the open-question table owner / 卡什么 / 截止 columns as cells', () => {
    const q1 = soc2.points.find((point) => point.label === 'Q1')
    const headers = q1?.cells?.map((cell) => cell.header)
    expect(headers).toEqual(['#', '问题', 'owner', '卡什么', '截止'])
    const byHeader = (header: string) => q1?.cells?.find((cell) => cell.header === header)?.text
    expect(byHeader('owner')).toBe('后端')
    expect(byHeader('卡什么')).toBe('§4.6')
    expect(byHeader('截止')).toBe('动工前')
  })

  it('groups scope points under their bold lead-in (范围内 / 范围外)', () => {
    const groups = new Set(
      soc2.points.filter((point) => point.kind === 'scope').map((point) => point.group),
    )
    expect(groups.has('范围内')).toBe(true)
    expect(groups.has('范围外（non-goals，agent 不得触碰）')).toBe(true)
    // Every scope point falls under one of the two lead-ins — none left ungrouped.
    expect([...groups].every((group) => group !== undefined)).toBe(true)
  })

  it('parses the decision H3 heading into pick / core / question', () => {
    const d1 = soc2.decisions.find((card) => card.label === 'D1')
    expect(d1?.pick).toBe('服务端 Session（Redis-backed）')
    expect(d1?.core).toBe(true)
    expect(d1?.question).toBe('会话机制选')
    // A non-core decision has no core flag but still yields pick + question.
    const d2 = soc2.decisions.find((card) => card.label === 'D2')
    expect(d2?.core).toBeUndefined()
    expect(d2?.pick).toBe('fail-closed')
    expect(d2?.question && d2.question.length).toBeGreaterThan(0)
  })

  it('reads the 代价 and 依赖…事实 body lead-ins into cost / facts', () => {
    // plan-data-backend D2 carries a 依赖面事实 lead-in, D3 a 代价 lead-in.
    const d2 = dataBackend.decisions.find((card) => card.label === 'D2')
    const d3 = dataBackend.decisions.find((card) => card.label === 'D3')
    expect(d2?.facts && d2.facts.length).toBeGreaterThan(0)
    expect(d2?.facts).toContain('ESLint E0')
    expect(d3?.cost && d3.cost.length).toBeGreaterThan(0)
    expect(d3?.cost).toContain('删除后')
  })

  it('records a 1-based ordinal on GFM ordered-list behavior points (soc2 做法)', () => {
    // soc2 writes 做法 as a standard ordered list `1. … 2. …`; remark strips the
    // literal `N.` marker, so ordinal is the only surviving sequence fact.
    const ordinals = soc2.points
      .filter((point) => point.kind === 'behavior' && point.ordinal !== undefined)
      .map((point) => point.ordinal)
    expect(ordinals).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('records an ordinal parsed from `### N.` behavior headings (plan-data-backend 做法)', () => {
    // plan-data-backend writes 做法 as H3 subsections `### 1. … ### 2. …`; the
    // ordinal is parsed from the heading so the frontend has a single code path.
    const ordinals = dataBackend.points
      .filter(
        (point) =>
          point.kind === 'behavior' && point.role === 'checkpoint' && point.ordinal !== undefined,
      )
      .map((point) => point.ordinal)
    expect(ordinals).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('omits ordinal on points not sourced from an ordered list or `N.` heading', () => {
    // soc2 goals/risks come from tables, scope from unordered lists, behavior
    // details from unordered lists — none carry an ordinal.
    const nonSequential = soc2.points.filter(
      (point) => point.kind === 'goal' || point.kind === 'risk' || point.kind === 'scope',
    )
    expect(nonSequential.length).toBeGreaterThan(0)
    expect(nonSequential.every((point) => point.ordinal === undefined)).toBe(true)
    // Behavior detail points (unordered sub-lists under an H3) also have none.
    const details = dataBackend.points.filter(
      (point) => point.kind === 'behavior' && point.role === 'detail',
    )
    expect(details.length).toBeGreaterThan(0)
    expect(details.every((point) => point.ordinal === undefined)).toBe(true)
  })

  it('extracts doc meta: H1 title + intro blockquote verbatim', () => {
    expect(soc2.meta?.title).toBe('Auth 重构：SOC2 合规的会话管理')
    expect(soc2.meta?.intro).toContain('状态：待 review')
    expect(soc2.meta?.intro).toContain('交付期限：2026 Q2')
  })

  it('validates the two 8-section fixtures degrade nowhere (both carry meta + decisions)', () => {
    expect(dataBackend.meta?.title).toContain('Plan 场景数据后端落地')
    expect(dataBackend.decisions.length).toBeGreaterThanOrEqual(4)
  })
})

describe('extract — P2 degradation (new fields default absent, never throw)', () => {
  it('omits cells on a document with no tables (plan-light)', () => {
    expect(light.points.every((point) => point.cells === undefined)).toBe(true)
  })

  it('omits group where there is no bold lead-in (plan-degraded scope is plain prose)', () => {
    const scope = degraded.points.filter((point) => point.kind === 'scope')
    expect(scope.length).toBeGreaterThan(0)
    expect(scope.every((point) => point.group === undefined)).toBe(true)
  })

  it('still yields meta.title for a non-8-section doc without an intro blockquote (sample.md)', () => {
    expect(sample.meta?.title).toBe('示例:auth 重构计划')
    expect(sample.meta?.intro).toBeUndefined()
  })

  it('omits meta entirely for a doc with no H1', () => {
    expect(extract('plain text').meta).toBeUndefined()
    expect(extract('# just a title\n\nsome prose.').meta).toEqual({ title: 'just a title' })
  })

  it('degrades a decision heading with no bold / core marker to bare question', () => {
    const src = ['# Plan', '', '## 决策', '', '### D1:选型说明', '', '正文。'].join('\n')
    const card = extract(src).decisions[0]!
    expect(card.pick).toBeUndefined()
    expect(card.core).toBeUndefined()
    expect(card.cost).toBeUndefined()
    expect(card.facts).toBeUndefined()
    expect(card.question).toBe('选型说明')
  })
})

describe('extract — boundary cases', () => {
  it('decision card three-part degradation: falls back gracefully when structure is absent', () => {
    // A decision H3 with no 选了什么/为什么/否掉了谁 leads → the parser degrades
    // rather than throws: chosen = full body text, rationale = '', rejected = [].
    const src = [
      '# Plan',
      '',
      '## 决策',
      '',
      '### D1:选型',
      '',
      '这是一段无三段结构的说明文字，没有选了什么/为什么/否掉了谁引导词。',
    ].join('\n')
    const result = extract(src)
    expect(result.decisions).toHaveLength(1)
    const card = result.decisions[0]!
    // No ✅/已定 marker → pending
    expect(card.status).toBe('pending')
    // Fallback: chosen gets the full body text (non-empty)
    expect(card.chosen.length).toBeGreaterThan(0)
    // rationale falls back to empty string
    expect(card.rationale).toBe('')
    // rejected is an empty array
    expect(card.rejected).toHaveLength(0)
  })

  it('dangling refs are preserved in point.refs without throwing', () => {
    // G9 is referenced in behavior text but never defined as a goal label.
    // extract must preserve the dangling ref verbatim — validation is downstream.
    const src = [
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
    expect(() => extract(src)).not.toThrow()
    const result = extract(src)
    const g1 = result.points.find((point) => point.label === 'G1')
    expect(g1).toBeDefined()
    // The behavior point references G9 even though G9 is not defined
    const behaviorPoints = result.points.filter((point) => point.kind === 'behavior')
    expect(behaviorPoints.some((point) => point.refs.includes('G9'))).toBe(true)
  })
})
