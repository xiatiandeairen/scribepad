import { describe, expect, it } from 'vitest'
import { inspectPlan, resolveReviewMode } from '../../src/lib/plan-inspector'

describe('resolveReviewMode', () => {
  it('uses structured mode when review sections produced focused items', () => {
    expect(resolveReviewMode([{ kind: 'goal' }])).toBe('structured')
  })

  it('uses annotation-only mode when no review structure is recognized', () => {
    expect(resolveReviewMode([])).toBe('annotation-only')
  })
})

describe('inspectPlan', () => {
  it('extracts focused items only from the five review directories', () => {
    const doc = [
      '# Auth Plan',
      '',
      '目标: 让登录流程满足 SOC2 审计要求。',
      '',
      '## 目标',
      '',
      '- 登录会话能够即时撤销。',
      '',
      '## 范围',
      '',
      '- 包含 web 登录和 API 鉴权。',
      '- 不包含移动端登录。',
      '',
      '## 方案',
      '',
      '### 会话存储',
      '',
      '- 使用服务端 session store。',
      '',
      '风险: Redis 运维复杂。',
      '',
      '## 验收',
      '',
      '- 通过 e2e 登录流。',
      '',
      '## 待确认',
      '',
      '- 是否接入外部 IdP。',
    ].join('\n')

    const result = inspectPlan(doc)
    expect(result.summary.mode).toBe('structured')
    expect(result.summary.byKind.goal).toBe(1)
    expect(result.summary.byKind.scope).toBe(2)
    expect(result.summary.byKind.behavior).toBe(1)
    expect(result.summary.byKind.verification).toBe(1)
    expect(result.summary.byKind['open-question']).toBe(1)
    expect(result.items.some((item) => item.text.includes('Redis'))).toBe(false)
    expect(result.sections.map((section) => section.title)).toEqual([
      '目标',
      '范围',
      '方案',
      '验收',
      '待确认',
    ])
    expect(result.sections.find((section) => section.kind === 'behavior')?.groups[0]?.title).toBe(
      '会话存储',
    )
  })

  it('does not keyword-scan unstructured prose', () => {
    const result = inspectPlan('交互: 点击锁定项后直接切换状态并定位正文。', [], 'auto')
    expect(result.items).toHaveLength(0)
    expect(result.summary.mode).toBe('annotation-only')
  })

  it('keeps persisted locked state by section and item text', () => {
    const doc = ['## 目标', '', '- 明确 Review readiness。'].join('\n')
    const first = inspectPlan(doc)
    const item = first.items[0]
    expect(item).toBeTruthy()

    const reordered = ['# Plan', '', doc].join('\n')
    const second = inspectPlan(reordered, [
      { id: item!.id, status: 'locked', textHash: item!.textHash, updatedAt: '2026-05-06' },
    ])
    expect(second.items[0]?.status).toBe('locked')
    expect(second.summary.resolved).toBe(1)
  })

  it('uses paragraphs only when a section or group has no list items', () => {
    const result = inspectPlan(
      [
        '## 目标',
        '',
        '解决 Review Outline 和实际 plan 结构不一致的问题。',
        '',
        '## 方案',
        '',
        '### Outline',
        '',
        '右侧按 section 和 group 展示。',
      ].join('\n'),
    )

    expect(result.summary.structureQuality).toBe('partial')
    expect(result.summary.byKind.goal).toBe(1)
    expect(result.summary.byKind.behavior).toBe(1)
    expect(result.sections[1]?.groups[0]?.checkpoint?.text).toBe('Outline')
    expect(result.sections[1]?.groups[0]?.details[0]?.text).toBe('右侧按 section 和 group 展示。')
  })

  it('collapses large scope lists into a few checkpoints with details', () => {
    const result = inspectPlan(
      [
        '## 范围',
        '',
        '- 范围内: web 登录。',
        '- 范围内: API 网关。',
        '- 范围内: OAuth 回调。',
        '- 不包含移动端。',
        '- 不包含 billing。',
        '- 依赖 Redis 可用性。',
        '- 风险: 多 region 一致性。',
      ].join('\n'),
    )

    expect(result.items.map((item) => item.text)).toEqual(['包含', '不包含', '依赖/约束'])
    expect(result.summary.total).toBe(3)
    expect(result.sections[0]?.groups[0]?.details).toHaveLength(3)
  })

  it('uses behavior h3 groups as checkpoints and keeps bullets as details', () => {
    const result = inspectPlan(
      [
        '## 方案',
        '',
        '### 状态模型',
        '',
        '- checkpoint 计入 readiness。',
        '- detail 只作为参考。',
        '',
        '### 交互',
        '',
        '- 点击 checkpoint 切换锁定。',
      ].join('\n'),
    )

    expect(result.items.map((item) => item.text)).toEqual(['状态模型', '交互'])
    expect(result.summary.total).toBe(2)
    expect(result.sections[0]?.groups[0]?.details[0]?.role).toBe('detail')
  })

  it('uses scope label paragraphs as group checkpoint titles', () => {
    const result = inspectPlan(
      [
        '## 范围',
        '',
        '包含:',
        '- Review 面板内的信息层级。',
        '- Signals 与 outline 的对应关系。',
        '',
        '不包含:',
        '- 多种 Review style。',
        '- AI 自动审计。',
      ].join('\n'),
    )

    expect(result.items.map((item) => item.text)).toEqual(['包含', '不包含'])
    expect(result.sections[0]?.groups[0]?.details).toHaveLength(2)
    expect(result.sections[0]?.groups[1]?.details[0]?.text).toBe('多种 Review style。')
  })

  it('uses behavior and verification labels as group checkpoint titles', () => {
    const result = inspectPlan(
      [
        '## 方案',
        '',
        '状态模型:',
        '- checkpoint 计入 readiness。',
        '- detail 只作为参考。',
        '',
        '交互:',
        '- 点击标题展开详情。',
        '',
        '## 验收',
        '',
        '功能:',
        '- 标题可展开。',
        '',
        '测试:',
        '- e2e 通过。',
      ].join('\n'),
    )

    expect(result.items.map((item) => item.text)).toEqual(['状态模型', '交互', '功能', '测试'])
    expect(result.summary.total).toBe(4)
  })

  it('keeps every goal and open-question list item as a checkpoint', () => {
    const result = inspectPlan(
      [
        '## 目标',
        '',
        '- 目标 A。',
        '- 目标 B。',
        '- 目标 C。',
        '- 目标 D。',
        '',
        '## 待确认',
        '',
        '- 是否启用规范化预览？',
        '- 是否保留 Signals？',
      ].join('\n'),
    )

    expect(result.items.map((item) => item.text)).toEqual([
      '目标 A。',
      '目标 B。',
      '目标 C。',
      '目标 D。',
      '是否启用规范化预览？',
      '是否保留 Signals？',
    ])
    expect(result.summary.total).toBe(6)
  })

  it('uses verification groups as checkpoints and covers group detail ranges', () => {
    const result = inspectPlan(
      [
        '## 验收',
        '',
        '### UI 验收',
        '',
        '- 右侧显示 group checkpoint。',
        '- 左侧覆盖 group 内容。',
      ].join('\n'),
    )
    const checkpoint = result.items[0]
    const detail = result.sections[0]?.groups[0]?.details[1]

    expect(checkpoint?.text).toBe('UI 验收')
    expect(result.summary.total).toBe(1)
    expect(checkpoint?.srcEnd).toBe(detail?.srcEnd)
  })

  it('marks locked items stale when the same item id has a different text hash', () => {
    const doc = ['## 目标', '', '- 明确 Review readiness。'].join('\n')
    const first = inspectPlan(doc)
    const item = first.items[0]
    expect(item).toBeTruthy()

    const second = inspectPlan(doc, [
      { id: item!.id, status: 'locked', textHash: 'old-hash', updatedAt: '2026-05-06' },
    ])
    expect(second.items[0]?.status).toBe('stale')
    expect(second.summary.issues.some((issue) => issue.id.startsWith('stale-'))).toBe(true)
  })
})
