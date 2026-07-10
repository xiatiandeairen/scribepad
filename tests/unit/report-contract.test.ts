/**
 * report-contract.jsx — the review-doc "backend ⇄ frontend" contract layer.
 *
 * Mirrors the client-next-deliver.test.ts approach: no build step for client-next,
 * so we evaluate the shipped source with a stand-in `window` and assert against the
 * exact code the browser runs. Two surfaces under test:
 *
 *  1. parseReportMeta  — the review-doc header blockquote (plan/commits/日期/门禁/
 *                         复核/建议路径) → structured meta, tolerant of the extractor
 *                         collapsing the blockquote's lines into one string
 *                         (core/extract compact()).
 *  2. buildReportModel — ExtractResult (docKind:'review') + docMeta → REPORT_MODEL,
 *                         the frozen shape the rendering layer builds against.
 *
 * Input shapes follow types/domain.ts (ReviewExtract / VerdictCard /
 * ReconciliationRow / Claim / Leftover / ReviewDetail); the standard fixture below
 * hand-writes the ReviewExtract JSON the backend produces from
 * tests/fixtures/review-standard.md — the contract layer consumes it over HTTP as
 * plain JSON, so this test does not import the backend extractor.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type SrcAnchor = { srcStart: number; srcEnd: number }

type VerdictCardFixture = {
  label: string
  tag?: string
  title: string
  context?: string
  chosen?: string
  alternative?: string
  whyNotAsked?: string
  ifRejected?: string
  evidence?: string
  anchor?: SrcAnchor
}

type ReconciliationRowFixture = {
  item: string
  status: 'done' | 'deviated' | 'dropped' | 'added' | 'unknown'
  note?: string
  refs: string[]
  anchor?: SrcAnchor
}

type ClaimFixture = {
  label: string
  claim: string
  evidence?: string
  verify?: string
  unverified: boolean
  anchor?: SrcAnchor
}

type LeftoverFixture = {
  label: string
  kind: 'deferred' | 'assumption' | 'limitation' | 'unknown'
  text: string
  condition?: string
  anchor?: SrcAnchor
}

type ReviewDetailFixture = { text: string; anchor?: SrcAnchor }

type ReviewExtractFixture = {
  verdicts?: VerdictCardFixture[]
  reconciliation?: ReconciliationRowFixture[]
  claims?: ClaimFixture[]
  leftovers?: LeftoverFixture[]
  details?: ReviewDetailFixture[]
}

type ExtractResultFixture = {
  docKind: 'review'
  meta?: { title?: string; intro?: string }
  review?: ReviewExtractFixture
}

type Gate = { name: string; ok: boolean }
type ReportMeta = {
  title: string
  project: string
  file: string
  plan: string
  commits: string
  commitCount: number | null
  date: string
  gates: Gate[]
  verifyCmd: string
  readingPath: string
}
type ParsedIntro = Omit<ReportMeta, 'title' | 'project' | 'file'>

type ReportSection = { id: string; n: string; name: string; badge: string }
type ReportVerdict = VerdictCardFixture & { tagCls: string }
type ReportReconRow = ReconciliationRowFixture & { statusLabel: string }
type ReportLeftover = LeftoverFixture & { kindLabel: string }
type ReportPointEntry = {
  kind: 'verdict' | 'claim' | 'leftover'
  sec: 'verdicts' | 'claims' | 'leftovers'
  role: 'checkpoint'
  title: string
  brief: string
  refs: string[]
  point: { id: string; label: string; kind: 'review-unit'; text: string; anchor?: SrcAnchor }
}
type ReportModel = {
  docKind: 'review'
  meta: ReportMeta
  sections: ReportSection[]
  verdicts: ReportVerdict[]
  recon: ReportReconRow[]
  claims: ClaimFixture[]
  leftovers: ReportLeftover[]
  details: ReviewDetailFixture[]
  points: Record<string, ReportPointEntry>
  signable: string[]
}

type CmdItem = { id: string; icon: string; title: string; sub: string; sec?: string }
type CmdGroup = { grp: string; items: CmdItem[] }
type SelMoreItem = { id: string; icon: string; label: string; k: string }

type Net = {
  buildReportModel: (extractResult: unknown, docMeta: unknown) => ReportModel
  parseReportMeta: (intro: unknown) => ParsedIntro
  filterCommandsForDocKind: (cmds: CmdGroup[], docKind: string | undefined) => CmdGroup[]
  filterSelMoreForDocKind: (items: SelMoreItem[], docKind: string | undefined) => SelMoreItem[]
}

// Evaluate the shipped report-contract source with a stand-in window; harvest exports.
function loadNet(): Net {
  const win: Record<string, unknown> = {}
  const code = readFileSync(`${repoRoot}/client-next/report-contract.jsx`, 'utf8')
  new Function('window', code)(win)
  return win as unknown as Net
}

const net = loadNet()

// tests/fixtures/review-standard.md's header blockquote exactly as the extractor
// delivers meta.intro: three `>` lines whitespace-collapsed into one string, and
// inline-code backticks stripped (core/extract compact()/textOf).
const STANDARD_INTRO =
  'plan: $XDG_STATE_HOME/scribepad/plans/-Users-taoxia-Workspace-self-scribepad/20260709-dogfood-loop.md · commits: 1695f6c..4ebb161（18 个）· 日期: 2026-07-09 ' +
  '门禁: typecheck ✅ · lint ✅ · unit 248 ✅ · e2e 12 ✅ —— 复核: npm run typecheck && npm run lint && npm test && npm run test:e2e ' +
  '建议路径: §1 裁决(5min) → §2 对账(3min) → §4 签字(2min)；§3/§5 供抽查'

// Hand-written ReviewExtract the backend produces from tests/fixtures/review-standard.md
// (3 verdicts / 5 reconciliation rows / 4 claims / 3 leftovers / 3 details).
function standardExtract(): ExtractResultFixture {
  return {
    docKind: 'review',
    meta: {
      title: 'Review: dogfood 闭环——plan-review skill、反馈双入口与审阅面板接线全部交付',
      intro: STANDARD_INTRO,
    },
    review: {
      verdicts: [
        {
          label: 'D1',
          tag: '擅自决策',
          title: 'feedback CLI 子命令与同名文件冲突时，让真实文件优先',
          context: '实现 scribepad feedback 时发现 cwd 下若存在字面名为 feedback 的文件，语义歧义，plan 未覆盖',
          chosen: "existsSync(resolve('feedback')) 为真时按打开文档处理，子命令让位",
          alternative: '加 -- 分隔符强制区分——对用户多一层记忆负担',
          whyNotAsked: '两条路径都可逆，且文件优先与 scribepad <path> 主语义一致',
          ifRejected: '回退成本低，影响仅 CLI 入口一个分支',
          evidence: '1beeee6 / server/index.ts:31',
          anchor: { srcStart: 380, srcEnd: 900 },
        },
        {
          label: 'D2',
          tag: '对外行为',
          title: '反馈附件写入顺序改为 attachments 先、inbox 行最后',
          ifRejected: '回退成本低，影响 feedback-sink-fs 单文件',
          anchor: { srcStart: 901, srcEnd: 1400 },
        },
        {
          label: 'D3',
          tag: '性能',
          title: 'DOM 快照截断改为代理对安全的字符边界回退',
          anchor: { srcStart: 1401, srcEnd: 1900 },
        },
      ],
      reconciliation: [
        { item: 'plan-review skill（XDG 路径编码 + --wait 桥接）', status: 'done', note: '—', refs: [] },
        { item: '面板反馈弹层 + 快捷键', status: 'done', note: '—', refs: [] },
        { item: 'feedback CLI 子命令', status: 'deviated', note: '同名文件冲突处理 → D1', refs: ['D1'] },
        { item: '附件 extractSnapshot 字段', status: 'dropped', note: '无消费方，砍掉 → L3', refs: ['L3'] },
        {
          item: '（plan 外）console 环形缓冲上限 20 条',
          status: 'added',
          note: 'UI 反馈需要现场错误 → D2',
          refs: ['D2'],
        },
      ],
      claims: [
        {
          label: 'C1',
          claim: '全部 248 个单测通过',
          evidence: 'vitest run 输出',
          verify: 'npm test → 248 passed',
          unverified: false,
          anchor: { srcStart: 2300, srcEnd: 2380 },
        },
        {
          label: 'C2',
          claim: '反馈附件写失败时不留 inbox 孤行',
          evidence: 'tests/unit/feedback-sink-fs.test.ts',
          verify: 'npx vitest run tests/unit/feedback-sink-fs.test.ts → 全绿',
          unverified: false,
        },
        {
          label: 'C3',
          claim: 'e2e 彩排覆盖"审阅改变执行"全链路',
          evidence: 'tests/e2e/plan-review-rehearsal.spec.ts',
          verify: 'npm run test:e2e → 12 passed',
          unverified: false,
        },
        {
          label: 'C4',
          claim: 'skill 在多 worktree 下路径不冲突',
          unverified: true,
        },
      ],
      leftovers: [
        {
          label: 'L1',
          kind: 'deferred',
          text: '独立核验 agent（对冲执行者自述偏差）',
          condition: '抽查发现 ≥1 次证据错误',
          anchor: { srcStart: 2900, srcEnd: 2990 },
        },
        {
          label: 'L2',
          kind: 'assumption',
          text: '面板 DOM 快照 20k 字符足够还原 UI 问题现场',
          condition: '连续 3 条 UI 反馈都无需追问上下文',
        },
        { label: 'L3', kind: 'limitation', text: '反馈附件不含 extract 结果快照，分析会话需自行重算' },
      ],
      details: [
        {
          text: '1beeee6 fix(cli): 同名文件优先于 feedback 子命令 — server/index.ts',
          anchor: { srcStart: 3200, srcEnd: 3270 },
        },
        { text: 'd03159c fix(server): 附件先写、inbox 行后写 — server/adapters/feedback-sink-fs.ts' },
        { text: '4ebb161 fix(client): 代理对安全截断 — client-next/review-net.jsx' },
      ],
    },
  }
}

describe('parseReportMeta: header blockquote → structured meta', () => {
  it('parses the whitespace-collapsed standard-fixture blockquote', () => {
    const meta = net.parseReportMeta(STANDARD_INTRO)
    expect(meta).toEqual({
      plan: '$XDG_STATE_HOME/scribepad/plans/-Users-taoxia-Workspace-self-scribepad/20260709-dogfood-loop.md',
      commits: '1695f6c..4ebb161',
      commitCount: 18,
      date: '2026-07-09',
      gates: [
        { name: 'typecheck', ok: true },
        { name: 'lint', ok: true },
        { name: 'unit 248', ok: true },
        { name: 'e2e 12', ok: true },
      ],
      verifyCmd: 'npm run typecheck && npm run lint && npm test && npm run test:e2e',
      readingPath: '§1 裁决(5min) → §2 对账(3min) → §4 签字(2min)；§3/§5 供抽查',
    })
  })

  it('never throws on empty or undefined input, defaulting every field', () => {
    const empty = {
      plan: '',
      commits: '',
      commitCount: null,
      date: '',
      gates: [],
      verifyCmd: '',
      readingPath: '',
    }
    expect(net.parseReportMeta('')).toEqual(empty)
    expect(net.parseReportMeta(undefined)).toEqual(empty)
  })

  it('tolerates a gate name carrying a count (e.g. "unit 248 ✅") and a ❌ failure', () => {
    const meta = net.parseReportMeta('门禁: unit 248 ✅ · e2e ❌')
    expect(meta.gates).toEqual([
      { name: 'unit 248', ok: true },
      { name: 'e2e', ok: false },
    ])
  })

  it('unwraps verifyCmd backticks when compaction leaves them intact (template raw form)', () => {
    const meta = net.parseReportMeta('复核: `npm run gate` 建议路径: §1 → §2')
    expect(meta.verifyCmd).toBe('npm run gate')
    expect(meta.readingPath).toBe('§1 → §2')
  })

  it('parses fine when only a subset of keywords is present', () => {
    const meta = net.parseReportMeta('commits: abc123..def456 · 日期: 2026-01-01')
    expect(meta.plan).toBe('')
    expect(meta.commits).toBe('abc123..def456')
    expect(meta.date).toBe('2026-01-01')
    expect(meta.gates).toEqual([])
    expect(meta.verifyCmd).toBe('')
    expect(meta.readingPath).toBe('')
  })
})

describe('buildReportModel: full standard-fixture-shaped input', () => {
  const model = net.buildReportModel(standardExtract(), {
    project: 'scribepad',
    file: 'tests/fixtures/review-standard.md',
  })

  it('sets docKind and strips the meta title prefix', () => {
    expect(model.docKind).toBe('review')
    expect(model.meta.title).toBe('dogfood 闭环——plan-review skill、反馈双入口与审阅面板接线全部交付')
    expect(model.meta.project).toBe('scribepad')
    expect(model.meta.file).toBe('tests/fixtures/review-standard.md')
  })

  it('parses the header meta onto model.meta alongside title/project/file', () => {
    expect(model.meta.plan).toBe(
      '$XDG_STATE_HOME/scribepad/plans/-Users-taoxia-Workspace-self-scribepad/20260709-dogfood-loop.md',
    )
    expect(model.meta.commits).toBe('1695f6c..4ebb161')
    expect(model.meta.commitCount).toBe(18)
    expect(model.meta.date).toBe('2026-07-09')
    expect(model.meta.gates).toHaveLength(4)
    expect(model.meta.verifyCmd).toBe('npm run typecheck && npm run lint && npm test && npm run test:e2e')
    expect(model.meta.readingPath).toContain('§1 裁决(5min)')
  })

  it('computes the 5 fixed sections with their badges, in order', () => {
    expect(model.sections.map((s) => s.id)).toEqual(['verdicts', 'recon', 'claims', 'leftovers', 'details'])
    expect(model.sections[0]).toMatchObject({ n: '1', name: '需要你裁决', badge: '3 项' })
    // reconciliation: 1 deviated + 1 dropped + 1 added = 3
    expect(model.sections[1]).toMatchObject({ n: '2', name: '计划对账', badge: '3 偏差' })
    // claims: only C4 is marked ⚠ unverified
    expect(model.sections[2]).toMatchObject({ n: '3', name: '声明与证据', badge: '1 未核验' })
    expect(model.sections[3]).toMatchObject({ n: '4', name: '遗留与假设', badge: '3 项' })
    expect(model.sections[4]).toMatchObject({ n: '5', name: '变更明细', badge: '3 条' })
  })

  it('maps verdict tag to tagCls and passes through the rest', () => {
    const [d1, d2, d3] = model.verdicts
    expect(d1).toMatchObject({ label: 'D1', tag: '擅自决策', tagCls: 'd' })
    expect(d1.evidence).toBe('1beeee6 / server/index.ts:31')
    expect(d2).toMatchObject({ label: 'D2', tag: '对外行为', tagCls: 'p' })
    expect(d3).toMatchObject({ label: 'D3', tag: '性能', tagCls: 'q' })
  })

  it('maps reconciliation status to statusLabel and keeps item/note/refs', () => {
    expect(model.recon.map((r) => r.statusLabel)).toEqual(['按计划', '按计划', '有偏差', '未做', '新增'])
    expect(model.recon[2]).toMatchObject({ item: 'feedback CLI 子命令', note: '同名文件冲突处理 → D1', refs: ['D1'] })
  })

  it('maps leftover kind to kindLabel for every row', () => {
    expect(model.leftovers.map((l) => l.kindLabel)).toEqual(['暂缓', '假设', '已知限制'])
    expect(model.leftovers[0].condition).toBe('抽查发现 ≥1 次证据错误')
  })

  it('passes claims and details through unchanged aside from array identity', () => {
    expect(model.claims).toHaveLength(4)
    expect(model.claims[0]).toMatchObject({ label: 'C1', claim: '全部 248 个单测通过', unverified: false })
    expect(model.claims[3]).toMatchObject({ label: 'C4', unverified: true })
    expect(model.details).toHaveLength(3)
    expect(model.details[0].text).toContain('1beeee6')
  })

  it('builds signable as verdict labels then leftover labels, in order', () => {
    expect(model.signable).toEqual(['D1', 'D2', 'D3', 'L1', 'L2', 'L3'])
  })

  it('registers a points entry per verdict/claim/leftover with title/brief/anchor pass-through', () => {
    expect(model.points.D1).toMatchObject({
      kind: 'verdict',
      sec: 'verdicts',
      role: 'checkpoint',
      title: 'feedback CLI 子命令与同名文件冲突时，让真实文件优先',
      brief: '回退成本低，影响仅 CLI 入口一个分支',
      refs: [],
    })
    expect(model.points.D1.point).toMatchObject({
      id: 'D1',
      label: 'D1',
      kind: 'review-unit',
      text: 'feedback CLI 子命令与同名文件冲突时，让真实文件优先',
      anchor: { srcStart: 380, srcEnd: 900 },
    })
    // D3 carries no ifRejected — brief falls back to the title.
    expect(model.points.D3.brief).toBe('DOM 快照截断改为代理对安全的字符边界回退')

    expect(model.points.C1).toMatchObject({
      kind: 'claim',
      sec: 'claims',
      role: 'checkpoint',
      title: '全部 248 个单测通过',
      brief: '全部 248 个单测通过',
    })
    expect(model.points.C1.point.anchor).toEqual({ srcStart: 2300, srcEnd: 2380 })
    // C4 carries no anchor in the fixture; pass-through must not fabricate one.
    expect(model.points.C4.point.anchor).toBeUndefined()

    expect(model.points.L1).toMatchObject({
      kind: 'leftover',
      sec: 'leftovers',
      role: 'checkpoint',
      title: '独立核验 agent（对冲执行者自述偏差）',
      brief: '独立核验 agent（对冲执行者自述偏差）',
    })
    expect(model.points.L1.point.anchor).toEqual({ srcStart: 2900, srcEnd: 2990 })
  })
})

describe('buildReportModel: mapping coverage beyond the standard fixture', () => {
  it('maps 不可逆/安全 to r, 流程 to q, and any other tag to q', () => {
    const model = net.buildReportModel(
      {
        docKind: 'review',
        review: {
          verdicts: [
            { label: 'D1', title: 'a', tag: '不可逆' },
            { label: 'D2', title: 'b', tag: '安全' },
            { label: 'D3', title: 'c', tag: '流程' },
            { label: 'D4', title: 'd', tag: '未知分类' },
          ],
        },
      },
      {},
    )
    expect(model.verdicts.map((v) => v.tagCls)).toEqual(['r', 'r', 'q', 'q'])
  })

  it('maps an unknown reconciliation status and leftover kind to —', () => {
    const model = net.buildReportModel(
      {
        docKind: 'review',
        review: {
          reconciliation: [{ item: 'x', status: 'unknown', refs: [] }],
          leftovers: [{ label: 'L1', kind: 'unknown', text: 'x' }],
        },
      },
      {},
    )
    expect(model.recon[0].statusLabel).toBe('—')
    expect(model.leftovers[0].kindLabel).toBe('—')
  })

  it('truncates a long verdict ifRejected brief at 60 chars', () => {
    const long =
      '如果不接受这个改动，需要保留中间件校验并在每个 handler 里重复调用一次鉴权检查，带来重复代码但更容易审计，这句话刻意写得很长用来验证 60 字截断行为是否生效'
    const model = net.buildReportModel(
      { docKind: 'review', review: { verdicts: [{ label: 'D1', title: 't', ifRejected: long }] } },
      {},
    )
    expect(model.points.D1.brief).toBe(long.slice(0, 60))
  })
})

describe('buildReportModel: title prefix stripping', () => {
  it('strips a half-width "Review:" prefix', () => {
    const model = net.buildReportModel({ docKind: 'review', meta: { title: 'Review: Foo' } }, {})
    expect(model.meta.title).toBe('Foo')
  })

  it('strips a full-width "Review：" prefix', () => {
    const model = net.buildReportModel({ docKind: 'review', meta: { title: 'Review：Foo' } }, {})
    expect(model.meta.title).toBe('Foo')
  })
})

describe('buildReportModel: empty / missing review payload never throws', () => {
  it('defaults every array and never throws when review is absent', () => {
    const model = net.buildReportModel({ docKind: 'review' }, {})
    expect(model.docKind).toBe('review')
    expect(model.verdicts).toEqual([])
    expect(model.recon).toEqual([])
    expect(model.claims).toEqual([])
    expect(model.leftovers).toEqual([])
    expect(model.details).toEqual([])
    expect(model.signable).toEqual([])
    expect(model.points).toEqual({})
    expect(model.sections.map((s) => s.badge)).toEqual(['0 项', '0 偏差', '0 未核验', '0 项', '0 条'])
  })

  it('never throws when extractResult itself is null/undefined', () => {
    expect(() => net.buildReportModel(null, undefined)).not.toThrow()
    expect(() => net.buildReportModel(undefined, undefined)).not.toThrow()
    const model = net.buildReportModel(undefined, undefined)
    expect(model.docKind).toBe('review')
    expect(model.meta.title).toBe('')
    expect(model.meta.project).toBe('scribepad')
    expect(model.meta.file).toBe('')
  })

  it('never throws on a partially-populated review (some arrays missing)', () => {
    const model = net.buildReportModel({ docKind: 'review', review: { verdicts: [{ label: 'D1', title: 'x' }] } }, {})
    expect(model.verdicts).toHaveLength(1)
    expect(model.recon).toEqual([])
    expect(model.claims).toEqual([])
    expect(model.leftovers).toEqual([])
    expect(model.details).toEqual([])
    expect(model.signable).toEqual(['D1'])
  })
})

// ── filterCommandsForDocKind / filterSelMoreForDocKind ───────────────────────
//
// cmdk is wired to the static CMDS list and SelToolbar's more-menu to the
// static SEL_MORE list regardless of docKind, so 转决策卡/提为风险/提为待确认
// always fail with a confusing error on review docs (there is no document
// structure for a selection-op edit to append into), and 评审这份 plan /
// 检查悬空引用 offer commands that do not apply to a review doc. These pure
// filters drop the plan-only entries by their stable id — never by matching
// display text — when docKind is 'review'.

// Mirrors client-next/review-mock-data.jsx's CMDS/SEL_MORE shape exactly (ids
// are the load-bearing part the filters key on).
const CMDS_FIXTURE: CmdGroup[] = [
  {
    grp: 'AI 操作',
    items: [
      { id: 'ai-review', icon: 'check', title: '评审这份 plan', sub: '检查决策自洽性与 fixture 覆盖' },
      { id: 'ai-refs', icon: 'link', title: '检查悬空引用', sub: '扫描标签引用图' },
    ],
  },
  {
    grp: '定位',
    items: [
      { id: 'go-dec', icon: 'sparkF', title: '跳到 §3 决策', sub: 'D1–D4 · 核心决策', sec: 'dec' },
      { id: 'go-pre', icon: 'warn', title: '跳到 §7 前置', sub: 'P1–P4 · 等你拍板', sec: 'pre' },
      { id: 'go-acc', icon: 'check', title: '跳到 §5 验收', sub: '9 条可判定断言', sec: 'acc' },
    ],
  },
]

const SEL_MORE_FIXTURE: SelMoreItem[] = [
  { id: 'dcard', icon: 'table', label: '转为决策卡', k: '⌘D' },
  { id: 'risk', icon: 'warn', label: '提为风险项', k: '⌘R' },
  { id: 'open', icon: 'note', label: '提为待确认', k: '⌘U' },
  { id: 'explain', icon: 'info', label: '解释这段', k: '⌘/' },
]

describe('filterCommandsForDocKind', () => {
  it('drops ai-review and ai-refs (by id) on a review doc, keeping the 定位 group untouched', () => {
    const filtered = net.filterCommandsForDocKind(CMDS_FIXTURE, 'review')
    const ids = filtered.flatMap((g) => g.items.map((it) => it.id))
    expect(ids).not.toContain('ai-review')
    expect(ids).not.toContain('ai-refs')
    expect(ids).toEqual(['go-dec', 'go-pre', 'go-acc'])
  })

  it('drops the now-empty "AI 操作" group entirely rather than leaving a dangling header', () => {
    const filtered = net.filterCommandsForDocKind(CMDS_FIXTURE, 'review')
    expect(filtered.map((g) => g.grp)).toEqual(['定位'])
  })

  it('leaves the command list untouched for a plan doc (docKind undefined or "plan")', () => {
    expect(net.filterCommandsForDocKind(CMDS_FIXTURE, undefined)).toEqual(CMDS_FIXTURE)
    expect(net.filterCommandsForDocKind(CMDS_FIXTURE, 'plan')).toEqual(CMDS_FIXTURE)
  })
})

describe('filterSelMoreForDocKind', () => {
  it('drops dcard/risk/open (by id) on a review doc, keeping explain', () => {
    const filtered = net.filterSelMoreForDocKind(SEL_MORE_FIXTURE, 'review')
    expect(filtered.map((it) => it.id)).toEqual(['explain'])
  })

  it('leaves the selection more-menu untouched for a plan doc', () => {
    expect(net.filterSelMoreForDocKind(SEL_MORE_FIXTURE, undefined)).toEqual(SEL_MORE_FIXTURE)
    expect(net.filterSelMoreForDocKind(SEL_MORE_FIXTURE, 'plan')).toEqual(SEL_MORE_FIXTURE)
  })
})
