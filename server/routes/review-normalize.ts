import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import {
  normalizeReviewPlanRequest,
  ReviewNormalizeInputError,
} from '../services/review-normalize.js'
import type { ErrorResponse, ReviewNormalizeRequest } from '../../types/api.js'

export function reviewNormalizeRoute(ctx: AppContext) {
  const app = new Hono()

  app.post('/review-normalize', async (c) => {
    const req = (await c.req.json()) as ReviewNormalizeRequest
    try {
      return c.json(await normalizeReviewPlanRequest(req, ctx.getConfig().ai))
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, e instanceof ReviewNormalizeInputError ? 400 : 500)
    }
  })

  return app
}
