/**
 * Runtime Zod schemas validating the domain model at boundaries (LLM output,
 * sidecar reads). Each schema is pinned to its hand-written type in
 * types/domain.ts via `satisfies z.ZodType<...>`, so a type/schema drift fails
 * to compile. See docs/refactor-plan.md §5 Q2.
 *
 * zod is the core's validation tool, not a framework — allowed under the E0
 * boundary (which bars hono/react/execa/server/src from core).
 */
import { z } from 'zod'
import type {
  DecisionCard,
  ExtractResult,
  ExtractedItem,
  InfoKind,
  Signoff,
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

export const extractResultSchema = z.object({
  points: z.array(extractedItemSchema),
  decisions: z.array(decisionCardSchema),
  meta: docMetaSchema.optional(),
}) satisfies z.ZodType<ExtractResult>

export const signoffSchema = z.object({
  pointId: z.string(),
  label: z.string(),
  signedAt: z.string(),
}) satisfies z.ZodType<Signoff>
