/**
 * Unit tests for core/annotation-state.ts (the extracted pure state machine).
 *
 * Mirrors the semantics locked by tests/unit/state-machine.test.ts for the
 * original server/services/annotations.ts implementation: the P3a hexagonal
 * split must not change any transition rule.
 *
 * State machine (docs/plan.md §1.4): draft / discussed / decided.
 * `prev === undefined` (new annotation) and `prev === next` (idempotent) are
 * always accepted; everything outside the legal set is rejected.
 */
import { describe, it, expect } from 'vitest'
import { validateStateTransition } from '../../core/annotation-state.js'
import type { AnnotationState } from '../../types/annotation.js'

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
  const states: AnnotationState[] = ['draft', 'discussed', 'decided']

  it('treats prev === undefined as legal (new annotation)', () => {
    for (const s of states) {
      expect(validateStateTransition(undefined, s)).toBe(true)
    }
  })

  it('treats prev === next as legal (idempotent write)', () => {
    for (const s of states) {
      expect(validateStateTransition(s, s)).toBe(true)
    }
  })
})
