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
  it('wraps plain paragraph text segments with source offsets', () => {
    const source = 'plain text.'
    const html = renderMarkdown(source)

    expect(html).toContain(
      '<span data-source-text="plain text." data-src-start="0" data-src-end="11">plain text.</span>',
    )
  })

  it('preserves sentence spans with source offsets', () => {
    const html = renderMarkdown('First. Second.')

    expect(html).toMatch(
      /<span[^>]*data-sentence-idx="0"[^>]*data-src-start="0"[^>]*data-src-end="7"/,
    )
    expect(html).toMatch(
      /<span[^>]*data-sentence-idx="1"[^>]*data-src-start="7"[^>]*data-src-end="14"/,
    )
  })

  it('maps strong / em / link / inlineCode visible text to source offsets', () => {
    const source = 'a **b** c *d* e `f` [g](https://example.test)'
    const html = renderMarkdown(source)
    const sourceSpan = (text: string) => {
      const start = source.indexOf(text)
      return `<span data-source-text="${text}" data-src-start="${start}" data-src-end="${start + text.length}">${text}</span>`
    }

    expect(html).toMatch(
      new RegExp(
        `<span[^>]*data-sentence-idx="0"[^>]*data-src-start="0"[^>]*data-src-end="${source.length}"`,
      ),
    )
    expect(html).toContain(`<strong>${sourceSpan('b')}</strong>`)
    expect(html).toContain('</strong>')
    expect(html).toContain(`<em>${sourceSpan('d')}</em>`)
    expect(html).toContain('</em>')
    expect(html).toContain(`<code>${sourceSpan('f')}</code>`)
    expect(html).toContain(`<a href="https://example.test">${sourceSpan('g')}</a>`)
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
