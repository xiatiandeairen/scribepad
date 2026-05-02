/**
 * Markdown renderer — mdast → HTML with source-offset annotations.
 *
 * Each non-leaf element carries `data-src-start` / `data-src-end` attributes
 * representing character offsets into the original markdown source. Text
 * nodes are wrapped in `<span data-src-start data-src-end>` so the anchor
 * algorithm (Task 5) can map DOM positions back to source offsets.
 *
 * v0.1 supports: heading, paragraph, list, listItem, code, inlineCode,
 * strong, emphasis, link, text. Unknown / unsupported nodes (e.g. image,
 * blockquote, table) degrade gracefully — Parent nodes recurse into
 * children, Literal nodes render their `value` as plain text, others emit
 * nothing.
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

/** Render an array of children, concatenating their HTML output. */
function renderChildren(children: readonly Nodes[]): string {
  let out = ''
  for (const child of children) out += renderNode(child)
  return out
}

function renderHeading(node: Heading): string {
  const depth = Math.min(Math.max(node.depth, 1), 6)
  return `<h${depth}${srcAttrs(node)}>${renderChildren(node.children)}</h${depth}>`
}

function renderParagraph(node: Paragraph): string {
  return `<p${srcAttrs(node)}>${renderChildren(node.children)}</p>`
}

function renderList(node: List): string {
  const tag = node.ordered ? 'ol' : 'ul'
  const startAttr =
    node.ordered && typeof node.start === 'number' && node.start !== 1
      ? ` start="${node.start}"`
      : ''
  return `<${tag}${startAttr}${srcAttrs(node)}>${renderChildren(node.children)}</${tag}>`
}

function renderListItem(node: ListItem): string {
  return `<li${srcAttrs(node)}>${renderChildren(node.children)}</li>`
}

function renderCode(node: Code): string {
  const langAttr = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : ''
  // <pre> + <code> form a logical unit; attach src offsets to the outer <pre>
  // so anchor mapping treats the fenced block as a single source range.
  return `<pre${srcAttrs(node)}><code${langAttr}>${escapeHtml(node.value)}</code></pre>`
}

function renderInlineCode(node: InlineCode): string {
  return `<code${srcAttrs(node)}>${escapeHtml(node.value)}</code>`
}

function renderStrong(node: Strong): string {
  return `<strong${srcAttrs(node)}>${renderChildren(node.children)}</strong>`
}

function renderEmphasis(node: Emphasis): string {
  return `<em${srcAttrs(node)}>${renderChildren(node.children)}</em>`
}

function renderLink(node: Link): string {
  const href = escapeHtml(node.url)
  const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : ''
  return `<a href="${href}"${titleAttr}${srcAttrs(node)}>${renderChildren(node.children)}</a>`
}

function renderText(node: Text): string {
  // Wrap text in a span carrying src offsets so DOM-range → source-offset
  // mapping has a stable anchor for every character of rendered prose.
  return `<span${srcAttrs(node)}>${escapeHtml(node.value)}</span>`
}

/**
 * Recursive node renderer — switches on node type and dispatches to the
 * appropriate handler. Unknown types fall through to a best-effort render.
 */
function renderNode(node: Nodes): string {
  switch (node.type) {
    case 'root':
      return renderChildren(node.children)
    case 'heading':
      return renderHeading(node)
    case 'paragraph':
      return renderParagraph(node)
    case 'list':
      return renderList(node)
    case 'listItem':
      return renderListItem(node)
    case 'code':
      return renderCode(node)
    case 'inlineCode':
      return renderInlineCode(node)
    case 'strong':
      return renderStrong(node)
    case 'emphasis':
      return renderEmphasis(node)
    case 'link':
      return renderLink(node)
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
        return renderChildren(node.children as Nodes[])
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
 * `data-src-start` / `data-src-end` attributes on every block element and
 * text span so DOM positions can be mapped back to source offsets by the
 * anchor algorithm.
 */
export function renderMarkdown(source: string): string {
  const tree = fromMarkdown(source)
  return renderNode(tree)
}
