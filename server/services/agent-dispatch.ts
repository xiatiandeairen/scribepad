/**
 * server/services/agent-dispatch — turn one AgentRequest into a stream of
 * AgentEvent (progress* → final). Pure async generator: no Hono, no IO of its
 * own — the LlmRunner is resolved lazily (so zero-LLM command paths never touch
 * it) and the document extraction/source are passed in. The SSE route in
 * routes/sessions.ts is a thin wrapper that pumps these events onto the wire.
 *
 * Dispatch is a direct switch on the request shape (no Strategy factory for four
 * cases). Two families:
 *   - command (ai-review / ai-refs): deterministic, reuses core/verify — no LLM.
 *   - chat / selection-op:explain: one LLM round via core/agent's chat task.
 * selection-op dcard|risk|open (P6) and analyze-notes (v2) return an honest
 * not-implemented `final` rather than a fabricated result.
 */
import type { AgentAction, AgentEvent, AgentRequest } from '../../types/api.js'
import type { ExtractResult } from '../../types/domain.js'
import type { Problem } from '../../types/verify.js'
import type { LlmRunner } from '../../types/ports.js'
import { verify } from '../../core/verify/index.js'
import { runChatTask } from '../../core/agent/tasks/chat.js'

export interface AgentDispatchDeps {
  /** Extraction of the current document — supplies the reference graph. */
  extract: ExtractResult
  /** The markdown source — enables verify's form/graph checks and grounds chat. */
  source: string
  /** Lazily resolves the LLM runner; only called on chat / explain paths. */
  resolveLlm: () => LlmRunner
  /**
   * Cancellation from the transport (client disconnect). We check it between
   * steps to stop emitting; the in-flight LLM subprocess itself cannot be killed
   * through the LlmRunner port (no signal in LlmRunRequest), so a running call
   * completes in the background and its result is discarded — the cancel boundary.
   */
  signal?: AbortSignal
}

const EXPLAIN_INSTRUCTION = '请解释选中的内容，说明它在文档里的作用与依据链。'

const SELECTION_OP_TITLE: Record<'dcard' | 'risk' | 'open', string> = {
  dcard: '转决策卡',
  risk: '提为风险',
  open: '提为待确认',
}

/** Dispatch one request into its event stream. */
export async function* dispatchAgent(
  request: AgentRequest,
  deps: AgentDispatchDeps,
): AsyncGenerator<AgentEvent> {
  switch (request.type) {
    case 'command':
      yield* dispatchCommand(request, deps)
      return
    case 'chat':
      yield* dispatchChat(
        { text: request.text, ...(request.quote !== undefined ? { quote: request.quote } : {}) },
        deps,
      )
      return
    case 'selection-op':
      if (request.op === 'explain') {
        yield* dispatchChat({ text: EXPLAIN_INSTRUCTION, quote: request.quote }, deps)
        return
      }
      yield finalNote(`选区「${SELECTION_OP_TITLE[request.op]}」为 P6 阶段功能，本期尚未实现。`)
      return
    case 'analyze-notes':
      yield finalNote('批注批量分析（analyze-notes）计划在 v2 实现，本期尚未提供。')
      return
    default: {
      const _exhaustive: never = request
      throw new Error(`unhandled agent request: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** command — zero LLM, deterministic reuse of core/verify. */
function* dispatchCommand(
  request: Extract<AgentRequest, { type: 'command' }>,
  deps: AgentDispatchDeps,
): Generator<AgentEvent> {
  const problems = verify(deps.extract, { source: deps.source })
  if (request.id === 'ai-refs') {
    yield { type: 'progress', label: '正在扫描标签引用图…' }
    yield { type: 'final', ...buildRefsReply(deps.extract, problems) }
    return
  }
  yield { type: 'progress', label: '正在通读文档…' }
  yield { type: 'progress', label: '正在核对决策链与验收…' }
  yield { type: 'final', ...buildReviewReply(deps.extract, problems) }
}

/** chat / explain — one honest-phased LLM round via the chat task. */
async function* dispatchChat(
  input: { text: string; quote?: string },
  deps: AgentDispatchDeps,
): AsyncGenerator<AgentEvent> {
  if (deps.signal?.aborted) return
  yield { type: 'progress', label: '正在组装上下文…' }
  yield { type: 'progress', label: '正在调用 AI…' }

  const result = await runChatTask(
    {
      fullDoc: deps.source,
      extract: deps.extract,
      text: input.text,
      ...(input.quote !== undefined ? { quote: input.quote } : {}),
    },
    deps.resolveLlm(),
  )
  if (deps.signal?.aborted) return

  if (!result.ok) {
    yield {
      type: 'final',
      paragraphs: [`抱歉，AI 处理失败（${result.error.kind}），请稍后重试。`],
      actions: [],
    }
    return
  }
  yield { type: 'final', paragraphs: result.value.paragraphs, actions: result.value.actions }
}

/**
 * ai-refs reply: reference-graph health from the extraction + core/verify's
 * REF-01 dangling findings. Dangling refs listed with a jump to the offending
 * point; otherwise a clean verdict with the hub (most-referenced label).
 */
export function buildRefsReply(
  extract: ExtractResult,
  problems: Problem[],
): { paragraphs: string[]; actions: AgentAction[] } {
  const defined = new Set(
    extract.points.map((point) => point.label).filter((label): label is string => Boolean(label)),
  )
  const inbound = new Map<string, number>()
  let edges = 0
  for (const point of extract.points) {
    for (const ref of point.refs) {
      if (!defined.has(ref)) continue
      edges += 1
      inbound.set(ref, (inbound.get(ref) ?? 0) + 1)
    }
  }

  const dangling = problems.filter((problem) => problem.ruleId === 'REF-01')
  if (dangling.length > 0) {
    const paragraphs = [
      `检查完成：${defined.size} 个稳定标签、${edges} 条引用边，发现 ${dangling.length} 处悬空引用。`,
      ...dangling.map((problem) => problem.message),
    ]
    const actions = dangling.map((problem) => {
      const src = problem.pointId ? labelById(extract, problem.pointId) : undefined
      const action: AgentAction = {
        icon: 'link',
        kind: 'canvas',
        title: '悬空引用',
        sub: `${src ?? problem.pointId ?? '?'} → ${problem.label ?? '?'}`,
      }
      if (src) action.pt = src
      return action
    })
    return { paragraphs, actions }
  }

  const hub = topKey(inbound)
  const verdict = hub
    ? `检查完成：${defined.size} 个稳定标签、${edges} 条引用边，无悬空引用。${hub} 被引用最多，是当前依据网络的枢纽。`
    : `检查完成：${defined.size} 个稳定标签、${edges} 条引用边，无悬空引用。`
  const action: AgentAction = {
    icon: 'link',
    kind: 'canvas',
    title: '引用图健康',
    sub: '0 悬空 · 全部可导航',
  }
  if (hub) action.pt = hub
  return { paragraphs: [verdict], actions: [action] }
}

/**
 * ai-review reply: full core/verify run → conclusion + one action per important
 * problem (blockers when present, else warnings). Each action's `pt` resolves to
 * the affected point's own label when it has one — never a fabricated target.
 */
export function buildReviewReply(
  extract: ExtractResult,
  problems: Problem[],
): { paragraphs: string[]; actions: AgentAction[] } {
  const blockers = problems.filter((problem) => problem.severity === 'blocker')
  const warnings = problems.filter((problem) => problem.severity === 'warning')
  const important = blockers.length > 0 ? blockers : warnings

  const verdict =
    blockers.length > 0
      ? `评审发现 ${blockers.length} 个阻断项、${warnings.length} 个警告，文档尚未就绪。`
      : `评审完成：0 阻断项、${warnings.length} 条建议，文档结构自洽。`

  const paragraphs = [
    verdict,
    ...important.map((problem) => `${problem.ruleId}：${problem.message}`),
  ]
  const actions = important.map((problem) => {
    const pt = resolvePt(extract, problem)
    const action: AgentAction = {
      icon: problem.severity === 'blocker' ? 'warn' : 'note',
      kind: 'chart',
      title: problem.ruleId,
      sub: truncate(problem.message, 60),
    }
    if (pt) action.pt = pt
    return action
  })
  return { paragraphs, actions }
}

/** The navigable label for a problem: the affected point's own label if any, else a defined referenced label. */
function resolvePt(extract: ExtractResult, problem: Problem): string | undefined {
  if (problem.pointId) {
    const label = labelById(extract, problem.pointId)
    if (label) return label
  }
  if (problem.label && extract.points.some((point) => point.label === problem.label)) {
    return problem.label
  }
  return undefined
}

function labelById(extract: ExtractResult, id: string): string | undefined {
  return extract.points.find((point) => point.id === id)?.label
}

/** Key with the highest count; ties resolve to first insertion (Map preserves order). */
function topKey(counts: Map<string, number>): string | undefined {
  let best: string | undefined
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function finalNote(message: string): AgentEvent {
  return { type: 'final', paragraphs: [message], actions: [] }
}
