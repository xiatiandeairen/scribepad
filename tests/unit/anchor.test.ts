/**
 * Unit tests for extractTextAtRange (src/lib/anchor.ts).
 *
 * Pure-function slice with light normalization: collapses runs of 3+ newlines
 * down to 2 and trims trailing spaces/tabs on each line. Out-of-bounds inputs
 * (negative start, end past length, end before start) return empty string.
 *
 * The DOM-bound functions (domSelectionToAnchor, locateAnchorInDom) are not
 * exercised here — they require a real DOM and are covered by the Playwright
 * suite in tests/e2e.
 */
import { describe, it, expect } from 'vitest'
import { extractTextAtRange } from '../../src/lib/anchor'

describe('extractTextAtRange — basic slice', () => {
  it('slices within bounds', () => {
    const src = 'hello world'
    expect(extractTextAtRange(src, 0, 5)).toBe('hello')
    expect(extractTextAtRange(src, 6, 11)).toBe('world')
  })

  it('returns empty string when range covers nothing', () => {
    expect(extractTextAtRange('abcdef', 3, 3)).toBe('')
  })
})

describe('extractTextAtRange — out-of-bounds', () => {
  it('returns empty for negative start', () => {
    expect(extractTextAtRange('abc', -1, 2)).toBe('')
  })

  it('returns empty when end exceeds source length', () => {
    expect(extractTextAtRange('abc', 0, 99)).toBe('')
  })

  it('returns empty when end < start', () => {
    expect(extractTextAtRange('abcdef', 4, 2)).toBe('')
  })
})

describe('extractTextAtRange — normalization', () => {
  it('collapses runs of 3+ newlines down to 2', () => {
    const src = 'foo\n\n\n\nbar'
    expect(extractTextAtRange(src, 0, src.length)).toBe('foo\n\nbar')
  })

  it('preserves a single blank line (2 newlines)', () => {
    const src = 'foo\n\nbar'
    expect(extractTextAtRange(src, 0, src.length)).toBe('foo\n\nbar')
  })

  it('trims trailing spaces and tabs on each line', () => {
    const src = 'alpha   \nbeta\t\t\ngamma'
    expect(extractTextAtRange(src, 0, src.length)).toBe('alpha\nbeta\ngamma')
  })
})
