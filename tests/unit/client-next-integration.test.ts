/**
 * P7 slice 1 — new frontend (client-next/) data path.
 *
 * Two seams verified here (no build step, so no browser needed):
 *  1. server static mount: createApp serves client-next/ at /next/* without
 *     shadowing /api or the SPA fallback (D-5).
 *  2. adaptExtract: the *shipped* client-next/plan-contract.jsx derivation, run
 *     against a real ExtractResult from core/extract, produces the role / ui /
 *     title / decision fields the 8 section renderers consume (D-1 living doc).
 *
 * plan-contract.jsx is plain JS (no JSX / imports) that exports via Object.assign
 * (window, …); we load it by evaluating its source with a stand-in window, so the
 * assertions run against the exact code the browser ships.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import type { AppContext } from '../../server/app.js'
import { SessionManager } from '../../server/services/session-manager.js'
import { extract } from '../../core/extract/index.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

function makeApp() {
  const manager = new SessionManager({ repoRoot })
  const ctx = {
    sessionManager: manager,
    repoRoot,
    getConfig: () => ({}),
    updateAiConfig: async () => {},
  } as unknown as AppContext
  return createApp(ctx)
}

// Evaluate the shipped plan-contract.jsx with a stand-in window; harvest exports.
type Contract = {
  adaptExtract: (r: unknown, m: unknown, o?: unknown) => unknown
  buildPlanModel: (s: unknown) => Model
}
type Point = { label?: string; role?: string; kind?: string; ui: Record<string, unknown> }
type Model = {
  sections: Array<{ id: string; kind: string; badge: string }>
  legend: Array<{ k: string; n: number }>
  byKind: Record<string, Point[]>
  decisions: Array<{
    label?: string
    pick?: string
    question?: string
    core?: true
    status?: string
  }>
  meta: Record<string, string>
}
function loadContract(): Contract {
  const code = readFileSync(`${repoRoot}/client-next/plan-contract.jsx`, 'utf8')
  const win: Record<string, unknown> = {}
  new Function('window', code)(win)
  return win as unknown as Contract
}

describe('server static mount /next/* (D-5)', () => {
  const app = makeApp()

  it('serves client-next/index.html at /next/index.html', async () => {
    const res = await app.request('/next/index.html')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
  })

  it('serves /next/ as the directory index', async () => {
    const res = await app.request('/next/')
    expect(res.status).toBe(200)
  })

  it('serves jsx assets under /next/', async () => {
    const res = await app.request('/next/plan-contract.jsx')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('adaptExtract')
  })

  it('does not shadow /api', async () => {
    expect((await app.request('/api/healthz')).status).toBe(200)
  })
})

describe('adaptExtract: real ExtractResult → PLAN_MODEL (D-1)', () => {
  const { adaptExtract, buildPlanModel } = loadContract()
  const result = extract(readFileSync(`${repoRoot}/plan-data-backend.md`, 'utf8'))
  const model = buildPlanModel(
    adaptExtract(result, { project: 'scribepad', file: 'plan-data-backend.md' }),
  )
  const badge = (id: string) => model.sections.find((s) => s.id === id)?.badge
  const legend = (k: string) => model.legend.find((l) => l.k === k)?.n

  it('renders all 8 sections', () => {
    expect(model.sections.map((s) => s.id)).toEqual([
      'goal',
      'scope',
      'dec',
      'how',
      'acc',
      'risk',
      'pre',
      'open',
    ])
  })

  it('derives section badges matching the document', () => {
    expect(badge('goal')).toBe('5 约束')
    expect(badge('scope')).toBe('5 不做')
    expect(badge('dec')).toBe('4 已定')
    expect(badge('how')).toBe('6 步')
    expect(badge('acc')).toBe('9 项')
    expect(badge('risk')).toBe('2 中')
    expect(badge('pre')).toBe('4 拍板')
    expect(badge('open')).toBe('5 问')
  })

  it('derives legend counts matching the document', () => {
    expect(legend('G')).toBe(5)
    expect(legend('D')).toBe(4)
    expect(legend('R')).toBe(5)
    expect(legend('P')).toBe(4)
    expect(legend('Q')).toBe(5)
    expect(legend('B')).toBe(2)
  })

  it('splits goal into gate + bug roles (B1/B2 are bugs)', () => {
    const gates = model.byKind.goal.filter((p) => p.role === 'gate').map((p) => p.label)
    const bugs = model.byKind.goal.filter((p) => p.role === 'bug').map((p) => p.label)
    expect(gates).toEqual(['G1', 'G2', 'G3', 'G4', 'G5'])
    expect(bugs).toEqual(['B1', 'B2'])
  })

  it('maps risk table columns to ui.lvl / ui.fix / ui.risk', () => {
    const risks = model.byKind.risk
    expect(risks).toHaveLength(5)
    for (const r of risks) {
      expect(r.ui.lvl).toBeTruthy()
      expect(r.ui.fix).toBeTruthy()
      expect(r.ui.risk).toBeTruthy()
    }
    expect(risks.filter((r) => r.ui.lvl === '中')).toHaveLength(2)
  })

  it('splits scope into in / out via group', () => {
    expect(model.byKind.scope.filter((p) => p.role === 'in').length).toBeGreaterThan(0)
    expect(model.byKind.scope.filter((p) => p.role === 'out').length).toBe(5)
  })

  it('maps open-question table columns to ui.owner / ui.due / ui.blocks', () => {
    const opens = model.byKind['open-question']
    expect(opens).toHaveLength(5)
    for (const q of opens) {
      expect(q.ui.owner).toBeTruthy()
    }
  })

  it('derives precondition ui.blocks from （卡 §4.x）', () => {
    const pres = model.byKind.precondition
    expect(pres).toHaveLength(4)
    expect(pres.map((p) => p.ui.blocks)).toEqual(['§4.1', '§4.4', '§4.2', '§4.5'])
  })

  it('derives behavior steps with ui.num (rich blocks degraded)', () => {
    const steps = model.byKind.behavior
    expect(steps).toHaveLength(6)
    expect(steps.map((s) => s.ui.num)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('passes decision cards through with pick / question / core', () => {
    expect(model.decisions).toHaveLength(4)
    for (const d of model.decisions) expect(d.pick).toBeTruthy()
    const d1 = model.decisions.find((d) => d.label === 'D1')
    expect(d1?.core).toBe(true)
    expect(d1?.question).toBeTruthy()
  })

  it('derives PLAN_META (title + status from intro blockquote)', () => {
    expect(model.meta.title).toContain('三模型收敛')
    expect(model.meta.status).toBe('待 review')
    expect(model.meta.project).toBe('scribepad')
    expect(model.meta.file).toBe('plan-data-backend.md')
  })
})

// N=2: a second, structurally different plan (SOC2 auth) run through the same
// shipped adaptExtract → buildPlanModel, so the header→ui mapping is pinned by a
// document that does NOT share plan-data-backend's numbers. Real values were read
// off plan-auth-soc2.md (G1–G4 / 5 non-goals / D1–D3 decided / R1 高 + R2–R5 中 /
// P1–P4 / Q1–Q5 / 9 acceptance rows) before asserting — not copied from above.
describe('adaptExtract: SOC2 auth plan → PLAN_MODEL (D-1, N=2)', () => {
  const { adaptExtract, buildPlanModel } = loadContract()
  const result = extract(readFileSync(`${repoRoot}/plan-auth-soc2.md`, 'utf8'))
  const model = buildPlanModel(
    adaptExtract(result, { project: 'scribepad', file: 'plan-auth-soc2.md' }),
  )
  const badge = (id: string) => model.sections.find((s) => s.id === id)?.badge
  const legend = (k: string) => model.legend.find((l) => l.k === k)?.n

  it('renders all 8 sections', () => {
    expect(model.sections.map((s) => s.id)).toEqual([
      'goal',
      'scope',
      'dec',
      'how',
      'acc',
      'risk',
      'pre',
      'open',
    ])
  })

  it('derives section badges matching the document', () => {
    expect(badge('goal')).toBe('4 约束')
    expect(badge('scope')).toBe('5 不做')
    expect(badge('dec')).toBe('3 已定')
    // '0 步': soc2 writes 做法 as a GFM ordered list, whose "N." marker remark
    // strips, so deriveBehaviorSteps (which requires a literal "N." prefix, as in
    // plan-data-backend's H3 "### 1. …" headings) derives no steps. Pinned as the
    // real value — this over-fit was invisible at N=1.
    expect(badge('how')).toBe('0 步')
    expect(badge('acc')).toBe('9 项')
    expect(badge('risk')).toBe('4 中')
    expect(badge('pre')).toBe('4 拍板')
    expect(badge('open')).toBe('5 问')
  })

  it('derives legend counts matching the document', () => {
    expect(legend('G')).toBe(4)
    expect(legend('D')).toBe(3)
    expect(legend('R')).toBe(5)
    expect(legend('P')).toBe(4)
    expect(legend('Q')).toBe(5)
    expect(legend('B')).toBe(0)
  })

  it('splits goal into 4 gates and no bugs', () => {
    const gates = model.byKind.goal.filter((p) => p.role === 'gate').map((p) => p.label)
    const bugs = model.byKind.goal.filter((p) => p.role === 'bug').map((p) => p.label)
    expect(gates).toEqual(['G1', 'G2', 'G3', 'G4'])
    expect(bugs).toEqual([])
  })

  it('maps risk table columns to ui.lvl / ui.fix / ui.risk (R1 高, R2–R5 中)', () => {
    const risks = model.byKind.risk
    expect(risks).toHaveLength(5)
    for (const r of risks) {
      expect(r.ui.lvl).toBeTruthy()
      expect(r.ui.fix).toBeTruthy()
      expect(r.ui.risk).toBeTruthy()
    }
    expect(risks.map((r) => r.ui.lvl)).toEqual(['高', '中', '中', '中', '中'])
  })

  it('splits scope into 5 out non-goals', () => {
    expect(model.byKind.scope.filter((p) => p.role === 'in').length).toBeGreaterThan(0)
    expect(model.byKind.scope.filter((p) => p.role === 'out').length).toBe(5)
  })

  it('maps open-question columns to ui.owner / ui.due / ui.blocks', () => {
    const opens = model.byKind['open-question']
    expect(opens).toHaveLength(5)
    for (const q of opens) {
      expect(q.ui.owner).toBeTruthy()
      expect(q.ui.due).toBeTruthy()
    }
  })

  it('derives precondition ui.blocks from （卡 §4.x）', () => {
    const pres = model.byKind.precondition
    expect(pres).toHaveLength(4)
    expect(pres.map((p) => p.ui.blocks)).toEqual(['§4.1', '§4.3', '§4.6', '§4.5'])
  })

  it('passes decision cards through with pick / core (D1 核心, D2 / D3 not)', () => {
    expect(model.decisions).toHaveLength(3)
    for (const d of model.decisions) {
      expect(d.pick).toBeTruthy()
      expect(d.status).toBe('decided')
    }
    const d1 = model.decisions.find((d) => d.label === 'D1')
    expect(d1?.core).toBe(true)
    expect(d1?.question).toBeTruthy()
    expect(model.decisions.find((d) => d.label === 'D2')?.core).toBeFalsy()
    expect(model.decisions.find((d) => d.label === 'D3')?.core).toBeFalsy()
  })

  it('derives PLAN_META (title + status)', () => {
    expect(model.meta.title).toContain('SOC2')
    expect(model.meta.status).toBe('待 review')
    expect(model.meta.project).toBe('scribepad')
    expect(model.meta.file).toBe('plan-auth-soc2.md')
  })
})
