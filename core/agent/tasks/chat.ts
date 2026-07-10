/**
 * core/agent/tasks/chat — the conversational agent task.
 *
 * Pure orchestration (E0): the LlmRunner is injected by the caller; this module
 * only builds the prompt and validates the reply. Context is the full document
 * plus the D4 grounding pack (relatedPoints) of the point a selection quote hits,
 * so the model answers against the reference graph rather than the raw text alone.
 *
 * The reply is the same {paragraphs, actions} shape the frontend consumes. A
 * produced action may only carry a `pt` that names a defined label — the model is
 * told so in the prompt, and runChatTask drops any dangling `pt` after the fact
 * (belt and suspenders, since a hallucinated jump target is worse than none).
 */
import { z } from 'zod'
import { runTask } from '../runner.js'
import type { TaskSpec } from '../task.js'
import type { AgentError } from '../task.js'
import { relatedPoints } from '../../extract/labels.js'
import type { Result } from '../../../types/result.js'
import type { LlmRunner } from '../../../types/ports.js'
import type { AgentAction } from '../../../types/api.js'
import type { ExtractResult, ExtractedItem, ReviewExtract } from '../../../types/domain.js'

export interface ChatTaskInput {
  /** The markdown document, verbatim — the model's read-only context. */
  fullDoc: string
  /** Extraction of `fullDoc`; supplies the reference graph for grounding. */
  extract: ExtractResult
  /** The user's instruction (chat text, or the fixed explain instruction). */
  text: string
  /** Selection text the request focuses on, when present. */
  quote?: string
}

/** The public reply shape the frontend consumes — actions are strict AgentAction. */
export interface ChatReply {
  paragraphs: string[]
  actions: AgentAction[]
}

// The zod-inferred output keeps `pt`/`sec` as `string | undefined` (zod optional),
// which is looser than AgentAction under exactOptionalPropertyTypes. We keep that
// looseness internal to the task and normalize back to strict AgentAction in
// runChatTask, so the schema drives runTask and the public boundary stays exact.
const agentActionSchema = z.object({
  icon: z.string(),
  kind: z.string(),
  title: z.string(),
  sub: z.string(),
  pt: z.string().optional(),
  sec: z.string().optional(),
})

const chatReplySchema = z.object({
  paragraphs: z.array(z.string()),
  actions: z.array(agentActionSchema),
})

type ChatReplyRaw = z.infer<typeof chatReplySchema>
type RawAction = ChatReplyRaw['actions'][number]

/** The point a selection quote falls in, if any — first by anchored substring, else by text. */
function findFocusPoint(
  extract: ExtractResult,
  quote: string | undefined,
): ExtractedItem | undefined {
  if (!quote) return undefined
  const needle = quote.trim()
  if (!needle) return undefined
  return extract.points.find((point) => point.text.includes(needle) || point.title.includes(needle))
}

/** One-line grounding summary for a related point: label (or role) + its title/text. */
function describePoint(point: ExtractedItem): string {
  const head = point.label ?? point.kind
  const body = (point.title || point.text).replace(/\s+/g, ' ').trim().slice(0, 80)
  return `- ${head}: ${body}`
}

/** Every jump-able label a review doc defines — the review-doc counterpart of plan `points` labels. */
function reviewLabelsOf(review: ReviewExtract): string[] {
  return [
    ...review.verdicts.map((v) => v.label),
    ...review.claims.map((c) => c.label),
    ...review.leftovers.map((l) => l.label),
  ].filter((label): label is string => Boolean(label))
}

/** definedLabels for the jump whitelist: extract.points for a plan doc, review units for a review doc. */
function definedLabelsOf(extract: ExtractResult): string[] {
  if (extract.docKind === 'review') return extract.review ? reviewLabelsOf(extract.review) : []
  return extract.points.map((point) => point.label).filter((label): label is string => Boolean(label))
}

/** A review unit (verdict/claim/leftover) the quote falls in, with its label and display kind name. */
interface ReviewFocusUnit {
  label: string
  kindName: string
  text: string
}

/** The review unit a selection quote falls in, if any — verdict fields, then claim, then leftover text. */
function findReviewFocusUnit(
  review: ReviewExtract,
  quote: string | undefined,
): ReviewFocusUnit | undefined {
  if (!quote) return undefined
  const needle = quote.trim()
  if (!needle) return undefined

  for (const v of review.verdicts) {
    const fields = [v.title, v.context, v.chosen, v.alternative, v.whyNotAsked, v.ifRejected, v.evidence]
    if (fields.some((field) => field !== undefined && field.includes(needle))) {
      return { label: v.label, kindName: '裁决', text: v.title }
    }
  }
  for (const c of review.claims) {
    if (c.claim.includes(needle)) return { label: c.label, kindName: '声明', text: c.claim }
  }
  for (const l of review.leftovers) {
    if (l.text.includes(needle)) return { label: l.label, kindName: '遗留', text: l.text }
  }
  return undefined
}

/** The `\n选区命中 …（聚焦上下文）:\n...\n` block, or '' when nothing grounds the quote. */
function focusBlockOf(extract: ExtractResult, quote: string | undefined): string {
  if (extract.docKind === 'review') {
    const unit = extract.review ? findReviewFocusUnit(extract.review, quote) : undefined
    if (!unit) return ''
    const body = unit.text.replace(/\s+/g, ' ').trim().slice(0, 80)
    return `\n选区命中 ${unit.label}（${unit.kindName}，聚焦上下文）:\n- ${unit.label}: ${body}\n`
  }
  const focus = findFocusPoint(extract, quote)
  const related = focus ? relatedPoints(extract, focus.id, 1) : []
  return focus && related.length > 0
    ? `\n选区命中 ${focus.label ?? focus.kind}，其依据/被依据点（聚焦上下文）:\n${related
        .map(describePoint)
        .join('\n')}\n`
    : ''
}

export const chatTask: TaskSpec<ChatTaskInput, ChatReplyRaw> = {
  name: 'chat',
  retry: 1,
  schema: chatReplySchema,
  buildPrompt: ({ fullDoc, extract, text, quote }) => {
    const focusBlock = focusBlockOf(extract, quote)
    const definedLabels = definedLabelsOf(extract)

    const labelsLine =
      definedLabels.length > 0
        ? `\n可用于跳转的标签(pt 只能取其中之一,不得虚构): ${definedLabels.join(', ')}\n`
        : ''

    return `以下是 markdown 文档全文(仅供上下文参考):

<<<DOC
${fullDoc}
DOC>>>
${focusBlock}${labelsLine}
用户请求:
${text}${quote ? `\n（针对选区: ${quote}）` : ''}

请只输出一个 JSON 对象 {"paragraphs":["中文回复段落",...],"actions":[{"icon":"","kind":"","title":"","sub":"","pt":"可选标签","sec":"可选小节"}]}。
不要包裹代码块,不要加任何解释或前后缀。actions 可为空数组;若填 pt 必须来自上面「可用于跳转的标签」,否则留空。`
  },
}

/**
 * Run the chat task against the injected LLM, then drop any action `pt` that does
 * not name a defined label (the action is kept, only its dangling jump target is
 * removed). Failure semantics are runTask's: `Err` on LLM failure / exhausted retries.
 */
export async function runChatTask(
  input: ChatTaskInput,
  llm: LlmRunner,
): Promise<Result<ChatReply, AgentError>> {
  const result = await runTask(chatTask, input, llm)
  if (!result.ok) return result

  const defined = new Set(definedLabelsOf(input.extract))
  const actions = result.value.actions.map((raw) => normalizeAction(raw, defined))
  return { ok: true, value: { paragraphs: result.value.paragraphs, actions } }
}

/** Rebuild a raw action as a strict AgentAction, dropping a `pt` that names no defined label. */
function normalizeAction(raw: RawAction, defined: Set<string>): AgentAction {
  const action: AgentAction = { icon: raw.icon, kind: raw.kind, title: raw.title, sub: raw.sub }
  if (raw.pt !== undefined && defined.has(raw.pt)) action.pt = raw.pt
  if (raw.sec !== undefined) action.sec = raw.sec
  return action
}
