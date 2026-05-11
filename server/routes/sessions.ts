import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import type {
  AnnotationsRequest,
  AnnotationsResponse,
  ConnectSessionResponse,
  DisconnectSessionRequest,
  DoneSessionResponse,
  ErrorResponse,
  FileResponse,
  HeartbeatSessionRequest,
  OpenSessionRequest,
  OpenSessionResponse,
  PlanStateRequest,
  PlanStateResponse,
  ReviewNormalizeRequest,
  RewriteRequest,
  RewriteResponse,
  SaveRequest,
  SaveResponse,
} from '../../types/api.js'
import {
  normalizeReviewPlanRequest,
  ReviewNormalizeInputError,
} from '../services/review-normalize.js'

export function sessionsRoute(ctx: AppContext) {
  const app = new Hono()

  app.post('/sessions/open', async (c) => {
    try {
      const req = (await c.req.json()) as OpenSessionRequest
      const opened = ctx.sessionManager.openSession(req.filePath)
      const body: OpenSessionResponse = opened
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 400)
    }
  })

  app.get('/sessions/:sessionId', (c) => {
    try {
      return c.json(ctx.sessionManager.getSessionResponse(c.req.param('sessionId')))
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
  })

  app.post('/sessions/:sessionId/connect', (c) => {
    try {
      const body: ConnectSessionResponse = ctx.sessionManager.connect(c.req.param('sessionId'))
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
  })

  app.post('/sessions/:sessionId/heartbeat', async (c) => {
    try {
      const req = (await c.req.json()) as HeartbeatSessionRequest
      return c.json(ctx.sessionManager.heartbeat(c.req.param('sessionId'), req.clientId))
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
  })

  app.post('/sessions/:sessionId/disconnect', async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as Partial<DisconnectSessionRequest>
    if (req.clientId) ctx.sessionManager.disconnect(c.req.param('sessionId'), req.clientId)
    return c.json({ ok: true })
  })

  app.get('/sessions/:sessionId/file', async (c) => {
    try {
      const doc = await ctx.sessionManager.readFile(c.req.param('sessionId'))
      const body: FileResponse = { path: doc.path, content: doc.content }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
  })

  app.post('/sessions/:sessionId/save', async (c) => {
    const req = (await c.req.json()) as SaveRequest
    await ctx.sessionManager.saveFile(c.req.param('sessionId'), req.content)
    const body: SaveResponse = { ok: true }
    return c.json(body)
  })

  app.get('/sessions/:sessionId/annotations', async (c) => {
    const annotations = await ctx.sessionManager.readAnnotations(c.req.param('sessionId'))
    const body: AnnotationsResponse = { annotations }
    return c.json(body)
  })

  app.post('/sessions/:sessionId/annotations', async (c) => {
    const req = (await c.req.json()) as AnnotationsRequest
    await ctx.sessionManager.writeAnnotations(c.req.param('sessionId'), req.annotations)
    return c.json({ ok: true })
  })

  app.get('/sessions/:sessionId/plan-state', async (c) => {
    const planState = await ctx.sessionManager.readPlanState(c.req.param('sessionId'))
    const body: PlanStateResponse = { planState }
    return c.json(body)
  })

  app.post('/sessions/:sessionId/plan-state', async (c) => {
    const req = (await c.req.json()) as PlanStateRequest
    await ctx.sessionManager.writePlanState(c.req.param('sessionId'), req.planState)
    return c.json({ ok: true })
  })

  app.post('/sessions/:sessionId/rewrite', async (c) => {
    const req = (await c.req.json()) as RewriteRequest
    if (!Array.isArray(req.items) || req.items.length === 0) {
      const err: ErrorResponse = { error: 'items[] required' }
      return c.json(err, 400)
    }
    try {
      const results = await ctx.sessionManager.rewrite(
        c.req.param('sessionId'),
        req.fullDoc,
        req.items,
      )
      const body: RewriteResponse = { results }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 500)
    }
  })

  app.post('/sessions/:sessionId/review-normalize', async (c) => {
    const req = (await c.req.json()) as ReviewNormalizeRequest
    try {
      ctx.sessionManager.getSession(c.req.param('sessionId'))
      return c.json(await normalizeReviewPlanRequest(req, ctx.getConfig().ai))
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, e instanceof ReviewNormalizeInputError ? 400 : 500)
    }
  })

  app.post('/sessions/:sessionId/done', async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as Partial<SaveRequest>
    const result = await ctx.sessionManager.done(c.req.param('sessionId'), req.content)
    const body: DoneSessionResponse = { ok: true, outputPath: result.outputPath }
    return c.json(body)
  })

  return app
}
