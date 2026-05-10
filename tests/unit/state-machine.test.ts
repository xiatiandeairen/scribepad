/**
 * Unit tests for validateStateTransition (server/services/annotations.ts).
 *
 * Covers the persisted state machine described in docs/plan.md §1.4:
 *   draft / discussed / decided
 *
 * Legal transitions are enumerated below; everything else must be rejected.
 *
 * `prev === undefined` represents a brand-new annotation and is always
 * accepted; `prev === next` is idempotent and also accepted.
 */
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readPlanState,
  sidecarPath,
  validateStateTransition,
  writeAnnotations,
  writePlanState,
} from '../../server/services/annotations'
import type { Annotation, AnnotationState } from '../../types/annotation'

describe('validateStateTransition — legal transitions', () => {
  const legal: ReadonlyArray<[AnnotationState, AnnotationState]> = [
    ['draft', 'discussed'],
    ['discussed', 'decided'],
    ['decided', 'draft'],
    ['discussed', 'draft'],
    ['draft', 'decided'],
  ]

  for (const [prev, next] of legal) {
    it(`accepts ${prev} -> ${next}`, () => {
      expect(validateStateTransition(prev, next)).toBe(true)
    })
  }
})

describe('validateStateTransition — illegal transitions', () => {
  const illegal: ReadonlyArray<[AnnotationState, AnnotationState]> = [
    // Cannot un-decide back into discussion (must reset to draft first).
    ['decided', 'discussed'],
  ]

  for (const [prev, next] of illegal) {
    it(`rejects ${prev} -> ${next}`, () => {
      expect(validateStateTransition(prev, next)).toBe(false)
    })
  }
})

describe('validateStateTransition — edge cases', () => {
  it('treats prev === undefined as legal (new annotation)', () => {
    const states: AnnotationState[] = ['draft', 'discussed', 'decided']
    for (const s of states) {
      expect(validateStateTransition(undefined, s)).toBe(true)
    }
  })

  it('treats prev === next as legal (idempotent write)', () => {
    const states: AnnotationState[] = ['draft', 'discussed', 'decided']
    for (const s of states) {
      expect(validateStateTransition(s, s)).toBe(true)
    }
  })
})

describe('sidecar plan state', () => {
  it('preserves plan state when annotations are written later', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-plan-state-'))
    const docPath = join(dir, 'plan.md')
    await writeFile(docPath, '# Plan\n', 'utf8')

    await writePlanState(docPath, [
      { id: 'risk:1', status: 'locked', textHash: 'abc', updatedAt: '2026-05-06' },
    ])

    const annotation: Annotation = {
      id: 'a-1',
      anchor: {
        blockId: 'b-0',
        startSentenceIdx: 0,
        endSentenceIdx: 0,
        text: 'Plan',
      },
      state: 'draft',
      status: 'open',
      history: [],
      created_at: '2026-05-06T00:00:00.000Z',
      ai_suggestion: null,
    }
    await writeAnnotations(docPath, [annotation])

    await expect(readPlanState(docPath)).resolves.toEqual([
      { id: 'risk:1', status: 'locked', textHash: 'abc', updatedAt: '2026-05-06' },
    ])
    const raw = JSON.parse(await readFile(sidecarPath(docPath), 'utf8')) as {
      annotations: unknown[]
      planState: unknown[]
    }
    expect(raw.annotations).toHaveLength(1)
    expect(raw.planState).toHaveLength(1)
  })
})
