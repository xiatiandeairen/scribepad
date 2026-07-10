import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../../core/extract/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

const standard = extract(readFixture('tests/fixtures/review-standard.md'))
const degraded = extract(readFixture('tests/fixtures/review-degraded.md'))
const edge = extract(readFixture('tests/fixtures/review-edge.md'))

const planFixtures = [
  'tests/fixtures/plan-auth-soc2.md',
  'tests/fixtures/plan-data-backend.md',
  'tests/fixtures/plan-degraded.md',
  'tests/fixtures/plan-light.md',
  'tests/fixtures/sample.md',
]

describe('detectDocKind — plan/review dispatch', () => {
  it('classifies standard and edge as review via the H1 "Review:" prefix', () => {
    expect(standard.docKind).toBe('review')
    expect(edge.docKind).toBe('review')
  })

  it('classifies degraded as review via >=2 review-section votes (no H1)', () => {
    expect(degraded.docKind).toBe('review')
  })

  it('leaves every plan fixture and sample.md undefined (plan, zero behavior change)', () => {
    for (const name of planFixtures) {
      const result = extract(readFixture(name))
      expect(result.docKind).toBeUndefined()
      expect(result.review).toBeUndefined()
    }
  })

  it('classifies a plain-text / no-section doc as plan', () => {
    expect(extract('plain text').docKind).toBeUndefined()
    expect(extract('# just a title\n\nsome prose.').docKind).toBeUndefined()
  })
})

describe('extract(review-standard.md) — full-shape review doc', () => {
  it('yields points/decisions empty, meta.title present', () => {
    expect(standard.points).toEqual([])
    expect(standard.decisions).toEqual([])
    expect(standard.meta?.title).toContain('dogfood 闭环')
  })

  it('extracts 3 verdicts with labels/tags/anchors', () => {
    const verdicts = standard.review!.verdicts
    expect(verdicts).toHaveLength(3)
    expect(verdicts.map((v) => v.label)).toEqual(['D1', 'D2', 'D3'])
    expect(verdicts.map((v) => v.tag)).toEqual(['擅自决策', '对外行为', '性能'])
    expect(verdicts.every((v) => v.anchor !== undefined)).toBe(true)
  })

  it('D1 carries all six body fields with exact values', () => {
    const d1 = standard.review!.verdicts[0]!
    expect(d1.title).toBe('feedback CLI 子命令与同名文件冲突时，让真实文件优先')
    // pin exact values from the fixture body bullets. textOf flattens inline
    // code the same way it flattens emphasis (text.ts: "ignores markdown
    // emphasis markers") — backticks do not survive into the field value.
    expect(d1.context).toBe(
      '实现 scribepad feedback 时发现 cwd 下若存在字面名为 feedback 的文件，scribepad feedback 语义歧义，plan 未覆盖',
    )
    expect(d1.chosen).toBe("existsSync(resolve('feedback')) 为真时按打开文档处理，子命令让位")
    expect(d1.alternative).toBe('加 -- 分隔符强制区分——对用户多一层记忆负担')
    expect(d1.whyNotAsked).toBe('两条路径都可逆，且文件优先与 scribepad <path> 主语义一致')
    expect(d1.ifRejected).toBe('回退成本低，影响仅 CLI 入口一个分支')
    expect(d1.evidence).toBe('1beeee6 / server/index.ts:31')
  })

  it('extracts 5 reconciliation rows with statuses and refs', () => {
    const rows = standard.review!.reconciliation
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.status)).toEqual(['done', 'done', 'deviated', 'dropped', 'added'])
    expect(rows.map((r) => r.refs)).toEqual([[], [], ['D1'], ['L3'], ['D2']])
  })

  it('extracts 4 claims, C4 unverified, C1 verify contains npm test', () => {
    const claims = standard.review!.claims
    expect(claims).toHaveLength(4)
    expect(claims.map((c) => c.label)).toEqual(['C1', 'C2', 'C3', 'C4'])
    const c1 = claims.find((c) => c.label === 'C1')!
    expect(c1.verify).toContain('npm test')
    const c4 = claims.find((c) => c.label === 'C4')!
    expect(c4.unverified).toBe(true)
    expect(claims.filter((c) => c.unverified)).toHaveLength(1)
  })

  it('extracts 3 leftovers with kinds and L1.condition set', () => {
    const leftovers = standard.review!.leftovers
    expect(leftovers).toHaveLength(3)
    expect(leftovers.map((l) => l.kind)).toEqual(['deferred', 'assumption', 'limitation'])
    const l1 = leftovers.find((l) => l.label === 'L1')!
    expect(l1.condition).toBe('抽查发现 ≥1 次证据错误')
    expect(l1.text).toBe('独立核验 agent（对冲执行者自述偏差）')
  })

  it('extracts 3 details', () => {
    expect(standard.review!.details).toHaveLength(3)
  })
})

describe('extract(review-degraded.md) — degrade-never-throw', () => {
  it('never throws and classifies as review', () => {
    expect(() =>
      extract(readFileSync(repoRoot + 'tests/fixtures/review-degraded.md', 'utf8')),
    ).not.toThrow()
    expect(degraded.docKind).toBe('review')
  })

  it('D1 is a title-only verdict: all optional fields undefined', () => {
    const verdicts = degraded.review!.verdicts
    expect(verdicts).toHaveLength(1)
    const d1 = verdicts[0]!
    expect(d1.label).toBe('D1')
    expect(d1.title).toBe('只有一句决策，没有任何 bullet 字段')
    expect(d1.tag).toBeUndefined()
    expect(d1.context).toBeUndefined()
    expect(d1.chosen).toBeUndefined()
    expect(d1.alternative).toBeUndefined()
    expect(d1.whyNotAsked).toBeUndefined()
    expect(d1.ifRejected).toBeUndefined()
    expect(d1.evidence).toBeUndefined()
  })

  it('the unlabeled H3 (no D<n>. prefix) is skipped, including its body', () => {
    // Only D1 survives; the second H3 ("没有标签的 H3 单元应被跳过或降级") and its
    // 背景 bullet must not leak into D1 or produce a second card.
    expect(degraded.review!.verdicts).toHaveLength(1)
    expect(degraded.review!.verdicts[0]!.context).toBeUndefined()
  })

  it('claims: only C1 survives (unlabeled row dropped), evidence/verify undefined', () => {
    const claims = degraded.review!.claims
    expect(claims).toHaveLength(1)
    const c1 = claims[0]!
    expect(c1.label).toBe('C1')
    expect(c1.claim).toBe('表格缺证据列和核验列')
    expect(c1.evidence).toBeUndefined()
    expect(c1.verify).toBeUndefined()
    expect(c1.unverified).toBe(false)
  })

  it('leftovers: L1 kind unknown, bare item dropped, L2 kind unknown with condition parsed', () => {
    const leftovers = degraded.review!.leftovers
    expect(leftovers).toHaveLength(2)
    expect(leftovers.map((l) => l.label)).toEqual(['L1', 'L2'])
    expect(leftovers[0]!.kind).toBe('unknown')
    expect(leftovers[1]!.kind).toBe('unknown')
    expect(leftovers[1]!.condition).toBe('仍应解析出 condition')
  })

  it('has no meta.title (no H1 in the source)', () => {
    expect(degraded.meta?.title).toBeUndefined()
  })
})

describe('extract(review-edge.md) — zero verdicts, empty cells, surrogate pairs', () => {
  it('verdicts is an empty array ("本次无裁决事项" paragraph, no H3 units)', () => {
    expect(edge.review!.verdicts).toEqual([])
  })

  it('reconciliation: statuses [unknown, done, deviated], empty-item row present', () => {
    const rows = edge.review!.reconciliation
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.status)).toEqual(['unknown', 'done', 'deviated'])
    expect(rows[2]!.item).toBe('')
  })

  it('C1 text preserves the surrogate-pair characters', () => {
    const c1 = edge.review!.claims.find((c) => c.label === 'C1')!
    expect(c1.claim).toContain('𝕊𝕔𝕣𝕚𝕓𝕖')
  })

  it('C2.unverified is true (case-insensitive "Unverified")', () => {
    const c2 = edge.review!.claims.find((c) => c.label === 'C2')!
    expect(c2.unverified).toBe(true)
  })

  it('L1 splits the single-hyphen dash variant: condition and text', () => {
    const l1 = edge.review!.leftovers.find((l) => l.label === 'L1')!
    expect(l1.condition).toBe('不应误切 text')
    expect(l1.text).toBe('破折号变体用单个短横')
  })

  it('has exactly 1 detail', () => {
    expect(edge.review!.details).toHaveLength(1)
  })

  it('meta.title is present', () => {
    expect(edge.meta?.title).toContain('边界用例')
  })
})
