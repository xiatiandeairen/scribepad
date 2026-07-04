/**
 * Decision section → DecisionCards + their decision-kind points.
 *
 * Each H3 is one decision. The label comes from a `D<n>` heading prefix; a
 * `✅ 已定` marker sets status=decided. The body is read into three segments by
 * their bold lead-in words 选了什么 / 为什么 / 否掉了谁 (chosen / rationale /
 * rejected). Rejected options come from the table (or list) under 否掉了谁.
 *
 * Degradation, not failure: if the three-part structure is absent, chosen falls
 * back to the whole body, rationale to '', rejected to [] — extraction never
 * throws on a loosely-written decision; that is the validator's job.
 */
import type { List, ListItem, Nodes, Table, TableCell, TableRow } from 'mdast'
import type { DecisionCard, ExtractedItem } from '../../types/domain.js'
import type { SectionSource } from './sections.js'
import { labelOf, scanRefs } from './labels.js'
import { anchorOf } from './points.js'
import { compact, hash, textOf } from './text.js'

type SegmentKind = 'none' | 'chosen' | 'rationale' | 'rejected'

const LEADS: Array<{ keyword: string; segment: Exclude<SegmentKind, 'none'> }> = [
  { keyword: '选了什么', segment: 'chosen' },
  { keyword: '为什么', segment: 'rationale' },
  { keyword: '否掉了谁', segment: 'rejected' },
]

interface DecisionH3 {
  heading: string
  headingNode: Nodes
  nodes: Nodes[]
}

export interface DecisionExtraction {
  cards: DecisionCard[]
  points: ExtractedItem[]
}

/** Parse a decision section into cards and their corresponding points. */
export function extractDecisions(section: SectionSource): DecisionExtraction {
  const cards: DecisionCard[] = []
  const points: ExtractedItem[] = []
  let counter = 0

  for (const h3 of splitH3(section.nodes)) {
    const label = labelOf('decision', h3.heading)
    const bodyText = compact(h3.nodes.map((node) => textOf(node)).join(' '))
    const pointText = compact(`${h3.heading} ${bodyText}`)
    const id = label ?? `decision:${section.order}:root:${counter}`
    counter += 1

    const point: ExtractedItem = {
      id,
      kind: 'decision',
      title: section.heading,
      text: pointText,
      refs: scanRefs(pointText, label),
      path: { sectionTitle: section.heading },
      role: 'checkpoint',
      textHash: hash(pointText),
      source: 'rule',
    }
    if (label) point.label = label
    const anchor = decisionAnchor(h3)
    if (anchor) point.anchor = anchor
    points.push(point)

    const segments = parseSegments(h3.nodes)
    const card: DecisionCard = {
      pointId: id,
      chosen: segments.chosen,
      rationale: segments.rationale,
      rejected: segments.rejected,
      status: isDecided(h3.heading) ? 'decided' : 'pending',
    }
    if (label) card.label = label
    cards.push(card)
  }

  return { cards, points }
}

function splitH3(nodes: Nodes[]): DecisionH3[] {
  const groups: DecisionH3[] = []
  let current: DecisionH3 | undefined
  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 3) {
      current = { heading: textOf(node).trim(), headingNode: node, nodes: [] }
      groups.push(current)
    } else if (current) {
      current.nodes.push(node)
    }
  }
  return groups
}

interface Segments {
  chosen: string
  rationale: string
  rejected: Array<{ option: string; reason: string }>
}

function parseSegments(nodes: Nodes[]): Segments {
  let segment: SegmentKind = 'none'
  const chosen: string[] = []
  const rationale: string[] = []
  const body: string[] = []
  const rejected: Array<{ option: string; reason: string }> = []

  const sink = (kind: SegmentKind): string[] =>
    kind === 'chosen' ? chosen : kind === 'rationale' ? rationale : body

  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const text = compact(textOf(node))
      if (!text) continue
      const lead = detectLead(text)
      if (lead) {
        segment = lead.segment
        if (lead.rest) sink(segment).push(lead.rest)
      } else {
        sink(segment).push(text)
      }
    } else if (node.type === 'list') {
      const texts = listItemTexts(node)
      if (segment === 'rejected') {
        for (const text of texts) rejected.push(splitRejected(text))
      } else {
        sink(segment).push(...texts)
      }
    } else if (node.type === 'table') {
      if (segment === 'rejected') {
        rejected.push(...tableRejectedRows(node))
      } else {
        sink(segment).push(compact(textOf(node)))
      }
    }
  }

  let chosenText = chosen.join('\n').trim()
  if (!chosenText) chosenText = body.join('\n').trim()
  return { chosen: chosenText, rationale: rationale.join('\n').trim(), rejected }
}

function detectLead(text: string): { segment: SegmentKind; rest: string } | undefined {
  for (const { keyword, segment } of LEADS) {
    if (!text.startsWith(keyword)) continue
    const after = text.slice(keyword.length)
    const colon = after.search(/[：:]/)
    const rest = colon >= 0 ? after.slice(colon + 1).trim() : ''
    return { segment, rest }
  }
  return undefined
}

function listItemTexts(list: List): string[] {
  const texts: string[] = []
  for (const child of list.children as ListItem[]) {
    const paragraph = child.children.find((node) => node.type === 'paragraph')
    if (!paragraph) continue
    const text = compact(textOf(paragraph))
    if (text) texts.push(text)
  }
  return texts
}

function tableRejectedRows(table: Table): Array<{ option: string; reason: string }> {
  const rows = table.children as TableRow[]
  const rejected: Array<{ option: string; reason: string }> = []
  for (let index = 1; index < rows.length; index += 1) {
    const cells = (rows[index]!.children as TableCell[]).map((cell) => compact(textOf(cell)))
    const option = cells[0] ?? ''
    const reason = cells.slice(1).filter(Boolean).join(' — ')
    if (option) rejected.push({ option, reason })
  }
  return rejected
}

function splitRejected(text: string): { option: string; reason: string } {
  const match = text.match(/^(.*?)[：:—-]\s*(.*)$/)
  if (match && match[2]) return { option: match[1]!.trim(), reason: match[2].trim() }
  return { option: text, reason: '' }
}

function isDecided(heading: string): boolean {
  return /✅|已定|已决|decided/i.test(heading)
}

function decisionAnchor(h3: DecisionH3): ReturnType<typeof anchorOf> {
  const head = anchorOf(h3.headingNode)
  if (!head) return undefined
  const last = h3.nodes.length > 0 ? anchorOf(h3.nodes[h3.nodes.length - 1]!) : undefined
  return { srcStart: head.srcStart, srcEnd: last?.srcEnd ?? head.srcEnd }
}
