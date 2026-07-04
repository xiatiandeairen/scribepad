import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppContext } from '../app.js'
import type {
  AgentRequest,
  AnnotationsRequest,
  AnnotationsResponse,
  ConnectSessionResponse,
  DisconnectSessionRequest,
  DoneSessionResponse,
  ErrorResponse,
  ExtractResponse,
  FileResponse,
  HeartbeatSessionRequest,
  OpenSessionRequest,
  OpenSessionResponse,
  PlanStateRequest,
  PlanStateResponse,
  ReviewNormalizeRequest,
  RewriteApplyRequest,
  RewriteApplyResponse,
  RewriteRequest,
  RewriteResponse,
  SaveRequest,
  SaveResponse,
  SignoffsRequest,
  SignoffsResponse,
} from '../../types/api.js'
import {
  normalizeReviewPlanRequest,
  ReviewNormalizeInputError,
} from '../services/review-normalize.js'
import { dispatchAgent } from '../services/agent-dispatch.js'
import { RewriteApplyConflictError } from '../services/session-manager.js'

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

  app.get('/sessions/:sessionId/signoffs', async (c) => {
    const signoffs = await ctx.sessionManager.readSignoffs(c.req.param('sessionId'))
    const body: SignoffsResponse = { signoffs }
    return c.json(body)
  })

  app.post('/sessions/:sessionId/signoffs', async (c) => {
    const req = (await c.req.json()) as SignoffsRequest
    await ctx.sessionManager.writeSignoffs(c.req.param('sessionId'), req.signoffs)
    return c.json({ ok: true })
  })

  app.get('/sessions/:sessionId/extract', async (c) => {
    try {
      const result = await ctx.sessionManager.extract(c.req.param('sessionId'))
      const body: ExtractResponse = { result }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
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

  app.post('/sessions/:sessionId/rewrite-apply', async (c) => {
    const req = (await c.req.json()) as RewriteApplyRequest
    if (!Array.isArray(req.items) || req.items.length === 0) {
      const err: ErrorResponse = { error: 'items[] required' }
      return c.json(err, 400)
    }
    try {
      const body: RewriteApplyResponse = await ctx.sessionManager.rewriteApply(
        c.req.param('sessionId'),
        req.items,
      )
      return c.json(body)
    } catch (e) {
      // Splice guard rejection (drift / overlap / oob) → 409; unknown session →
      // 404; LLM / write failure → 500.
      if (e instanceof RewriteApplyConflictError) {
        const err: ErrorResponse = { error: e.message }
        return c.json(err, 409)
      }
      const message = String((e as Error).message ?? e)
      const err: ErrorResponse = { error: message }
      return c.json(err, /Session not found/.test(message) ? 404 : 500)
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

  app.post('/sessions/:sessionId/agent', async (c) => {
    const sessionId = c.req.param('sessionId')
    // Validate the session before opening the stream so an unknown session is a
    // plain 404, not an SSE error frame the client has to decode.
    try {
      ctx.sessionManager.getSession(sessionId)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }

    const request = (await c.req.json()) as AgentRequest
    const extract = await ctx.sessionManager.extract(sessionId)
    const { content } = await ctx.sessionManager.readFile(sessionId)

    // Client disconnect → abort: stop pumping events. The in-flight LLM call
    // itself is not cancellable through the LlmRunner port, so it finishes in the
    // background and its result is dropped (see AgentDispatchDeps.signal).
    const controller = new AbortController()
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort())
      for await (const event of dispatchAgent(request, {
        extract,
        source: content,
        resolveLlm: () => ctx.sessionManager.getLlmRunner(),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    })
  })

  app.post('/sessions/:sessionId/done', async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as Partial<SaveRequest>
    const result = await ctx.sessionManager.done(c.req.param('sessionId'), req.content)
    const body: DoneSessionResponse = { ok: true, outputPath: result.outputPath }
    return c.json(body)
  })

  app.get('/sessions/:sessionId/wait', async (c) => {
    try {
      const result = await ctx.sessionManager.waitForDone(c.req.param('sessionId'))
      const body: DoneSessionResponse = { ok: true, outputPath: result.outputPath }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 404)
    }
  })

  return app
}
