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
import { validateStateTransition } from '../../server/services/annotations'
import type { AnnotationState } from '../../types/annotation'

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
