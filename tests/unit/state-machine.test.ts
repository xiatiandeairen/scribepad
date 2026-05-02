/**
 * Unit tests for validateStateTransition (server/services/annotations.ts).
 *
 * Covers the state machine described in docs/plan.md §1.4:
 *   draft / discussed / decided / executed
 *
 * Legal transitions are enumerated below; everything else (including
 * everything out of `executed`, which is terminal) must be rejected.
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
    ['decided', 'executed'],
    ['discussed', 'executed'],
  ]

  for (const [prev, next] of legal) {
    it(`accepts ${prev} -> ${next}`, () => {
      expect(validateStateTransition(prev, next)).toBe(true)
    })
  }
})

describe('validateStateTransition — illegal transitions', () => {
  const illegal: ReadonlyArray<[AnnotationState, AnnotationState]> = [
    // executed is terminal — nothing leaves it.
    ['executed', 'draft'],
    ['executed', 'discussed'],
    ['executed', 'decided'],
    // draft must go through discussed or decided before executing.
    ['draft', 'executed'],
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
    const states: AnnotationState[] = ['draft', 'discussed', 'decided', 'executed']
    for (const s of states) {
      expect(validateStateTransition(undefined, s)).toBe(true)
    }
  })

  it('treats prev === next as legal (idempotent write)', () => {
    const states: AnnotationState[] = ['draft', 'discussed', 'decided', 'executed']
    for (const s of states) {
      expect(validateStateTransition(s, s)).toBe(true)
    }
  })
})
