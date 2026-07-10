/**
 * routes/feedback — global (non-session-scoped) feedback intake.
 *
 * POST /api/feedback accepts a raw client-side report and, when `sessionId` is
 * present, server-side-enriches it with the session's current doc + review
 * state via SessionManager before handing it to FeedbackSink. Deliberately
 * global rather than nested under /sessions/:id — CLI-sourced reports have no
 * session at all.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { createFsFeedbackSink } from '../adapters/feedback-sink-fs.js'
import type { FeedbackAttachment } from '../../types/ports.js'

export interface FeedbackRequest {
  text: string
  category?: string
  sessionId?: string
  dom?: string
  consoleErrors?: string[]
  viewport?: string
  activeSection?: string
}

export interface FeedbackResponse {
  id: string
}

export interface FeedbackErrorResponse {
  error: string
}

export function feedbackRoute(ctx: AppContext) {
  const app = new Hono()
  const feedbackSink = ctx.feedbackSink ?? createFsFeedbackSink()

  app.post('/feedback', async (c) => {
    const req = (await c.req.json().catch(() => undefined)) as Partial<FeedbackRequest> | undefined
    if (!req || typeof req.text !== 'string' || req.text.trim().length === 0) {
      const body: FeedbackErrorResponse = { error: 'text is required' }
      return c.json(body, 400)
    }

    // Server-side enrichment (why: front-end sends only what's on hand at
    // report time; the doc/review-state copies must reflect the session's
    // authoritative state, not a possibly-stale client-held copy). Best-effort
    // — a session that can't be read degrades to a report without those
    // attachments rather than failing the whole submission.
    let attachment: FeedbackAttachment | undefined
    if (req.sessionId) {
      const [docResult, annotationsResult, signoffsResult] = await Promise.allSettled([
        ctx.sessionManager.readFile(req.sessionId),
        ctx.sessionManager.readAnnotations(req.sessionId),
        ctx.sessionManager.readSignoffs(req.sessionId),
      ])
      attachment = {
        ...(docResult.status === 'fulfilled' ? { docSnapshot: docResult.value.content } : {}),
        ...(annotationsResult.status === 'fulfilled' && signoffsResult.status === 'fulfilled'
          ? {
              reviewState: JSON.stringify({
                annotations: annotationsResult.value,
                signoffs: signoffsResult.value,
              }),
            }
          : {}),
        ...(req.dom !== undefined ? { domSnapshot: req.dom } : {}),
      }
    } else if (req.dom !== undefined) {
      attachment = { domSnapshot: req.dom }
    }

    // This HTTP route is the panel's intake path only — the CLI submits
    // straight through FeedbackSink (no session, no HTTP hop), so `source` is
    // fixed here rather than inferred from `sessionId`'s presence.
    const result = await feedbackSink.submit(
      {
        source: 'panel',
        text: req.text,
        ...(req.category !== undefined ? { category: req.category } : {}),
        ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
        context: {
          ...(req.viewport !== undefined ? { viewport: req.viewport } : {}),
          ...(req.activeSection !== undefined ? { activeSection: req.activeSection } : {}),
          ...(req.consoleErrors !== undefined ? { consoleErrors: req.consoleErrors } : {}),
        },
      },
      attachment,
    )

    if (!result.ok) {
      const body: FeedbackErrorResponse = { error: result.error.message }
      return c.json(body, 500)
    }

    const body: FeedbackResponse = { id: result.value.id }
    return c.json(body, 201)
  })

  return app
}
