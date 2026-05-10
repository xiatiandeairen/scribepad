import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Heading, List, ListItem, Nodes, Paragraph, Root } from 'mdast'
import type {
  EffectiveReviewMode,
  PlanItem,
  PlanItemKind,
  PlanItemState,
  PlanItemStatus,
  PlanReadinessIssue,
  PlanReadinessSummary,
  ReviewMode,
} from '../../types/plan'

const KIND_LABELS: Record<PlanItemKind, string> = {
  goal: '目标',
  scope: '范围',
  behavior: '行为',
  task: '任务',
  verification: '验证',
  risk: '风险',
  decision: '决策',
  'open-question': '待确认',
}

const EMPTY_KIND_COUNTS: Record<PlanItemKind, number> = {
  goal: 0,
  scope: 0,
  behavior: 0,
  task: 0,
  verification: 0,
  risk: 0,
  decision: 0,
  'open-question': 0,
}

export function inspectPlan(
  source: string,
  planState: readonly PlanItemState[] = [],
  preferredMode: ReviewMode = 'auto',
): { items: PlanItem[]; summary: PlanReadinessSummary } {
  const tree = fromMarkdown(source)
  const rawItems = collectPlanItems(tree)
  const mode = resolveReviewMode(rawItems, preferredMode)
  const stateById = new Map(planState.map((state) => [state.id, state]))
  const items = rawItems.map((item) => mergeState(item, stateById.get(item.id)))
  return { items, summary: summarizePlanItems(items, mode) }
}

export function resolveReviewMode(
  items: readonly Pick<PlanItem, 'kind'>[],
  preferredMode: ReviewMode = 'auto',
): EffectiveReviewMode {
  if (preferredMode !== 'auto') return preferredMode

  const kinds = new Set(items.map((item) => item.kind))
  if (items.length < 2 || kinds.size < 2) return 'annotation-only'
  if (
    (kinds.has('task') && kinds.has('verification')) ||
    (kinds.has('scope') && kinds.has('task')) ||
    (kinds.has('decision') && kinds.has('verification'))
  ) {
    return 'structured'
  }
  return 'lightweight'
}

export function summarizePlanItems(
  items: readonly PlanItem[],
  mode: EffectiveReviewMode,
): PlanReadinessSummary {
  const byKind: Record<PlanItemKind, number> = { ...EMPTY_KIND_COUNTS }
  for (const item of items) byKind[item.kind] += 1

  const issues: PlanReadinessIssue[] = []
  if (mode === 'annotation-only') {
    return {
      mode,
      total: 0,
      resolved: 0,
      locked: 0,
      byKind,
      issues: [
        {
          id: 'annotation-only',
          severity: 'info',
          text: '当前文档结构较弱，已切换为批注模式',
        },
      ],
    }
  }

  if (mode === 'structured') {
    if (byKind.goal === 0) {
      issues.push({ id: 'missing-goal', severity: 'warning', text: '缺少明确目标/背景' })
    }
    if (byKind.scope === 0) {
      issues.push({ id: 'missing-scope', severity: 'warning', text: '缺少范围内/范围外边界' })
    }
    if (byKind.task > 0 && byKind.verification === 0) {
      issues.push({
        id: 'missing-verification',
        severity: 'warning',
        text: '有任务但缺少验证标准',
      })
    }
    for (const item of items) {
      if (
        (item.kind === 'decision' || item.kind === 'scope' || item.kind === 'verification') &&
        item.status !== 'locked'
      ) {
        issues.push({
          id: `unlocked-${item.id}`,
          severity: 'warning',
          text: `${KIND_LABELS[item.kind]}尚未锁定`,
          itemId: item.id,
        })
      }
    }
  }

  for (const item of items) {
    if (item.status === 'stale') {
      issues.push({
        id: `stale-${item.id}`,
        severity: 'warning',
        text: '已锁定信息可能被改动',
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
      severity: mode === 'structured' ? 'warning' : 'info',
      text: `${openQuestions} 个待确认点需要处理`,
    })
  }

  const openRisks = items.filter((item) => item.kind === 'risk' && item.status === 'open').length
  if (openRisks > 0) {
    issues.push({
      id: 'risks',
      severity: mode === 'structured' ? 'warning' : 'info',
      text: `${openRisks} 个风险/阻塞需要看过`,
    })
  }

  return {
    mode,
    total: items.length,
    resolved: items.filter((item) => item.status === 'locked').length,
    locked: items.filter((item) => item.status === 'locked').length,
    byKind,
    issues,
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

function collectPlanItems(tree: Root): PlanItem[] {
  const items: PlanItem[] = []
  walkBlocks(tree.children, items)
  return dedupeItems(items)
}

function walkBlocks(nodes: readonly Nodes[], items: PlanItem[]): void {
  for (const node of nodes) {
    if (node.type === 'heading') {
      const item = itemFromHeading(node)
      if (item) items.push(item)
      continue
    }
    if (node.type === 'paragraph') {
      const item = itemFromParagraph(node)
      if (item) items.push(item)
      continue
    }
    if (node.type === 'list') {
      walkList(node, items)
      continue
    }
    if ('children' in node && Array.isArray(node.children)) {
      walkBlocks(node.children as Nodes[], items)
    }
  }
}

function walkList(list: List, items: PlanItem[]): void {
  for (const child of list.children) {
    const listItem = child as ListItem
    const firstParagraph = listItem.children.find(
      (node): node is Paragraph => node.type === 'paragraph',
    )
    if (firstParagraph) {
      const text = textOf(firstParagraph).trim()
      const kind = classifyText(text)
      if (kind) items.push(itemFromNode(firstParagraph, kind, text))
    }
    walkBlocks(listItem.children, items)
  }
}

function itemFromHeading(node: Heading): PlanItem | null {
  const text = textOf(node).trim()
  const kind = classifyHeading(text)
  if (!kind) return null
  return itemFromNode(node, kind, text)
}

function itemFromParagraph(node: Paragraph): PlanItem | null {
  const text = textOf(node).trim()
  const kind = classifyText(text)
  if (!kind) return null
  return itemFromNode(node, kind, text)
}

function itemFromNode(node: Nodes, kind: PlanItemKind, text: string): PlanItem {
  const srcStart = node.position?.start.offset ?? 0
  const srcEnd = node.position?.end.offset ?? srcStart
  const compact = text.replace(/\s+/g, ' ').trim()
  const textHash = hash(compact)
  return {
    id: `${kind}:${srcStart}`,
    kind,
    title: KIND_LABELS[kind],
    text: compact,
    textHash,
    blockId: `b-${srcStart}`,
    srcStart,
    srcEnd,
    status: 'open',
  }
}

function classifyHeading(text: string): PlanItemKind | null {
  if (matches(text, ['目标', '背景', 'goal', 'context'])) return 'goal'
  if (matches(text, ['范围', 'scope', '不做', '排除', '边界'])) return 'scope'
  if (matches(text, ['行为', '交互', '体验', '状态', 'behavior', 'ux', 'interaction'])) {
    return 'behavior'
  }
  if (matches(text, ['任务', '拆分', '计划', 'task', 'milestone'])) return 'task'
  if (matches(text, ['验证', '验收', '测试', 'verify', 'acceptance'])) return 'verification'
  if (matches(text, ['风险', '阻塞', '依赖', 'risk', 'blocker', 'dependency'])) return 'risk'
  if (matches(text, ['决策', '决定', 'decision'])) return 'decision'
  if (matches(text, ['待确认', 'todo', 'tbd', 'open question', '疑问'])) return 'open-question'
  return null
}

function classifyText(text: string): PlanItemKind | null {
  if (matches(text, ['todo', 'tbd', '待确认', '待定', '问题:', '疑问'])) return 'open-question'
  if (matches(text, ['风险', '阻塞', '依赖', 'risk', 'blocker'])) return 'risk'
  if (matches(text, ['验收', '验证', '测试', 'verify', 'test', 'pass', '完成条件'])) {
    return 'verification'
  }
  if (matches(text, ['范围内', '范围外', '不做', '包含', '不包含', 'scope'])) return 'scope'
  if (
    matches(text, [
      '行为',
      '交互',
      '用户可见',
      '状态',
      '体验',
      '点击',
      '展示',
      'behavior',
      'ux',
      'interaction',
    ])
  ) {
    return 'behavior'
  }
  if (matches(text, ['目标', '背景', '为了', '要解决', 'goal', 'context'])) return 'goal'
  if (matches(text, ['决策', '决定', '拍板', 'decision', '不可违反'])) return 'decision'
  if (matches(text, ['task', '任务', '实现'])) return 'task'
  if (/^\s*(?:[-*]|\d+\.)?\s*\[[ xX]\]/.test(text)) return 'task'
  return null
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

function dedupeItems(items: readonly PlanItem[]): PlanItem[] {
  const seen = new Set<string>()
  const deduped: PlanItem[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.srcStart}:${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

function hash(value: string): string {
  let n = 0
  for (let i = 0; i < value.length; i++) {
    n = (n * 31 + value.charCodeAt(i)) >>> 0
  }
  return n.toString(36)
}
