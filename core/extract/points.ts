/**
 * Section body → ExtractedItem[]. Handles the four block shapes a plan uses to
 * carry information points: paragraphs, list items (incl. GFM `- [ ]` tasks),
 * GFM table data rows, and H3 subsections (each H3 becomes a checkpoint point,
 * its body becomes detail points under that group).
 *
 * The decision section is handled separately (decisions.ts) because it also
 * emits DecisionCards; everything else routes through here.
 */
import type { List, ListItem, Nodes, Table, TableCell, TableRow } from 'mdast'
import type { ExtractedItem, SrcAnchor } from '../../types/domain.js'
import type { SectionSource } from './sections.js'
import { labelOf, scanRefs } from './labels.js'
import { compact, hash, slug, textOf } from './text.js'

interface RawItem {
  text: string
  node: Nodes
  role: 'checkpoint' | 'detail'
  groupTitle?: string
}

interface H3Group {
  heading?: string
  headingNode?: Nodes
  nodes: Nodes[]
}

/** Extract every information point from a non-decision section. */
export function pointsFromSection(section: SectionSource): ExtractedItem[] {
  const raws: RawItem[] = []
  for (const group of splitByH3(section.nodes)) {
    if (group.heading !== undefined && group.headingNode) {
      // The H3 itself is the checkpoint; its body items hang off it as details.
      raws.push({ text: group.heading, node: group.headingNode, role: 'checkpoint', groupTitle: group.heading })
      for (const raw of collectBlockItems(group.nodes)) {
        raws.push({ ...raw, role: 'detail', groupTitle: group.heading })
      }
    } else {
      for (const raw of collectBlockItems(group.nodes)) {
        raws.push({ ...raw, role: 'checkpoint' })
      }
    }
  }

  const counter = { value: 0 }
  return raws.map((raw) => buildPoint(section, raw, counter))
}

/** Split a section's body at H3 boundaries; the pre-H3 remainder is a headingless group. */
function splitByH3(nodes: Nodes[]): H3Group[] {
  const groups: H3Group[] = []
  const leading: H3Group = { nodes: [] }
  let current = leading

  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 3) {
      if (current === leading && leading.nodes.length > 0) groups.push(leading)
      current = { heading: textOf(node).trim(), headingNode: node, nodes: [] }
      groups.push(current)
    } else {
      current.nodes.push(node)
    }
  }
  if (current === leading && leading.nodes.length > 0) groups.push(leading)
  return groups
}

interface BlockItem {
  text: string
  node: Nodes
}

function collectBlockItems(nodes: Nodes[]): BlockItem[] {
  const items: BlockItem[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const text = compact(textOf(node))
      if (text) items.push({ text, node })
    } else if (node.type === 'list') {
      collectListItems(node, items)
    } else if (node.type === 'table') {
      collectTableRows(node, items)
    }
  }
  return items
}

function collectListItems(list: List, items: BlockItem[]): void {
  for (const child of list.children as ListItem[]) {
    const paragraph = child.children.find((node) => node.type === 'paragraph')
    if (paragraph) {
      const text = compact(textOf(paragraph))
      // Anchor to the whole list item so a checkbox / nested content stays in range.
      if (text) items.push({ text, node: child })
    }
    for (const nested of child.children) {
      if (nested.type === 'list') collectListItems(nested, items)
    }
  }
}

function collectTableRows(table: Table, items: BlockItem[]): void {
  const rows = table.children as TableRow[]
  // Row 0 is the GFM header; data rows start at 1.
  for (let index = 1; index < rows.length; index += 1) {
    const cells = (rows[index]!.children as TableCell[]).map((cell) => compact(textOf(cell)))
    const text = cells.filter(Boolean).join(' | ')
    if (text) items.push({ text, node: rows[index]! })
  }
}

function buildPoint(section: SectionSource, raw: RawItem, counter: { value: number }): ExtractedItem {
  const label = labelOf(section.kind, raw.text)
  const groupKey = raw.groupTitle ? slug(raw.groupTitle) : 'root'
  const id = label ?? `${section.kind}:${section.order}:${groupKey}:${counter.value}`
  counter.value += 1

  const item: ExtractedItem = {
    id,
    kind: section.kind,
    title: section.heading,
    text: raw.text,
    refs: scanRefs(raw.text, label),
    path: raw.groupTitle
      ? { sectionTitle: section.heading, groupTitle: raw.groupTitle }
      : { sectionTitle: section.heading },
    role: raw.role,
    textHash: hash(raw.text),
    source: 'rule',
  }
  if (label) item.label = label
  const anchor = anchorOf(raw.node)
  if (anchor) item.anchor = anchor
  return item
}

export function anchorOf(node: Nodes): SrcAnchor | undefined {
  const srcStart = node.position?.start.offset
  const srcEnd = node.position?.end.offset
  if (srcStart === undefined || srcEnd === undefined) return undefined
  return { srcStart, srcEnd }
}
