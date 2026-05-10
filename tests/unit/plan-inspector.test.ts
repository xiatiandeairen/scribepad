import { describe, expect, it } from 'vitest'
import { inspectPlan, resolveReviewMode } from '../../src/lib/plan-inspector'

describe('resolveReviewMode', () => {
  it('uses structured mode for executable plans', () => {
    expect(resolveReviewMode([{ kind: 'task' }, { kind: 'verification' }])).toBe('structured')
  })

  it('downgrades partial plan-like docs to lightweight', () => {
    expect(resolveReviewMode([{ kind: 'risk' }, { kind: 'decision' }])).toBe('lightweight')
  })

  it('downgrades weakly structured docs to annotation-only', () => {
    expect(resolveReviewMode([{ kind: 'risk' }])).toBe('annotation-only')
  })
})

describe('inspectPlan', () => {
  it('extracts high-value plan information points', () => {
    const doc = [
      '# Auth Plan',
      '',
      '目标: 让登录流程满足 SOC2 审计要求。',
      '',
      '## 范围',
      '',
      '- 范围内: web 登录和 API 鉴权。',
      '- 范围外: 移动端登录。',
      '',
      '## 任务',
      '',
      '- Task 1: 实现服务端 session。',
      '- 验证: npm test 和 e2e 登录流。',
      '',
      '风险: Redis 运维复杂。',
      '',
      'TBD: 是否接入外部 IdP。',
    ].join('\n')

    const result = inspectPlan(doc)
    expect(result.summary.mode).toBe('structured')
    expect(result.summary.byKind.goal).toBeGreaterThan(0)
    expect(result.summary.byKind.scope).toBeGreaterThan(0)
    expect(result.summary.byKind.task).toBeGreaterThan(0)
    expect(result.summary.byKind.verification).toBeGreaterThan(0)
    expect(result.summary.byKind.risk).toBeGreaterThan(0)
    expect(result.summary.byKind['open-question']).toBeGreaterThan(0)
  })

  it('extracts user-visible behavior points for feature plans', () => {
    const result = inspectPlan('交互: 点击锁定项后直接切换状态并定位正文。', [], 'structured')
    expect(result.items[0]?.kind).toBe('behavior')
    expect(result.summary.byKind.behavior).toBe(1)
  })

  it('merges persisted locked state by stable item id', () => {
    const doc = '目标: 明确 0.2.0 的 plan readiness。'
    const first = inspectPlan(doc, [], 'lightweight')
    const item = first.items[0]
    expect(item).toBeTruthy()

    const second = inspectPlan(
      doc,
      [{ id: item!.id, status: 'locked', textHash: item!.textHash, updatedAt: '2026-05-06' }],
      'lightweight',
    )
    expect(second.items[0]?.status).toBe('locked')
    expect(second.summary.resolved).toBe(1)
  })

  it('marks locked items stale when their text hash changes', () => {
    const first = inspectPlan('风险: Redis 运维复杂。', [], 'lightweight')
    const item = first.items[0]
    expect(item).toBeTruthy()

    const second = inspectPlan(
      '风险: Redis 运维和成本复杂。',
      [{ id: item!.id, status: 'locked', textHash: item!.textHash, updatedAt: '2026-05-06' }],
      'lightweight',
    )
    expect(second.items[0]?.status).toBe('stale')
    expect(second.summary.issues.some((issue) => issue.id.startsWith('stale-'))).toBe(true)
  })

  it('does not hard-report missing goal/scope in lightweight mode', () => {
    const result = inspectPlan('风险: Redis 运维复杂。\n\n决策: 先不做多 region。')
    expect(result.summary.mode).toBe('lightweight')
    expect(result.summary.issues.some((issue) => issue.id === 'missing-goal')).toBe(false)
    expect(result.summary.issues.some((issue) => issue.id === 'missing-scope')).toBe(false)
  })
})
