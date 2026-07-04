/**
 * routes/extract — GET /api/extract
 *
 * Returns the current document's ExtractResult (points + decision cards),
 * recomputed on every request via core/extract. Never persisted. Degrades to a
 * partial/empty result for non-8-section documents rather than erroring.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import type { ErrorResponse, ExtractResponse } from '../../types/api.js'

export function extractRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/extract', async (c) => {
    try {
      const session = ctx.sessionManager.getFallbackSession()
      const result = await ctx.sessionManager.extract(session.id)
      const body: ExtractResponse = { result }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 500)
    }
  })

  return app
}
