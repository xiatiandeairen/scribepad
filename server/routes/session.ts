/**
 * routes/session — GET/heartbeat/close for one-shot CLI sessions.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import type { CloseSessionRequest } from '../../types/api.js'

export function sessionRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/session', (c) => {
    try {
      return c.json(
        ctx.sessionManager.getSessionResponse(ctx.sessionManager.getFallbackSession().id),
      )
    } catch {
      return c.json({ error: 'session is not enabled' }, 404)
    }
  })

  app.post('/session/heartbeat', (c) => {
    try {
      const session = ctx.sessionManager.getFallbackSession()
      return c.json(ctx.sessionManager.getSessionResponse(session.id))
    } catch {
      return c.json({ error: 'session is not enabled' }, 404)
    }
  })

  app.post('/session/close', async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as Partial<CloseSessionRequest>
    const session = ctx.sessionManager.getFallbackSession()
    const done = req.exportAgentContext ? await ctx.sessionManager.done(session.id) : undefined
    const exported = done
      ? { agentContextPath: done.outputPath, exportedAt: new Date().toISOString() }
      : undefined
    ctx.requestClose?.()
    return c.json({ ok: true, exported })
  })

  return app
}
