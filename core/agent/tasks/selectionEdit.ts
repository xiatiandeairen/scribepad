/**
 * core/agent/tasks/selectionEdit — draft a new section item from a selection.
 *
 * Pure orchestration (E0): the LlmRunner is injected. The model produces only the
 * *content* of the new item (structured fields validated by zod, one shape per
 * op); the caller assigns the stable label and renders the markdown fragment, so
 * the model can neither invent an ordinal nor emit stray full-document text.
 * Fragment rendering lives here too because it is coupled to the field shapes —
 * the forms mirror the plan schema so a re-extraction picks the new item up under
 * its label (a risk table row, an open-question list item, a decision H3 card).
 */
import { z } from 'zod'
import { runTask } from '../runner.js'
import type { AgentError, TaskSpec } from '../task.js'
import { ok } from '../../result.js'
import type { Result } from '../../../types/result.js'
import type { LlmRunner } from '../../../types/ports.js'
import type { ExtractResult, InfoKind } from '../../../types/domain.js'

export type SelectionOp = 'dcard' | 'risk' | 'open'

export interface SelectionEditInput {
  /** Selection text the new item is derived from. */
  quote: string
  /** Extraction of the current document — supplies few-shot form alignment. */
  extract: ExtractResult
  /** The label the caller will assign; passed for context, never emitted by the model. */
  label: string
}

const dcardSchema = z.object({
  title: z.string(),
  chosen: z.string(),
  rationale: z.string(),
  rejected: z.array(z.object({ option: z.string(), reason: z.string() })),
})
const riskSchema = z.object({ risk: z.string(), impact: z.string(), mitigation: z.string() })
const openSchema = z.object({ question: z.string() })

export type DcardFields = z.infer<typeof dcardSchema>
export type RiskFields = z.infer<typeof riskSchema>
export type OpenFields = z.infer<typeof openSchema>

/** The validated draft, tagged by op so the renderer can narrow it. */
export type SelectionEditResult =
  | { op: 'dcard'; fields: DcardFields }
  | { op: 'risk'; fields: RiskFields }
  | { op: 'open'; fields: OpenFields }

const OP_TITLE: Record<SelectionOp, string> = {
  dcard: '决策卡',
  risk: '风险条目',
  open: '待确认条目',
}

const OP_KIND: Record<SelectionOp, InfoKind> = {
  dcard: 'decision',
  risk: 'risk',
  open: 'open-question',
}

/** A few existing items of the target kind, verbatim, for form alignment. */
function fewShot(extract: ExtractResult, kind: InfoKind): string {
  const items = extract.points
    .filter((point) => point.kind === kind)
    .slice(0, 3)
    .map((point) => `- ${clean(point.text || point.title).slice(0, 120)}`)
  return items.length ? `\n目标节现有条目(仅供形态参考,不要照抄):\n${items.join('\n')}\n` : ''
}

/** Shared prompt head: what to produce, the reference forms, and the selection. */
function promptHead(input: SelectionEditInput, op: SelectionOp): string {
  return `你在把一段选区整理成${OP_TITLE[op]}草稿。${fewShot(input.extract, OP_KIND[op])}
选区原文:
<<<QUOTE
${input.quote}
QUOTE>>>

只整理这段选区,不要复述全文,不要自行编号(编号由系统分配)。`
}

const dcardTask: TaskSpec<SelectionEditInput, DcardFields> = {
  name: 'selection-edit:dcard',
  retry: 1,
  schema: dcardSchema,
  buildPrompt: (input) =>
    `${promptHead(input, 'dcard')}
只输出一个 JSON 对象 {"title":"这条决策要回答的问题","chosen":"选了什么","rationale":"为什么","rejected":[{"option":"被否候选","reason":"被否理由"}]}。
rejected 可为空数组(留待补)。不要包裹代码块,不要加任何解释或前后缀。`,
}

const riskTask: TaskSpec<SelectionEditInput, RiskFields> = {
  name: 'selection-edit:risk',
  retry: 1,
  schema: riskSchema,
  buildPrompt: (input) =>
    `${promptHead(input, 'risk')}
只输出一个 JSON 对象 {"risk":"风险描述","impact":"影响","mitigation":"缓解措施"}。不要包裹代码块,不要加任何解释或前后缀。`,
}

const openTask: TaskSpec<SelectionEditInput, OpenFields> = {
  name: 'selection-edit:open',
  retry: 1,
  schema: openSchema,
  buildPrompt: (input) =>
    `${promptHead(input, 'open')}
只输出一个 JSON 对象 {"question":"待确认的问题"}。不要包裹代码块,不要加任何解释或前后缀。`,
}

/**
 * Draft the new item's content via the injected LLM. Returns the validated
 * fields tagged by op; failure semantics are runTask's (`Err` on LLM failure /
 * exhausted retries).
 */
export async function runSelectionEditTask(
  op: SelectionOp,
  input: SelectionEditInput,
  llm: LlmRunner,
): Promise<Result<SelectionEditResult, AgentError>> {
  switch (op) {
    case 'dcard': {
      const result = await runTask(dcardTask, input, llm)
      return result.ok ? ok({ op, fields: result.value }) : result
    }
    case 'risk': {
      const result = await runTask(riskTask, input, llm)
      return result.ok ? ok({ op, fields: result.value }) : result
    }
    case 'open': {
      const result = await runTask(openTask, input, llm)
      return result.ok ? ok({ op, fields: result.value }) : result
    }
  }
}

/**
 * The markdown fragment (with its own leading separator) to splice at the
 * section-insert offset. `label` is injected here — never by the model:
 *  - risk: a single-newline table row so it joins the existing GFM table.
 *  - open: a blank-line list item, which parses as a new point after whatever the
 *    section ended with (table / paragraph / list).
 *  - dcard: a blank-line H3 decision card; empty `rejected` renders `待补`.
 */
export function renderSelectionFragment(result: SelectionEditResult, label: string): string {
  switch (result.op) {
    case 'risk': {
      const { risk, impact, mitigation } = result.fields
      return `\n| ${label} | ${cell(risk)} | ${cell(impact)} | ${cell(mitigation)} |`
    }
    case 'open':
      return `\n\n- **${label}** ${clean(result.fields.question)}（owner：产品）`
    case 'dcard': {
      const { title, chosen, rationale, rejected } = result.fields
      const rejectedBlock = rejected.length
        ? `\n${rejected.map((r) => `- ${clean(r.option)}：${clean(r.reason)}`).join('\n')}`
        : '待补'
      return (
        `\n\n### ${label}：${clean(title)}\n\n` +
        `**选了什么**：${clean(chosen)}\n\n` +
        `**为什么**：${clean(rationale)}\n\n` +
        `**否掉了谁**：${rejectedBlock}`
      )
    }
  }
}

/** Collapse whitespace to single spaces and trim. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A GFM table cell: cleaned, with pipes escaped so a stray `|` can't split the row. */
function cell(text: string): string {
  return clean(text).replace(/\|/g, '\\|')
}
