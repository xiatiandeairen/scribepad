import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extract } from '../../core/extract/index.js'
import { applyRewrites } from '../../core/rewrite.js'
import type { EditAt } from '../../core/rewrite.js'
import { locateSectionInsertAt, nextLabel } from '../../core/section-insert.js'
import { renderSelectionFragment } from '../../core/agent/tasks/selectionEdit.js'
import type { SelectionEditResult } from '../../core/agent/tasks/selectionEdit.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readFixture = (name: string): string => readFileSync(join(repoRoot, name), 'utf8')

const SOURCE = readFixture('tests/fixtures/plan-auth-soc2.md')

/** Splice a rendered fragment at the located insert point, then re-extract. */
function insertAndReextract(source: string, result: SelectionEditResult, label: string) {
  const before = extract(source)
  const kind = { dcard: 'decision', risk: 'risk', open: 'open-question' }[result.op] as never
  const located = locateSectionInsertAt(before, kind)
  if (!located.ok) throw new Error(located.error.message)
  const edit: EditAt = {
    srcStart: located.value,
    srcEnd: located.value,
    selection: '',
    rewritten: renderSelectionFragment(result, label),
  }
  const applied = applyRewrites(source, [edit])
  if (!applied.ok) throw new Error(applied.error.message)
  return { content: applied.value, after: extract(applied.value), before }
}

// ── locate insertion point ───────────────────────────────────────────────────

describe('locateSectionInsertAt', () => {
  it('locates the decision insert point past the last decision point', () => {
    const ex = extract(SOURCE)
    const located = locateSectionInsertAt(ex, 'decision')
    expect(located.ok).toBe(true)
    if (located.ok) {
      const lastDecisionEnd = Math.max(
        ...ex.points.filter((p) => p.kind === 'decision' && p.anchor).map((p) => p.anchor!.srcEnd),
      )
      expect(located.value).toBe(lastDecisionEnd)
    }
  })

  it('locates the risk insert point right after the last table row', () => {
    const ex = extract(SOURCE)
    const located = locateSectionInsertAt(ex, 'risk')
    expect(located.ok).toBe(true)
    // The offset must sit inside the risk section, before the following ## 前置.
    if (located.ok) {
      const precondStart = SOURCE.indexOf('## 前置')
      const riskStart = SOURCE.indexOf('## 风险')
      expect(located.value).toBeGreaterThan(riskStart)
      expect(located.value).toBeLessThan(precondStart)
    }
  })

  it('locates the open-question insert point at the end of 待确认', () => {
    const ex = extract(SOURCE)
    const located = locateSectionInsertAt(ex, 'open-question')
    expect(located.ok).toBe(true)
    if (located.ok) expect(located.value).toBeGreaterThan(SOURCE.indexOf('## 待确认'))
  })

  it('errors when the target section has no anchored point', () => {
    const ex = extract('# Plan\n\n## 目标\n- **G1** 基础目标：X。\n')
    const located = locateSectionInsertAt(ex, 'risk')
    expect(located.ok).toBe(false)
    if (!located.ok) expect(located.error.kind).toBe('section-missing')
  })
})

// ── next label (顺延) ─────────────────────────────────────────────────────────

describe('nextLabel', () => {
  it('continues the ordinal per kind (D1–D3 → D4, R5 → R6, Q5 → Q6)', () => {
    const ex = extract(SOURCE)
    expect(nextLabel(ex, 'decision')).toBe('D4')
    expect(nextLabel(ex, 'risk')).toBe('R6')
    expect(nextLabel(ex, 'open-question')).toBe('Q6')
  })

  it('starts at <prefix>1 when the kind has no labelled point', () => {
    const ex = extract('# Plan\n\n## 目标\n- **G1** 基础目标：X。\n')
    expect(nextLabel(ex, 'risk')).toBe('R1')
  })
})

// ── insert then re-extract: the new item lands with the continued label ───────

describe('renderSelectionFragment + applyRewrites (insert then re-extract)', () => {
  it('appends a risk row that re-extracts as R6 without renumbering R1–R5', () => {
    const draft: SelectionEditResult = {
      op: 'risk',
      fields: {
        risk: '缓存击穿导致 Redis 压力',
        impact: '延迟升高',
        mitigation: '单飞 + 本地兜底',
      },
    }
    const { after, before } = insertAndReextract(SOURCE, draft, 'R6')
    const riskLabels = after.points.filter((p) => p.kind === 'risk' && p.label).map((p) => p.label)
    expect(riskLabels).toContain('R6')
    // Existing R-labels are unchanged (still R1..R5 present).
    for (const prev of before.points.filter((p) => p.kind === 'risk' && p.label)) {
      expect(riskLabels).toContain(prev.label)
    }
  })

  it('appends an open-question that re-extracts as Q6', () => {
    const draft: SelectionEditResult = { op: 'open', fields: { question: '缓存 TTL 取值待定' } }
    const { after } = insertAndReextract(SOURCE, draft, 'Q6')
    const q6 = after.points.find((p) => p.label === 'Q6')
    expect(q6).toBeDefined()
    expect(q6!.kind).toBe('open-question')
  })

  it('appends a decision card that re-extracts as D4 with a card', () => {
    const draft: SelectionEditResult = {
      op: 'dcard',
      fields: { title: '会话存储选型', chosen: 'Redis', rationale: '即时撤销', rejected: [] },
    }
    const { after } = insertAndReextract(SOURCE, draft, 'D4')
    const d4 = after.points.find((p) => p.label === 'D4')
    expect(d4).toBeDefined()
    expect(d4!.kind).toBe('decision')
    expect(after.decisions.some((c) => c.label === 'D4')).toBe(true)
  })
})
