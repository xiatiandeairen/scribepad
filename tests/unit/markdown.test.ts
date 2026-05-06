/**
 * Unit tests for renderMarkdown (src/lib/markdown.ts).
 *
 * Asserts block ids, source-offset attributes, sentence spans, and HTML escaping.
 * Uses substring assertions rather than full-string
 * equality to stay resilient to whitespace / attribute-order changes.
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/lib/markdown'

describe('renderMarkdown — basic blocks', () => {
  it('renders heading + paragraph with src offsets', () => {
    const html = renderMarkdown('# Hello\n\nworld')
    // Heading block.
    expect(html).toMatch(/<h1[^>]*data-block-id="b-0"[^>]*data-src-start="0"[^>]*data-src-end="7"/)
    expect(html).toContain('Hello')
    expect(html).toContain('</h1>')
    // Paragraph block (offsets 9..14 in source).
    expect(html).toMatch(/<p[^>]*data-block-id="b-9"[^>]*data-src-start="9"[^>]*data-src-end="14"/)
    expect(html).toContain('world')
    expect(html).toContain('</p>')
  })

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('renderMarkdown — inline formatting', () => {
  it('preserves strong / em / inlineCode wrappers with src offsets', () => {
    const html = renderMarkdown('a **b** c *d* e `f`')
    // The sentence span carries the source range; inline wrappers remain clean.
    expect(html).toMatch(
      /<span[^>]*data-sentence-idx="0"[^>]*data-src-start="0"[^>]*data-src-end="19"/,
    )
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('</strong>')
    expect(html).toContain('<em>d</em>')
    expect(html).toContain('</em>')
    expect(html).toContain('<code>f</code>')
  })
})

describe('renderMarkdown — lists', () => {
  it('renders unordered lists with li children carrying src offsets', () => {
    const html = renderMarkdown('- one\n- two')
    expect(html).toMatch(/<ul\s+data-src-start="\d+"\s+data-src-end="\d+">/)
    // Two list items, each with their own data-src range.
    const liMatches = html.match(/<li\s+data-src-start="\d+"\s+data-src-end="\d+">/g) ?? []
    expect(liMatches.length).toBe(2)
    expect(html).toContain('one')
    expect(html).toContain('two')
  })

  it('renders ordered lists as <ol> with li children carrying src offsets', () => {
    const html = renderMarkdown('1. one\n2. two')
    expect(html).toMatch(/<ol[^>]*data-src-start="\d+"[^>]*data-src-end="\d+"/)
    const liMatches = html.match(/<li\s+data-src-start="\d+"\s+data-src-end="\d+">/g) ?? []
    expect(liMatches.length).toBe(2)
  })
})

describe('renderMarkdown — escaping', () => {
  it('escapes <script> tags appearing in source', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/script&gt;')
    // No raw <script> tag survives.
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
