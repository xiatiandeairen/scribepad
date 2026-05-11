/**
 * routes/rewrite — POST /api/rewrite
 *
 * Foundation skeleton.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { rewriteItems } from '../services/rewrite.js'
import { readAnnotations } from '../services/annotations.js'
import type { RewriteRequest, RewriteResponse, ErrorResponse } from '../../types/api.js'

export function rewriteRoute(ctx: AppContext) {
  const app = new Hono()

  app.post('/rewrite', async (c) => {
    const req = (await c.req.json()) as RewriteRequest
    if (!Array.isArray(req.items) || req.items.length === 0) {
      const err: ErrorResponse = { error: 'items[] required' }
      return c.json(err, 400)
    }
    try {
      const session = ctx.sessionManager.getFallbackSession()
      const existing = await readAnnotations(session.filePath)
      const results = await rewriteItems(req.fullDoc, req.items, existing, ctx.getConfig().ai)
      const body: RewriteResponse = { results }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 500)
    }
  })

  return app
}
