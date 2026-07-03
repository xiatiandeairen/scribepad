import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { getAiStatus, markAiUntested, testAi } from '../services/ai-status.js'
import type {
  AiConfigRequest,
  AiConfigResponse,
  AiStatusResponse,
  ErrorResponse,
} from '../../types/api.js'

export function aiRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/ai/config', (c) => {
    const body: AiConfigResponse = { config: ctx.getConfig().ai, source: 'config' }
    return c.json(body)
  })

  app.put('/ai/config', async (c) => {
    try {
      const req = (await c.req.json()) as AiConfigRequest
      await ctx.updateAiConfig(req.config)
      markAiUntested()
      const body: AiConfigResponse = { config: ctx.getConfig().ai }
      return c.json(body)
    } catch (e) {
      const err: ErrorResponse = { error: String((e as Error).message ?? e) }
      return c.json(err, 400)
    }
  })

  app.get('/ai/status', (c) => {
    const body: AiStatusResponse = getAiStatus(ctx.getConfig().ai)
    return c.json(body)
  })

  app.post('/ai/test', async (c) => {
    const body: AiStatusResponse = await testAi(ctx.getConfig().ai)
    return c.json(body)
  })

  return app
}
