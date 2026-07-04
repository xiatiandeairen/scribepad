import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { LlmError, LlmRunner } from '../../types/ports.js'
import type { Result } from '../../types/result.js'
import type { Problem } from '../../types/verify.js'
import { extract } from '../../core/extract/index.js'
import { verify } from '../../core/verify/index.js'
import { refine } from '../../core/refine/loop.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(repoRoot + name, 'utf8')

const blockerRuleIds = (doc: string): string[] =>
  verify(extract(doc), { source: doc })
    .filter((problem: Problem) => problem.severity === 'blocker')
    .map((problem) => problem.ruleId)
    .sort()

const okRun = (text: string): Promise<Result<string, LlmError>> =>
  Promise.resolve({ ok: true, value: text })

/** Fake LlmRunner returning preset text — no CLI, no subprocess. */
const fakeRunner = (respond: (prompt: string) => string): LlmRunner => ({
  run: ({ prompt }) => okRun(respond(prompt)),
})

// ── Fixture (a): decision decided but missing verification (STR-03) + non-goals ──
// The only blocker is STR-03; the fake LLM adds a verification section to clear it.
const DEGRADED_BEFORE = `# 登录限流改造计划

## 目标
当前登录接口无任何限流,暴力破解与撞库风险高,需要引入账号级限流。

- **G1** 单账号登录连续失败超过 5 次后进入锁定,可判定标准:第 6 次请求返回 HTTP 429。

## 范围
涉及 web 端登录接口、API 网关的鉴权前置。

## 决策
### D1:限流算法选型 ✅ 已定

**选了什么**:采用滑动窗口计数器,基于 Redis 有序集合实现。

**为什么**:滑动窗口能满足 G1 的即时锁定精度,避免固定窗口的边界突发问题。

**否掉了谁**:

| 候选 | 否掉理由 |
|---|---|
| 固定窗口计数 | 窗口边界存在双倍突发,不满足 G1 的精度要求 |

## 做法
1. 在 API 网关接入 Redis 滑动窗口限流中间件,产出:网关限流中间件模块。
2. 配置单账号 5 次/分钟阈值并接入告警,产出:限流配置与告警规则。

## 风险
| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Redis 抖动导致限流误判 | 中 | 限流组件降级为放行 + 触发告警 |
`

const DEGRADED_AFTER =
  DEGRADED_BEFORE +
  `
## 验收
- [ ] **G1** 单账号连续失败 5 次后,第 6 次登录请求返回 HTTP 429。
`

// Same shape as DEGRADED_BEFORE but the ordered steps are gone → adds STR-02.
// Used only to drive the max-iter toggle (a distinct blocker set each round).
const DEGRADED_NO_STEPS = DEGRADED_BEFORE.replace(
  /## 做法\n1\. [^\n]*\n2\. [^\n]*\n/,
  '## 做法\n方案对比见上,尚未拆解为步骤。\n',
)

// ── Fixture (b): sample.md fixed except the decision — DEC-01 (needsHuman) remains ──
// HYG residue / duplicate section removed, steps + verification added, but the
// candidate fork (方案 B/C/D) is still未决 so DEC-01 persists → the loop must pause.
const SAMPLE_FIXED = `# 示例:auth 重构计划

## 目标
现有 session token 直接存放在浏览器 cookie 中,合规团队要求重构为满足 SOC2 的会话管理方案。

- **G1** 会话可即时撤销,可判定标准:撤销后下一次请求即失效。

## 范围
涉及 web 端登录、API 网关鉴权、第三方 OAuth 回调。

范围外(non-goals):不改动现有用户资料存储。

## 方案
### 方案 B:服务端 Session(Redis)
- 优点:可即时撤销、易于审计
- 缺点:需维护会话存储

### 方案 C:OAuth2 + OIDC(委托给 IdP)
- 优点:复用成熟身份提供商、支持 SSO
- 缺点:接入复杂、依赖外部可用性

### 方案 D:不透明 token + 引用查表
- 优点:撤销简单、不暴露载荷
- 缺点:校验时需查询存储,对中心化服务有依赖

## 决策
### D1:会话方案选型

**选了什么**:待人拍板,尚未确定。

## 做法
1. 待决策确定后,在 API 网关接入所选会话中间件,产出:网关会话中间件。
2. 迁移现有 cookie 会话到新方案,产出:迁移脚本。

## 验收
- [ ] **G1** 撤销会话后下一次请求返回 401。

## 风险
| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 会话存储高可用不足 | 高 | 部署 Redis 集群 + failover 演练 |

## 待确认
- **Q1** 最终会话方案 · owner: 产品 · 截止:下周三前
`

describe('refine — the verify-repair loop control flow', () => {
  it('the (a) fixture starts with exactly the STR-03 blocker', () => {
    expect(blockerRuleIds(DEGRADED_BEFORE)).toEqual(['STR-03'])
    expect(blockerRuleIds(DEGRADED_AFTER)).toEqual([])
  })

  it('(a) reaches ready with 0 blockers once the fake LLM supplies the fix', async () => {
    const llm = fakeRunner(() => DEGRADED_AFTER)
    const result = await refine(DEGRADED_BEFORE, { llm })

    expect(result.status).toBe('ready')
    expect(result.problems.filter((p) => p.severity === 'blocker')).toHaveLength(0)
    expect(result.iterations).toBe(1)
  })

  it('(b) pauses for a human when every remaining blocker is needsHuman (sample.md)', async () => {
    const sample = readFixture('tests/fixtures/sample.md')
    // Raw sample carries fixable blockers too — the loop must not pause on round 1.
    expect(blockerRuleIds(sample)).toEqual(['DEC-01', 'HYG-01', 'HYG-02', 'STR-02', 'STR-03'])
    expect(blockerRuleIds(SAMPLE_FIXED)).toEqual(['DEC-01'])

    const llm = fakeRunner(() => SAMPLE_FIXED)
    const result = await refine(sample, { llm })

    expect(result.status).toBe('paused-needs-human')
    const blockers = result.problems.filter((p) => p.severity === 'blocker')
    expect(blockers.map((p) => p.ruleId)).toEqual(['DEC-01'])
    expect(blockers.every((p) => p.needsHuman)).toBe(true)
  })

  it('(c) stalls without exhausting maxIter when the fake LLM makes no progress', async () => {
    // "每轮返回原样" — the same document back, so blockers never change.
    const llm = fakeRunner((prompt) => {
      expect(prompt).toContain('STR-03')
      return DEGRADED_BEFORE
    })
    const result = await refine(DEGRADED_BEFORE, { llm, maxIter: 3 })

    expect(result.status).toBe('stalled')
    expect(result.iterations).toBeLessThan(3)
    expect(blockerRuleIds(result.doc)).toEqual(['STR-03'])
  })

  it('halts at max-iter when repairs keep changing the blocker set without clearing it', async () => {
    // Toggle two never-clean documents so the blocker fingerprint set differs
    // each round (no stall), forcing the iteration cap to be the terminal.
    let call = 0
    const llm = fakeRunner(() => {
      call += 1
      return call % 2 === 1 ? DEGRADED_NO_STEPS : DEGRADED_BEFORE
    })
    const result = await refine(DEGRADED_BEFORE, { llm, maxIter: 3 })

    expect(result.status).toBe('max-iter')
    expect(result.iterations).toBe(3)
    expect(result.problems.filter((p) => p.severity === 'blocker').length).toBeGreaterThan(0)
  })

  it('treats an LLM failure as a stall and returns the best-so-far document', async () => {
    const llm: LlmRunner = {
      run: () => Promise.resolve({ ok: false, error: { kind: 'timeout', message: 'no CLI' } }),
    }
    const result = await refine(DEGRADED_BEFORE, { llm })

    expect(result.status).toBe('stalled')
    expect(result.doc).toBe(DEGRADED_BEFORE)
  })
})

// ── Fixture (d): plan-degraded.md — third distinct fixture shape ─────────────
// Uses tests/fixtures/plan-degraded.md (decided D1, missing verification, no non-goals, unlabelled goals).
// Blocker set: ['STR-03'] only — auto-fixable (no needsHuman). Confirms the
// refine loop handles a fixture different from DEGRADED_BEFORE and sample.md.
describe('refine — plan-degraded.md fixture (auto-fixable STR-03, third fixture shape)', () => {
  it('clears STR-03 and reaches ready in one iteration when the LLM adds a verification section', async () => {
    const source = readFixture('tests/fixtures/plan-degraded.md')
    // Confirm pre-condition: exactly one blocker before repair.
    expect(blockerRuleIds(source)).toEqual(['STR-03'])

    const fixed = source + '\n## 验收\n- [ ] 限流触发后，第 6 次请求返回 HTTP 429。\n'
    expect(blockerRuleIds(fixed)).toHaveLength(0)

    const llm = fakeRunner(() => fixed)
    const result = await refine(source, { llm })

    expect(result.status).toBe('ready')
    expect(result.iterations).toBe(1)
    expect(result.problems.filter((p) => p.severity === 'blocker')).toHaveLength(0)
  })
})
