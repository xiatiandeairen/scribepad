/**
 * Review-doc extraction: the second document kind alongside the 8-section
 * plan (docs/design/document.md — the authoring + machine-recognition
 * contract). §1 裁决 → verdicts, §2 计划对账 → reconciliation, §3 声明与证据 →
 * claims, §4 遗留与假设 → leftovers, §5 变更明细 → details.
 *
 * Mirrors the plan path's shape (Root -> H2 sections -> per-section parse,
 * see sections.ts/points.ts) but sections classify by a small contains-match
 * keyword set distinct from the plan SECTION_ALIASES table. Degrade-never-
 * throw throughout: missing bodies, unmatched H3 units, and unrecognized
 * enum values fall back to undefined / 'unknown' instead of throwing.
 */
import type { List, ListItem, Nodes, Paragraph, Root, Table, TableCell, TableRow } from 'mdast'
import type {
  Claim,
  DocKind,
  Leftover,
  LeftoverKind,
  ReconciliationRow,
  ReconciliationStatus,
  ReviewDetail,
  ReviewExtract,
  VerdictCard,
} from '../../types/domain.js'
import { anchorOf } from './points.js'
import { normalizeHeading } from './sections.js'
import { compact, textOf } from './text.js'

type ReviewSectionKind = 'verdicts' | 'reconciliation' | 'claims' | 'leftovers' | 'details'

// Order mirrors the template's §1-§5 sequence (docs/design/document.md §识别契约).
const REVIEW_SECTION_KEYWORDS: Array<{ kind: ReviewSectionKind; contains: string }> = [
  { kind: 'verdicts', contains: '裁决' },
  { kind: 'reconciliation', contains: '对账' },
  { kind: 'claims', contains: '声明' },
  { kind: 'leftovers', contains: '遗留' },
  { kind: 'details', contains: '明细' },
]

/** Map a heading to a review-section role via contains-match, or undefined when unknown. */
function classifyReviewSection(heading: string): ReviewSectionKind | undefined {
  const normalized = normalizeHeading(heading)
  return REVIEW_SECTION_KEYWORDS.find(({ contains }) => normalized.includes(contains))?.kind
}

/**
 * docKind classifier: H1 starting with `Review:`/`Review：` wins outright;
 * otherwise >=2 H2 headings classifying as review sections vote it in.
 * Everything else is 'plan'.
 */
export function detectDocKind(tree: Root): DocKind {
  const h1 = firstH1Text(tree)
  if (h1 !== undefined && (h1.startsWith('Review:') || h1.startsWith('Review：'))) return 'review'
  return countReviewSectionVotes(tree) >= 2 ? 'review' : 'plan'
}

function firstH1Text(tree: Root): string | undefined {
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) return compact(textOf(node))
  }
  return undefined
}

function countReviewSectionVotes(tree: Root): number {
  let votes = 0
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 2 && classifyReviewSection(textOf(node).trim())) {
      votes += 1
    }
  }
  return votes
}

interface ReviewSection {
  kind: ReviewSectionKind
  nodes: Nodes[]
}

/** Split the tree at H2 boundaries and keep only sections whose heading classifies. */
function splitReviewSections(tree: Root): ReviewSection[] {
  const sections: ReviewSection[] = []
  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index]!
    if (node.type !== 'heading' || node.depth !== 2) continue
    const kind = classifyReviewSection(textOf(node).trim())
    if (!kind) continue

    const nodes: Nodes[] = []
    for (let next = index + 1; next < tree.children.length; next += 1) {
      const child = tree.children[next]!
      if (child.type === 'heading' && child.depth <= 2) break
      nodes.push(child)
    }
    sections.push({ kind, nodes })
  }
  return sections
}

/** Parse a review markdown tree into its five structured sections. */
export function extractReview(tree: Root): ReviewExtract {
  const review: ReviewExtract = {
    verdicts: [],
    reconciliation: [],
    claims: [],
    leftovers: [],
    details: [],
  }
  for (const section of splitReviewSections(tree)) {
    switch (section.kind) {
      case 'verdicts':
        review.verdicts.push(...extractVerdicts(section.nodes))
        break
      case 'reconciliation':
        review.reconciliation.push(...extractReconciliation(section.nodes))
        break
      case 'claims':
        review.claims.push(...extractClaims(section.nodes))
        break
      case 'leftovers':
        review.leftovers.push(...extractLeftovers(section.nodes))
        break
      case 'details':
        review.details.push(...extractDetails(section.nodes))
        break
    }
  }
  return review
}

// ── §1 裁决 → VerdictCard[] ─────────────────────────────────────────────────

const VERDICT_HEADING = /^D(\d+)\.\s*(?:\[([^\]]+)\])?\s*(.*)$/

type VerdictField = 'context' | 'chosen' | 'alternative' | 'whyNotAsked' | 'ifRejected' | 'evidence'

// Longest/most-specific keyword first is unnecessary here — none is a prefix of another.
const VERDICT_LEADS: Array<{ keyword: string; field: VerdictField }> = [
  { keyword: '背景', field: 'context' },
  { keyword: '我选了', field: 'chosen' },
  { keyword: '备选', field: 'alternative' },
  { keyword: '为什么没停下来问', field: 'whyNotAsked' },
  { keyword: '若否决', field: 'ifRejected' },
  { keyword: '证据', field: 'evidence' },
]

/**
 * Each H3 matching `D<n>. [<tag>] <title>` opens one verdict card; its bold-
 * lead body bullets fill the six optional fields. An H3 that does not match
 * the label pattern is skipped entirely, including its body (it never leaks
 * into the previous or next card).
 */
function extractVerdicts(nodes: Nodes[]): VerdictCard[] {
  const cards: VerdictCard[] = []
  let headingNode: Nodes | undefined
  let card: VerdictCard | undefined
  let lastNode: Nodes | undefined

  const flush = (): void => {
    if (!card || !headingNode) return
    const anchor = verdictAnchor(headingNode, lastNode)
    if (anchor) card.anchor = anchor
    cards.push(card)
  }

  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 3) {
      flush()
      card = undefined
      headingNode = undefined
      lastNode = undefined

      const match = VERDICT_HEADING.exec(compact(textOf(node)))
      if (!match) continue // unlabeled H3: skipped, including whatever body follows
      const [, num, tag, title] = match
      card = { label: `D${num}`, title: title ?? '' }
      if (tag) card.tag = tag
      headingNode = node
      continue
    }
    if (!card) continue // body under a skipped/no H3 yet
    applyVerdictBody(node, card)
    lastNode = node
  }
  flush()
  return cards
}

function applyVerdictBody(node: Nodes, card: VerdictCard): void {
  if (node.type !== 'list') return
  for (const item of (node as List).children as ListItem[]) {
    const paragraph = item.children.find((child): child is Paragraph => child.type === 'paragraph')
    if (!paragraph) continue
    const text = compact(textOf(paragraph))
    const lead = VERDICT_LEADS.find(({ keyword }) => text.startsWith(keyword))
    if (!lead) continue
    const after = text.slice(lead.keyword.length)
    const colon = after.search(/[：:]/)
    const value = (colon >= 0 ? after.slice(colon + 1) : after).trim()
    if (value) card[lead.field] = value
  }
}

function verdictAnchor(headingNode: Nodes, lastNode: Nodes | undefined) {
  const head = anchorOf(headingNode)
  if (!head) return undefined
  const last = lastNode ? anchorOf(lastNode) : undefined
  return { srcStart: head.srcStart, srcEnd: last?.srcEnd ?? head.srcEnd }
}

// ── §2 计划对账 → ReconciliationRow[] ───────────────────────────────────────

const RECONCILIATION_REF_TOKEN = /\b[DCL]\d+\b/g

function extractReconciliation(nodes: Nodes[]): ReconciliationRow[] {
  const rows: ReconciliationRow[] = []
  for (const node of nodes) {
    if (node.type === 'table') rows.push(...reconciliationRowsFromTable(node as Table))
  }
  return rows
}

function reconciliationRowsFromTable(table: Table): ReconciliationRow[] {
  const rowNodes = table.children as TableRow[]
  const headers = headerTextsOf(rowNodes)
  const itemCol = headers.findIndex((header) => header.includes('plan 条目'))
  const statusCol = headers.findIndex((header) => header.includes('状态'))
  const noteCol = headers.findIndex((header) => header.includes('说明'))

  const rows: ReconciliationRow[] = []
  for (let index = 1; index < rowNodes.length; index += 1) {
    const rowNode = rowNodes[index]!
    const cells = cellTextsOf(rowNode)
    const note = noteCol >= 0 ? cells[noteCol] : undefined
    const row: ReconciliationRow = {
      item: itemCol >= 0 ? (cells[itemCol] ?? '') : '',
      status: reconciliationStatusOf(statusCol >= 0 ? cells[statusCol] : undefined),
      refs: refsFromNote(note),
    }
    if (note) row.note = note
    const anchor = anchorOf(rowNode)
    if (anchor) row.anchor = anchor
    rows.push(row)
  }
  return rows
}

function reconciliationStatusOf(text: string | undefined): ReconciliationStatus {
  if (!text) return 'unknown'
  if (text.includes('✅') || text.includes('按计划')) return 'done'
  if (text.includes('⚠') || text.includes('有偏差')) return 'deviated'
  if (text.includes('❌') || text.includes('未做')) return 'dropped'
  if (text.includes('➕') || text.includes('新增')) return 'added'
  return 'unknown'
}

function refsFromNote(note: string | undefined): string[] {
  if (!note) return []
  return [...note.matchAll(RECONCILIATION_REF_TOKEN)].map((match) => match[0])
}

// ── §3 声明与证据 → Claim[] ─────────────────────────────────────────────────

const CLAIM_LABEL = /^C\d+$/

function extractClaims(nodes: Nodes[]): Claim[] {
  const claims: Claim[] = []
  for (const node of nodes) {
    if (node.type === 'table') claims.push(...claimsFromTable(node as Table))
  }
  return claims
}

function claimsFromTable(table: Table): Claim[] {
  const rowNodes = table.children as TableRow[]
  const headers = headerTextsOf(rowNodes)
  const claimCol = headers.findIndex((header) => header.includes('声明'))
  const evidenceCol = headers.findIndex((header) => header.includes('证据'))
  const verifyCol = headers.findIndex((header) => header.includes('核验'))

  const claims: Claim[] = []
  for (let index = 1; index < rowNodes.length; index += 1) {
    const rowNode = rowNodes[index]!
    const cells = cellTextsOf(rowNode)
    const label = cells[0] ?? ''
    if (!CLAIM_LABEL.test(label)) continue // rows without a C<n> label are dropped

    const evidence = evidenceCol >= 0 ? cells[evidenceCol] : undefined
    const verify = verifyCol >= 0 ? cells[verifyCol] : undefined
    const claim: Claim = {
      label,
      claim: claimCol >= 0 ? (cells[claimCol] ?? '') : '',
      unverified: isUnverified(evidence),
    }
    if (evidence) claim.evidence = evidence
    if (verify) claim.verify = verify
    const anchor = anchorOf(rowNode)
    if (anchor) claim.anchor = anchor
    claims.push(claim)
  }
  return claims
}

function isUnverified(evidence: string | undefined): boolean {
  if (!evidence) return false
  return evidence.includes('⚠') || evidence.toLowerCase().includes('unverified')
}

// ── §4 遗留与假设 → Leftover[] ──────────────────────────────────────────────

const LEFTOVER_ITEM = /^L(\d+)\s*(?:\[([^\]]+)\])?\s*(.*)$/
// Dash variants: em-dash-doubled, single em-dash, or a plain hyphen; the keyword
// right after (with only whitespace between) is what disambiguates it from prose.
const LEFTOVER_CONDITION = /(?:——|—|-)\s*(?:触发条件|验证方式)[：:]\s*(.*)$/

function extractLeftovers(nodes: Nodes[]): Leftover[] {
  const leftovers: Leftover[] = []
  for (const node of nodes) {
    if (node.type !== 'list') continue
    for (const item of (node as List).children as ListItem[]) {
      const leftover = leftoverFromItem(item)
      if (leftover) leftovers.push(leftover)
    }
  }
  return leftovers
}

function leftoverFromItem(item: ListItem): Leftover | undefined {
  const paragraph = item.children.find((child): child is Paragraph => child.type === 'paragraph')
  if (!paragraph) return undefined
  const text = compact(textOf(paragraph))
  const match = LEFTOVER_ITEM.exec(text)
  if (!match) return undefined // items without an L<n> label are dropped

  const [, num, bracket, remainder = ''] = match
  const conditionMatch = LEFTOVER_CONDITION.exec(remainder)
  const leftover: Leftover = {
    label: `L${num}`,
    kind: leftoverKindOf(bracket),
    text: (conditionMatch ? remainder.slice(0, conditionMatch.index) : remainder).trim(),
  }
  if (conditionMatch) leftover.condition = conditionMatch[1]!.trim()
  const anchor = anchorOf(item)
  if (anchor) leftover.anchor = anchor
  return leftover
}

function leftoverKindOf(bracket: string | undefined): LeftoverKind {
  if (!bracket) return 'unknown'
  if (bracket.includes('deferred')) return 'deferred'
  if (bracket.includes('假设') || bracket.toLowerCase().includes('assumption')) return 'assumption'
  if (bracket.includes('已知限制') || bracket.toLowerCase().includes('limitation'))
    return 'limitation'
  return 'unknown'
}

// ── §5 变更明细 → ReviewDetail[] ────────────────────────────────────────────

function extractDetails(nodes: Nodes[]): ReviewDetail[] {
  const details: ReviewDetail[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      pushDetail(details, node, node)
    } else if (node.type === 'list') {
      for (const item of (node as List).children as ListItem[]) {
        const paragraph = item.children.find(
          (child): child is Paragraph => child.type === 'paragraph',
        )
        if (paragraph) pushDetail(details, paragraph, item)
      }
    }
  }
  return details
}

function pushDetail(details: ReviewDetail[], textNode: Nodes, anchorNode: Nodes): void {
  const text = compact(textOf(textNode))
  if (!text) return
  const detail: ReviewDetail = { text }
  const anchor = anchorOf(anchorNode)
  if (anchor) detail.anchor = anchor
  details.push(detail)
}

// ── shared table helpers ────────────────────────────────────────────────────

function headerTextsOf(rowNodes: TableRow[]): string[] {
  return (
    (rowNodes[0]?.children as TableCell[] | undefined)?.map((cell) => compact(textOf(cell))) ?? []
  )
}

function cellTextsOf(rowNode: TableRow): string[] {
  return (rowNode.children as TableCell[]).map((cell) => compact(textOf(cell)))
}
