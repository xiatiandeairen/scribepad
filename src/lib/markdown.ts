/**
 * Markdown renderer — mdast → HTML with block-id + sentence-level spans.
 *
 * Output structure (v0.2):
 *
 *   - Each leaf block (paragraph / heading / code) carries
 *     `data-block-id="b-{srcStart}"` derived from its mdast position.
 *   - Inline content of a leaf block is split into sentence-sized chunks,
 *     each wrapped in `<span data-sentence-idx="N">…</span>`.
 *   - Visible text fragments carry source offsets via nested
 *     `<span data-source-text="..." data-src-start="N" data-src-end="M">…</span>`.
 *   - Code blocks are atomic: the whole `value` is sentence 0.
 *   - listItem and list have no block-id of their own; their child blocks
 *     (typically a paragraph) carry the id.
 *
 * Sentence boundaries are detected at top-level text nodes only — inline
 * elements (strong / em / link / inlineCode) are never split mid-element.
 * This means `**Hello.** World.` is one sentence (the period is inside the
 * `<strong>`), which is acceptable degradation for plan/design docs that
 * rarely embed sentence terminators inside inline formatting.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import type {
  Code,
  Emphasis,
  Heading,
  InlineCode,
  Link,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Strong,
  Text,
} from 'mdast'

/** Escape `& < > " '` for safe insertion into HTML text or attribute values. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format the `data-src-start="N" data-src-end="M"` attribute pair from a
 * node's position. Returns empty string if the node lacks position info
 * (which only happens for synthetic nodes — fromMarkdown always populates).
 */
function srcAttrs(node: Nodes): string {
  const pos = node.position
  if (!pos) return ''
  return ` data-src-start="${pos.start.offset ?? ''}" data-src-end="${pos.end.offset ?? ''}"`
}

interface RenderContext {
  source: string
}

function sourceTextSpan(text: string, start: number | undefined, end: number | undefined): string {
  const escaped = escapeHtml(text)
  if (typeof start !== 'number' || typeof end !== 'number') return escaped
  return `<span data-source-text="${escaped}" data-src-start="${start}" data-src-end="${end}">${escaped}</span>`
}

/** Stable per-block id derived from mdast source offset. */
function blockIdFor(node: Nodes): string {
  return `b-${node.position?.start.offset ?? 0}`
}

/**
 * Walk a text string and split it into sentence-sized fragments.
 *
 * Splits after CJK enders (。！？；) and ASCII `!?` unconditionally. Splits
 * after ASCII `.` only when the next char is whitespace, end-of-string, or a
 * CJK character — this avoids splitting `Mr.` / `v1.0` while still catching
 * sentence-ending periods in mixed Chinese/English prose. Trailing whitespace
 * after a terminator is consumed into the same fragment so the next sentence
 * starts cleanly.
 *
 * Returns parallel arrays — each `fragments[i]` is the raw text for one
 * sentence-piece, and `terminated[i]` is true iff that piece ends a sentence
 * (i.e. the next piece should start a new sentence span). The final piece
 * may be unterminated (mid-sentence text continuing into the next inline
 * element).
 */
function splitTextIntoSentences(text: string): { fragments: string[]; terminated: boolean[] } {
  const fragments: string[] = []
  const terminated: boolean[] = []
  let buf = ''

  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    buf += c

    const isCjkEnder = c === '。' || c === '！' || c === '？' || c === '；'
    let isAsciiEnder = false
    if (c === '!' || c === '?') {
      isAsciiEnder = true
    } else if (c === '.') {
      const next = text[i + 1]
      // Period only terminates when not part of a token like `Mr.` or `v1.0`.
      // CJK char after period treats it as sentence boundary.
      if (next === undefined || /[\s\u3400-\u9fff]/.test(next)) isAsciiEnder = true
    }

    if (isCjkEnder || isAsciiEnder) {
      // Pull trailing whitespace into this fragment so the next sentence
      // doesn't start with leftover spacing.
      while (i + 1 < text.length && /\s/.test(text[i + 1] ?? '')) {
        buf += text[i + 1]
        i++
      }
      fragments.push(buf)
      terminated.push(true)
      buf = ''
    }
  }

  if (buf.length > 0) {
    fragments.push(buf)
    terminated.push(false)
  }

  return { fragments, terminated }
}

/**
 * Render a leaf block's inline children into a sequence of sentence spans.
 * Sentence breaks come from top-level text nodes; inline elements (strong,
 * em, link, inlineCode) are appended whole to the current sentence.
 *
 * Tracks each sentence's source range (min srcStart .. max srcEnd of its
 * contributing fragments) and emits `data-src-start/end` on the sentence
 * span — needed by P4 splice logic to locate the source slice for a given
 * anchor without re-walking mdast.
 */
interface SentenceBuilder {
  htmlChunks: string[]
  srcStart: number | null
  srcEnd: number | null
  /** True iff every contributing chunk was a plain text fragment (no inline
   * elements). Sub-sentence char-offset splice is only safe in this case
   * because rendered char positions equal source positions. */
  plainOnly: boolean
}

function renderBlockInlines(children: readonly Nodes[], ctx: RenderContext): string {
  const sentences: SentenceBuilder[] = [
    { htmlChunks: [], srcStart: null, srcEnd: null, plainOnly: true },
  ]
  const cur = (): SentenceBuilder => sentences[sentences.length - 1]!
  const widen = (start: number, end: number): void => {
    const c = cur()
    if (c.srcStart === null || start < c.srcStart) c.srcStart = start
    if (c.srcEnd === null || end > c.srcEnd) c.srcEnd = end
  }

  for (const child of children) {
    if (child.type === 'text') {
      const value = child.value
      const baseStart = child.position?.start.offset ?? 0
      const { fragments, terminated } = splitTextIntoSentences(value)
      let cursor = 0
      for (let i = 0; i < fragments.length; i++) {
        const frag = fragments[i]!
        const start = baseStart + cursor
        const end = start + frag.length
        cur().htmlChunks.push(sourceTextSpan(frag, start, end))
        widen(start, end)
        cursor += frag.length
        if (terminated[i]) {
          sentences.push({ htmlChunks: [], srcStart: null, srcEnd: null, plainOnly: true })
        }
      }
    } else {
      // Inline element rendered whole — its rendered length usually differs
      // from its source length (e.g. `**foo**` = 7 src chars, 3 rendered),
      // so any sentence containing one loses plainOnly.
      cur().htmlChunks.push(renderNode(child, ctx))
      cur().plainOnly = false
      const start = child.position?.start.offset
      const end = child.position?.end.offset
      if (typeof start === 'number' && typeof end === 'number') widen(start, end)
    }
  }

  let html = ''
  let idx = 0
  for (const s of sentences) {
    if (s.htmlChunks.length === 0) continue
    const inner = s.htmlChunks.join('')
    if (inner.length === 0) continue
    const srcAttr =
      s.srcStart !== null && s.srcEnd !== null
        ? ` data-src-start="${s.srcStart}" data-src-end="${s.srcEnd}"`
        : ''
    const plainAttr = s.plainOnly ? ' data-plain="1"' : ''
    html += `<span data-sentence-idx="${idx}"${srcAttr}${plainAttr}>${inner}</span>`
    idx++
  }
  return html
}

function renderHeading(node: Heading, ctx: RenderContext): string {
  const depth = Math.min(Math.max(node.depth, 1), 6)
  const id = blockIdFor(node)
  return `<h${depth} data-block-id="${id}"${srcAttrs(node)}>${renderBlockInlines(node.children, ctx)}</h${depth}>`
}

function renderParagraph(node: Paragraph, ctx: RenderContext): string {
  const id = blockIdFor(node)
  return `<p data-block-id="${id}"${srcAttrs(node)}>${renderBlockInlines(node.children, ctx)}</p>`
}

function renderList(node: List, ctx: RenderContext): string {
  const tag = node.ordered ? 'ol' : 'ul'
  const startAttr =
    node.ordered && typeof node.start === 'number' && node.start !== 1
      ? ` start="${node.start}"`
      : ''
  return `<${tag}${startAttr}${srcAttrs(node)}>${renderChildren(node.children, ctx)}</${tag}>`
}

function renderListItem(node: ListItem, ctx: RenderContext): string {
  // listItem is a container, not a leaf block. Its block children (typically
  // a paragraph) each get their own block-id via renderParagraph etc.
  return `<li${srcAttrs(node)}>${renderChildren(node.children, ctx)}</li>`
}

function renderCode(node: Code): string {
  const langAttr = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : ''
  const id = blockIdFor(node)
  // Code blocks are atomic — entire value is one sentence so users can
  // address the block as a whole but never partial code lines. The sentence
  // span carries the same source range as the `<pre>` so applyRewrite
  // splices the whole fenced block (fences included).
  const start = node.position?.start.offset ?? 0
  const end = node.position?.end.offset ?? 0
  return `<pre data-block-id="${id}"${srcAttrs(node)}><code${langAttr}><span data-sentence-idx="0" data-src-start="${start}" data-src-end="${end}">${escapeHtml(node.value)}</span></code></pre>`
}

function inlineCodeSourceRange(
  node: InlineCode,
  ctx: RenderContext,
): { start?: number; end?: number } {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (typeof start !== 'number' || typeof end !== 'number') return {}

  const raw = ctx.source.slice(start, end)
  const opening = raw.match(/^`+/)?.[0] ?? '`'
  const closing = raw.match(/`+$/)?.[0] ?? '`'
  let contentStart = start + opening.length
  let contentEnd = end - closing.length

  const rawContent = ctx.source.slice(contentStart, contentEnd)
  if (
    rawContent.length >= 2 &&
    rawContent.startsWith(' ') &&
    rawContent.endsWith(' ') &&
    rawContent.slice(1, -1) === node.value
  ) {
    contentStart += 1
    contentEnd -= 1
  }

  return { start: contentStart, end: contentEnd }
}

function renderInlineCode(node: InlineCode, ctx: RenderContext): string {
  const { start, end } = inlineCodeSourceRange(node, ctx)
  return `<code>${sourceTextSpan(node.value, start, end)}</code>`
}

function renderStrong(node: Strong, ctx: RenderContext): string {
  return `<strong>${renderChildren(node.children, ctx)}</strong>`
}

function renderEmphasis(node: Emphasis, ctx: RenderContext): string {
  return `<em>${renderChildren(node.children, ctx)}</em>`
}

function renderLink(node: Link, ctx: RenderContext): string {
  const href = escapeHtml(node.url)
  const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : ''
  return `<a href="${href}"${titleAttr}>${renderChildren(node.children, ctx)}</a>`
}

function renderText(node: Text): string {
  return sourceTextSpan(node.value, node.position?.start.offset, node.position?.end.offset)
}

/** Render an array of children, concatenating their HTML output. */
function renderChildren(children: readonly Nodes[], ctx: RenderContext): string {
  let out = ''
  for (const child of children) out += renderNode(child, ctx)
  return out
}

/**
 * Recursive node renderer — switches on node type and dispatches to the
 * appropriate handler. Unknown types fall through to a best-effort render.
 */
function renderNode(node: Nodes, ctx: RenderContext): string {
  switch (node.type) {
    case 'root':
      return renderChildren(node.children, ctx)
    case 'heading':
      return renderHeading(node, ctx)
    case 'paragraph':
      return renderParagraph(node, ctx)
    case 'list':
      return renderList(node, ctx)
    case 'listItem':
      return renderListItem(node, ctx)
    case 'code':
      return renderCode(node)
    case 'inlineCode':
      return renderInlineCode(node, ctx)
    case 'strong':
      return renderStrong(node, ctx)
    case 'emphasis':
      return renderEmphasis(node, ctx)
    case 'link':
      return renderLink(node, ctx)
    case 'text':
      return renderText(node)
    case 'image':
    case 'imageReference':
      // v0.1: silently skip images.
      return ''
    default: {
      // Best-effort fallback: recurse into children if Parent, render value
      // if Literal, otherwise emit nothing. Keeps unsupported nodes from
      // crashing the renderer while their content still surfaces somewhere.
      if ('children' in node && Array.isArray(node.children)) {
        return renderChildren(node.children as Nodes[], ctx)
      }
      if ('value' in node && typeof node.value === 'string') {
        return escapeHtml(node.value)
      }
      return ''
    }
  }
}

/**
 * Parse markdown source and render it to HTML. The returned HTML carries
 * `data-block-id` on each leaf block (paragraph / heading / code) and a
 * `<span data-sentence-idx="N">` for each sentence-sized chunk inside.
 */
export function renderMarkdown(source: string): string {
  const tree = fromMarkdown(source)
  return renderNode(tree, { source })
}
