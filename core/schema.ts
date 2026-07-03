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
  ConfirmState,
  ExtractResult,
  ExtractedItem,
  Gap,
  GapKind,
  InfoKind,
} from '../types/domain.js'

const infoKindSchema = z.enum([
  'goal',
  'scope',
  'behavior',
  'verification',
  'risk',
  'decision',
  'open-question',
]) satisfies z.ZodType<InfoKind>

const srcAnchorSchema = z.object({
  srcStart: z.number().int().nonnegative(),
  srcEnd: z.number().int().nonnegative(),
})

export const extractedItemSchema = z.object({
  id: z.string(),
  kind: infoKindSchema,
  title: z.string(),
  text: z.string(),
  anchor: srcAnchorSchema.optional(),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ExtractedItem>

const gapKindSchema = z.enum([
  'missing-goal',
  'missing-scope',
  'missing-verification',
  'missing-risk',
  'ambiguous-scope',
  'unresolved-question',
]) satisfies z.ZodType<GapKind>

export const gapSchema = z.object({
  id: z.string(),
  kind: gapKindSchema,
  reason: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<Gap>

export const extractResultSchema = z.object({
  items: z.array(extractedItemSchema),
  gaps: z.array(gapSchema),
}) satisfies z.ZodType<ExtractResult>

export const confirmStateSchema = z.object({
  itemId: z.string(),
  status: z.enum(['open', 'confirmed', 'rejected']),
  confidence: z.number().min(0).max(1),
  textHash: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ConfirmState>
