/**
 * routes/annotations — GET /api/annotations, POST /api/annotations
 *
 * Foundation skeleton.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import type { AnnotationsResponse, AnnotationsRequest } from '../../types/api.js'

export function annotationsRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/annotations', async (c) => {
    const session = ctx.sessionManager.getFallbackSession()
    const annotations = await ctx.sessionManager.readAnnotations(session.id)
    const body: AnnotationsResponse = { annotations }
    return c.json(body)
  })

  app.post('/annotations', async (c) => {
    const req = (await c.req.json()) as AnnotationsRequest
    const session = ctx.sessionManager.getFallbackSession()
    await ctx.sessionManager.writeAnnotations(session.id, req.annotations)
    return c.json({ ok: true })
  })

  return app
}
