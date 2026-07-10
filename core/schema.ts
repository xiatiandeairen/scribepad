/**
 * Compile-time type↔schema drift guard. Each Zod schema is pinned to its
 * hand-written type in types/domain.ts via `satisfies z.ZodType<...>`, so a
 * drift between the two fails to compile. No runtime consumer yet — these
 * schemas exist purely for the compile-time guard. See docs/architecture.md.
 *
 * zod is the core's validation tool, not a framework — allowed under the E0
 * boundary (which bars hono/react/execa/server/src from core).
 */
import { z } from 'zod'
import type {
  Claim,
  DecisionCard,
  ExtractResult,
  ExtractedItem,
  InfoKind,
  Leftover,
  ReconciliationRow,
  ReviewDetail,
  ReviewExtract,
  Signoff,
  VerdictCard,
} from '../types/domain.js'

const infoKindSchema = z.enum([
  'goal',
  'scope',
  'decision',
  'behavior',
  'verification',
  'risk',
  'precondition',
  'open-question',
]) satisfies z.ZodType<InfoKind>

const srcAnchorSchema = z.object({
  srcStart: z.number().int().nonnegative(),
  srcEnd: z.number().int().nonnegative(),
})

const itemPathSchema = z.object({
  sectionTitle: z.string(),
  groupTitle: z.string().optional(),
})

const cellFactSchema = z.object({
  header: z.string(),
  text: z.string(),
})

export const extractedItemSchema = z.object({
  id: z.string(),
  kind: infoKindSchema,
  label: z.string().optional(),
  title: z.string(),
  text: z.string(),
  anchor: srcAnchorSchema.optional(),
  refs: z.array(z.string()),
  path: itemPathSchema,
  role: z.enum(['checkpoint', 'detail']),
  textHash: z.string(),
  source: z.enum(['rule', 'ai']),
  confidence: z.number().min(0).max(1).optional(),
  cells: z.array(cellFactSchema).optional(),
  group: z.string().optional(),
  ordinal: z.number().int().positive().optional(),
}) satisfies z.ZodType<ExtractedItem>

export const decisionCardSchema = z.object({
  pointId: z.string(),
  label: z.string().optional(),
  chosen: z.string(),
  rationale: z.string(),
  rejected: z.array(
    z.object({
      option: z.string(),
      reason: z.string(),
    }),
  ),
  status: z.enum(['decided', 'pending']),
  pick: z.string().optional(),
  question: z.string().optional(),
  core: z.literal(true).optional(),
  cost: z.string().optional(),
  facts: z.string().optional(),
}) satisfies z.ZodType<DecisionCard>

const docMetaSchema = z.object({
  title: z.string().optional(),
  intro: z.string().optional(),
})

export const verdictCardSchema = z.object({
  label: z.string(),
  tag: z.string().optional(),
  title: z.string(),
  context: z.string().optional(),
  chosen: z.string().optional(),
  alternative: z.string().optional(),
  whyNotAsked: z.string().optional(),
  ifRejected: z.string().optional(),
  evidence: z.string().optional(),
  anchor: srcAnchorSchema.optional(),
}) satisfies z.ZodType<VerdictCard>

export const reconciliationRowSchema = z.object({
  item: z.string(),
  status: z.enum(['done', 'deviated', 'dropped', 'added', 'unknown']),
  note: z.string().optional(),
  refs: z.array(z.string()),
  anchor: srcAnchorSchema.optional(),
}) satisfies z.ZodType<ReconciliationRow>

export const claimSchema = z.object({
  label: z.string(),
  claim: z.string(),
  evidence: z.string().optional(),
  verify: z.string().optional(),
  unverified: z.boolean(),
  anchor: srcAnchorSchema.optional(),
}) satisfies z.ZodType<Claim>

export const leftoverSchema = z.object({
  label: z.string(),
  kind: z.enum(['deferred', 'assumption', 'limitation', 'unknown']),
  text: z.string(),
  condition: z.string().optional(),
  anchor: srcAnchorSchema.optional(),
}) satisfies z.ZodType<Leftover>

const reviewDetailSchema = z.object({
  text: z.string(),
  anchor: srcAnchorSchema.optional(),
}) satisfies z.ZodType<ReviewDetail>

export const reviewExtractSchema = z.object({
  verdicts: z.array(verdictCardSchema),
  reconciliation: z.array(reconciliationRowSchema),
  claims: z.array(claimSchema),
  leftovers: z.array(leftoverSchema),
  details: z.array(reviewDetailSchema),
}) satisfies z.ZodType<ReviewExtract>

export const extractResultSchema = z.object({
  points: z.array(extractedItemSchema),
  decisions: z.array(decisionCardSchema),
  meta: docMetaSchema.optional(),
  docKind: z.enum(['plan', 'review']).optional(),
  review: reviewExtractSchema.optional(),
}) satisfies z.ZodType<ExtractResult>

export const signoffSchema = z.object({
  pointId: z.string(),
  label: z.string(),
  signedAt: z.string(),
}) satisfies z.ZodType<Signoff>
