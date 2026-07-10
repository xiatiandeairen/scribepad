/**
 * routes/session — GET for one-shot CLI sessions.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'

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

  return app
}
