import { fromMarkdown } from 'mdast-util-from-markdown'
import type { List, ListItem, Nodes, Paragraph, Root } from 'mdast'
import type {
  EffectiveReviewMode,
  PlanItem,
  PlanItemKind,
  PlanItemState,
  PlanItemStatus,
  PlanReadinessIssue,
  PlanReadinessSummary,
  PlanReviewGroup,
  PlanReviewSection,
  ReviewMode,
  ReviewNodeRole,
  ReviewStructureQuality,
} from '../../types/plan'

const REVIEW_SECTIONS: Array<{ kind: PlanItemKind; title: string; aliases: string[] }> = [
  { kind: 'goal', title: '目标', aliases: ['目标', 'goal'] },
  { kind: 'scope', title: '范围', aliases: ['范围', 'scope'] },
  { kind: 'behavior', title: '方案', aliases: ['方案', 'approach', 'solution'] },
  { kind: 'verification', title: '验收', aliases: ['验收', 'acceptance'] },
  { kind: 'open-question', title: '待确认', aliases: ['待确认', 'open questions'] },
]

const REQUIRED_REVIEW_KINDS: PlanItemKind[] = ['goal', 'scope', 'behavior', 'verification']

const EMPTY_KIND_COUNTS: Record<PlanItemKind, number> = {
  goal: 0,
  scope: 0,
  behavior: 0,
  verification: 0,
  'open-question': 0,
}

interface SectionSpec {
  kind: PlanItemKind
  title: string
}

interface SectionSource {
  spec: SectionSpec
  order: number
  nodes: Nodes[]
}

export function inspectPlan(
  source: string,
  planState: readonly PlanItemState[] = [],
  preferredMode: ReviewMode = 'auto',
): { items: PlanItem[]; sections: PlanReviewSection[]; summary: PlanReadinessSummary } {
  const tree = fromMarkdown(source)
  const stateById = new Map(planState.map((state) => [state.id, state]))
  const sections = splitH2Sections(tree)
    .map(parseSection)
    .filter((section) => section.total > 0)
    .map((section) => mergeSectionState(section, stateById))
  const items = checkpointsInSections(sections)
  const quality = resolveStructureQuality(sections)
  const mode = resolveReviewMode(items, preferredMode)
  return { items, sections, summary: summarizePlanItems(items, mode, quality) }
}

export function resolveReviewMode(
  items: readonly Pick<PlanItem, 'kind'>[],
  preferredMode: ReviewMode = 'auto',
): EffectiveReviewMode {
  if (preferredMode !== 'auto') return preferredMode
  return items.length > 0 ? 'structured' : 'annotation-only'
}

export function summarizePlanItems(
  items: readonly PlanItem[],
  mode: EffectiveReviewMode,
  quality: ReviewStructureQuality,
): PlanReadinessSummary {
  const byKind: Record<PlanItemKind, number> = { ...EMPTY_KIND_COUNTS }
  for (const item of items) byKind[item.kind] += 1

  const missingRequiredSections = REQUIRED_REVIEW_KINDS.filter((kind) => byKind[kind] === 0)
  const issues: PlanReadinessIssue[] = []
  if (mode === 'annotation-only') {
    return {
      mode,
      structureQuality: 'unavailable',
      missingRequiredSections,
      total: 0,
      resolved: 0,
      locked: 0,
      byKind,
      issues: [
        {
          id: 'review-structure-needed',
          severity: 'info',
          text: '未识别到 Review 目录结构',
        },
      ],
    }
  }

  if (quality === 'partial') {
    issues.push({
      id: 'review-structure-partial',
      severity: 'info',
      text: 'Review 目录结构不完整，建议规范化',
    })
  }

  for (const kind of missingRequiredSections) {
    const title = REVIEW_SECTIONS.find((section) => section.kind === kind)?.title ?? kind
    issues.push({
      id: `missing-${kind}`,
      severity: 'info',
      text: `${title}未识别到可 review 内容`,
    })
  }

  for (const item of items) {
    if (item.status === 'stale') {
      issues.push({
        id: `stale-${item.id}`,
        severity: 'warning',
        text: `${item.sectionTitle ?? item.title} 需复核`,
        itemId: item.id,
      })
    }
  }

  const openQuestions = items.filter(
    (item) => item.kind === 'open-question' && item.status === 'open',
  ).length
  if (openQuestions > 0) {
    issues.push({
      id: 'open-questions',
      severity: 'warning',
      text: `${openQuestions} 个待确认点需要处理`,
    })
  }

  return {
    mode,
    structureQuality: quality,
    missingRequiredSections,
    total: items.length,
    resolved: items.filter((item) => item.status === 'locked').length,
    locked: items.filter((item) => item.status === 'locked').length,
    byKind,
    issues,
  }
}

function splitH2Sections(tree: Root): SectionSource[] {
  const sections: SectionSource[] = []
  let order = 0

  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index]
    if (node.type !== 'heading' || node.depth !== 2) continue

    const spec = classifyReviewSection(textOf(node).trim())
    if (!spec) continue

    const nodes: Nodes[] = []
    for (let next = index + 1; next < tree.children.length; next += 1) {
      const child = tree.children[next]
      if (child.type === 'heading' && child.depth <= 2) break
      nodes.push(child)
    }
    sections.push({ spec, order, nodes })
    order += 1
  }

  return sections
}

function parseSection(source: SectionSource): PlanReviewSection {
  switch (source.spec.kind) {
    case 'goal':
      return parseItemCheckpointSection(source)
    case 'open-question':
      return parseItemCheckpointSection(source)
    case 'scope':
      return parseScopeSection(source)
    case 'behavior':
      return parseGroupedSection(source, source.spec.title)
    case 'verification':
      return parseGroupedSection(source, source.spec.title)
    default:
      return emptySection(source.spec, source.order)
  }
}

function parseItemCheckpointSection(source: SectionSource): PlanReviewSection {
  const groups: PlanReviewGroup[] = []
  const items: PlanItem[] = []
  let itemOrder = 0
  let groupOrder = 0

  for (let index = 0; index < source.nodes.length; index += 1) {
    const node = source.nodes[index]
    if (node.type === 'heading' && node.depth === 3) {
      const { nodes, endIndex } = collectUntilNextH3(source.nodes, index + 1)
      const group = groupShell(source.spec, source.order, textOf(node).trim(), groupOrder)
      group.items = collectDetails(nodes, source.spec, source.order, group).map((detail, order) =>
        markCheckpoint({ ...detail, itemOrder: order }),
      )
      if (group.items.length > 0) groups.push(group)
      groupOrder += 1
      index = endIndex
      continue
    }

    if (node.type === 'list') {
      const directItems: PlanItem[] = []
      collectListItems(node, source.spec, source.order, undefined, 0, itemOrder, directItems)
      for (const item of directItems) {
        items.push(markCheckpoint(item))
        itemOrder += 1
      }
      continue
    }

    if (node.type === 'paragraph') {
      const text = textOf(node).trim()
      if (!text || isLabelText(text)) continue
      items.push(
        markCheckpoint(
          itemFromNode(node, source.spec, source.order, undefined, 0, itemOrder, text),
        ),
      )
      itemOrder += 1
    }
  }

  return sectionFromParts(source.spec, source.order, items, [], groups)
}

function parseScopeSection(source: SectionSource): PlanReviewSection {
  const h3Groups = collectH3Groups(source)
  if (h3Groups.length > 0) {
    return sectionFromParts(source.spec, source.order, [], [], h3Groups)
  }

  const labelGroups = collectLabelGroups(source)
  if (labelGroups.length > 0) {
    return sectionFromParts(source.spec, source.order, [], [], labelGroups)
  }

  const details = collectDetails(source.nodes, source.spec, source.order, undefined)
  if (details.length === 0) return emptySection(source.spec, source.order)
  const buckets: Array<{ title: string; details: PlanItem[] }> = [
    { title: '包含', details: [] },
    { title: '不包含', details: [] },
    { title: '依赖/约束', details: [] },
  ]
  for (const detail of details) {
    if (matches(detail.text, ['不包含', '范围外', 'out of scope', '不做', '排除', '不支持'])) {
      buckets[1]!.details.push(detail)
    } else if (matches(detail.text, ['依赖', '约束', '风险', '限制', '前提', '成本'])) {
      buckets[2]!.details.push(detail)
    } else {
      buckets[0]!.details.push(detail)
    }
  }
  const groups = buckets
    .filter((bucket) => bucket.details.length > 0)
    .map((bucket, index) =>
      virtualGroup(source.spec, source.order, bucket.title, index, bucket.details),
    )
  return sectionFromParts(source.spec, source.order, [], [], groups)
}

function parseGroupedSection(source: SectionSource, fallbackTitle: string): PlanReviewSection {
  const h3Groups = collectH3Groups(source)
  if (h3Groups.length > 0) {
    return sectionFromParts(source.spec, source.order, [], [], h3Groups)
  }

  const labelGroups = collectLabelGroups(source)
  if (labelGroups.length > 0) {
    return sectionFromParts(source.spec, source.order, [], [], labelGroups)
  }

  const details = collectDetails(source.nodes, source.spec, source.order, undefined)
  if (details.length === 0) return emptySection(source.spec, source.order)
  return sectionFromParts(
    source.spec,
    source.order,
    [],
    [],
    [virtualGroup(source.spec, source.order, fallbackTitle, 0, details)],
  )
}

function collectH3Groups(source: SectionSource): PlanReviewGroup[] {
  const groups: PlanReviewGroup[] = []
  let order = 0
  for (let index = 0; index < source.nodes.length; index += 1) {
    const node = source.nodes[index]
    if (node.type !== 'heading' || node.depth !== 3) continue
    const title = textOf(node).trim()
    const { nodes, endIndex } = collectUntilNextH3(source.nodes, index + 1)
    const group = groupShell(source.spec, source.order, title, order)
    group.details = collectDetails(nodes, source.spec, source.order, group)
    if (group.details.length > 0) {
      group.checkpoint = groupCheckpoint(node, source.spec, source.order, group, group.details)
      groups.push(group)
      order += 1
    }
    index = endIndex
  }
  return groups
}

function collectLabelGroups(source: SectionSource): PlanReviewGroup[] {
  const groups: PlanReviewGroup[] = []
  let order = 0

  for (let index = 0; index < source.nodes.length; index += 1) {
    const node = source.nodes[index]
    if (node.type !== 'paragraph') continue
    const label = labelFromParagraph(node)
    if (!label) continue

    const detailNodes: Nodes[] = []
    for (let next = index + 1; next < source.nodes.length; next += 1) {
      const child = source.nodes[next]
      if (child.type === 'heading') break
      if (child.type === 'paragraph' && labelFromParagraph(child)) break
      detailNodes.push(child)
    }
    const title = label
    const group = groupShell(source.spec, source.order, title, order)
    group.details = collectDetails(detailNodes, source.spec, source.order, group)
    if (group.details.length > 0) {
      group.checkpoint = aggregateCheckpoint(source.spec, source.order, group, group.details, title)
      groups.push(group)
      order += 1
    }
    index += detailNodes.length
  }

  return groups
}

function collectDetails(
  nodes: readonly Nodes[],
  spec: SectionSpec,
  sectionOrder: number,
  group: PlanReviewGroup | undefined,
): PlanItem[] {
  const details: PlanItem[] = []
  let itemOrder = 0
  for (const node of nodes) {
    if (node.type === 'list') {
      itemOrder = collectListItems(node, spec, sectionOrder, group, 0, itemOrder, details)
      continue
    }
    if (node.type === 'paragraph') {
      const text = textOf(node).trim()
      if (!text || isLabelText(text)) continue
      details.push(itemFromNode(node, spec, sectionOrder, group, 0, itemOrder, text))
      itemOrder += 1
    }
  }
  return details.map(markDetail)
}

function collectUntilNextH3(
  nodes: readonly Nodes[],
  startIndex: number,
): { nodes: Nodes[]; endIndex: number } {
  const collected: Nodes[] = []
  let endIndex = startIndex - 1
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.type === 'heading' && node.depth <= 3) break
    collected.push(node)
    endIndex = index
  }
  return { nodes: collected, endIndex }
}

function collectListItems(
  list: List,
  section: SectionSpec,
  sectionOrder: number,
  group: PlanReviewGroup | undefined,
  depth: number,
  startOrder: number,
  items: PlanItem[],
): number {
  let itemOrder = startOrder
  for (const child of list.children) {
    const listItem = child as ListItem
    const firstParagraph = listItem.children.find(
      (node): node is Paragraph => node.type === 'paragraph',
    )
    if (firstParagraph) {
      const text = textOf(firstParagraph).trim()
      if (text && !isLabelText(text)) {
        items.push(
          itemFromNode(firstParagraph, section, sectionOrder, group, depth, itemOrder, text),
        )
        itemOrder += 1
      }
    }

    for (const nested of listItem.children) {
      if (nested.type === 'list') {
        itemOrder = collectListItems(
          nested,
          section,
          sectionOrder,
          group,
          depth + 1,
          itemOrder,
          items,
        )
      }
    }
  }
  return itemOrder
}

function sectionFromParts(
  spec: SectionSpec,
  order: number,
  items: PlanItem[],
  details: PlanItem[],
  groups: PlanReviewGroup[],
): PlanReviewSection {
  const checkpoints = [...items, ...groups.flatMap((group) => checkpointItems(group))]
  return {
    id: `${spec.kind}:${order}`,
    kind: spec.kind,
    title: spec.title,
    order,
    items,
    details,
    groups,
    total: checkpoints.length,
    locked: 0,
    open: checkpoints.length,
    stale: 0,
  }
}

function emptySection(spec: SectionSpec, order: number): PlanReviewSection {
  return sectionFromParts(spec, order, [], [], [])
}

function groupShell(
  spec: SectionSpec,
  sectionOrder: number,
  title: string,
  order: number,
): PlanReviewGroup {
  return {
    id: `${spec.kind}:${sectionOrder}:group:${order}`,
    title,
    sectionKind: spec.kind,
    sectionTitle: spec.title,
    order,
    items: [],
    details: [],
  }
}

function virtualGroup(
  spec: SectionSpec,
  sectionOrder: number,
  title: string,
  order: number,
  details: readonly PlanItem[],
): PlanReviewGroup {
  const group = groupShell(spec, sectionOrder, title, order)
  group.details = details.map((detail) => ({ ...detail, groupTitle: title, groupOrder: order }))
  group.checkpoint = aggregateCheckpoint(spec, sectionOrder, group, group.details, title)
  return group
}

function groupCheckpoint(
  node: Nodes,
  spec: SectionSpec,
  sectionOrder: number,
  group: PlanReviewGroup,
  details: readonly PlanItem[],
): PlanItem {
  const checkpoint = itemFromNode(node, spec, sectionOrder, group, 0, 0, group.title, 'checkpoint')
  checkpoint.srcEnd = rangeEnd(details)
  checkpoint.textHash = hash(details.map((detail) => detail.text).join('\n'))
  return checkpoint
}

function aggregateCheckpoint(
  spec: SectionSpec,
  sectionOrder: number,
  group: PlanReviewGroup,
  details: readonly PlanItem[],
  text: string,
): PlanItem {
  const first = details[0]
  const srcStart = first?.srcStart ?? 0
  const checkpoint: PlanItem = {
    id: `${spec.kind}:${sectionOrder}:${slug(group.title)}:checkpoint`,
    kind: spec.kind,
    title: spec.title,
    sectionTitle: spec.title,
    sectionOrder,
    groupTitle: group.title,
    groupOrder: group.order,
    itemOrder: 0,
    depth: 0,
    role: 'checkpoint',
    text,
    textHash: hash(details.map((detail) => detail.text).join('\n')),
    blockId: first?.blockId ?? `b-${srcStart}`,
    srcStart,
    srcEnd: rangeEnd(details),
    status: 'open',
  }
  return checkpoint
}

function itemFromNode(
  node: Nodes,
  section: SectionSpec,
  sectionOrder: number,
  group: PlanReviewGroup | undefined,
  depth: number,
  itemOrder: number,
  text: string,
  role: ReviewNodeRole = 'detail',
): PlanItem {
  const srcStart = node.position?.start.offset ?? 0
  const srcEnd = node.position?.end.offset ?? srcStart
  const compact = text.replace(/\s+/g, ' ').trim()
  const groupKey = group ? slug(group.title) : 'root'
  const item: PlanItem = {
    id: `${section.kind}:${sectionOrder}:${groupKey}:${itemOrder}`,
    kind: section.kind,
    title: section.title,
    sectionTitle: section.title,
    sectionOrder,
    itemOrder,
    depth,
    role,
    text: compact,
    textHash: hash(compact),
    blockId: `b-${srcStart}`,
    srcStart,
    srcEnd,
    status: 'open',
  }
  if (group) {
    item.groupTitle = group.title
    item.groupOrder = group.order
  }
  return item
}

function markCheckpoint(item: PlanItem): PlanItem {
  return { ...item, role: 'checkpoint' }
}

function markDetail(item: PlanItem): PlanItem {
  return { ...item, role: 'detail' }
}

function checkpointsInSections(sections: readonly PlanReviewSection[]): PlanItem[] {
  return sections.flatMap((section) => [
    ...section.items,
    ...section.groups.flatMap((group) => checkpointItems(group)),
  ])
}

function checkpointItems(group: PlanReviewGroup): PlanItem[] {
  return [...(group.checkpoint ? [group.checkpoint] : []), ...group.items]
}

function mergeSectionState(
  section: PlanReviewSection,
  stateById: ReadonlyMap<string, PlanItemState>,
): PlanReviewSection {
  const items = section.items.map((item) => mergeState(item, stateById.get(item.id)))
  const groups = section.groups.map((group) => ({
    ...group,
    checkpoint: group.checkpoint
      ? mergeState(group.checkpoint, stateById.get(group.checkpoint.id))
      : undefined,
    items: group.items.map((item) => mergeState(item, stateById.get(item.id))),
  }))
  const checkpoints = [...items, ...groups.flatMap((group) => checkpointItems(group))]
  return {
    ...section,
    items,
    groups,
    total: checkpoints.length,
    locked: checkpoints.filter((item) => item.status === 'locked').length,
    open: checkpoints.filter((item) => item.status === 'open').length,
    stale: checkpoints.filter((item) => item.status === 'stale').length,
  }
}

function mergeState(item: PlanItem, state: PlanItemState | undefined): PlanItem {
  if (!state) return item
  const persistedStatus = state.status as PlanItemState['status'] | 'confirmed'
  const normalizedStatus: PlanItemState['status'] =
    persistedStatus === 'confirmed' ? 'locked' : persistedStatus
  const status: PlanItemStatus =
    normalizedStatus === 'locked' && state.textHash !== item.textHash ? 'stale' : normalizedStatus
  return { ...item, status }
}

function resolveStructureQuality(sections: readonly PlanReviewSection[]): ReviewStructureQuality {
  if (sections.length === 0) return 'unavailable'
  const present = new Set(
    sections.filter((section) => section.total > 0).map((section) => section.kind),
  )
  return REQUIRED_REVIEW_KINDS.every((kind) => present.has(kind)) ? 'ready' : 'partial'
}

function labelFromParagraph(node: Paragraph): string | null {
  return labelFromText(textOf(node).trim())
}

function labelFromText(text: string): string | null {
  const normalized = text.replace(/^[\s\d.、-]+/, '').trim()
  if (!/[：:]$/.test(normalized)) return null
  const label = normalized.replace(/[：:]\s*$/, '').trim()
  if (!label) return null
  if ([...label].length > 20 && label.length > 40) return null
  return label
}

function isLabelText(text: string): boolean {
  return labelFromText(text) !== null
}

function classifyReviewSection(text: string): SectionSpec | null {
  const normalized = normalizeHeading(text)
  for (const section of REVIEW_SECTIONS) {
    if (section.aliases.some((alias) => normalizeHeading(alias) === normalized)) {
      return { kind: section.kind, title: section.title }
    }
  }
  return null
}

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[\s#\d.、-]+/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

function matches(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function textOf(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as Nodes[]).map(textOf).join('')
  }
  return ''
}

function rangeEnd(items: readonly PlanItem[]): number {
  return items.reduce((end, item) => Math.max(end, item.srcEnd), items[0]?.srcEnd ?? 0)
}

function slug(value: string): string {
  return hash(value.replace(/\s+/g, ' ').trim())
}

function hash(value: string): string {
  let n = 0
  for (let i = 0; i < value.length; i++) {
    n = (n * 31 + value.charCodeAt(i)) >>> 0
  }
  return n.toString(36)
}
