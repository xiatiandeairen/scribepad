import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { readPlanState, writePlanState } from '../services/annotations.js'
import type { PlanStateRequest, PlanStateResponse } from '../../types/api.js'

export function planStateRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/plan-state', async (c) => {
    const session = ctx.sessionManager.getFallbackSession()
    const planState = await readPlanState(session.filePath)
    const body: PlanStateResponse = { planState }
    return c.json(body)
  })

  app.post('/plan-state', async (c) => {
    const req = (await c.req.json()) as PlanStateRequest
    const session = ctx.sessionManager.getFallbackSession()
    await writePlanState(session.filePath, req.planState)
    session.dirty = true
    return c.json({ ok: true })
  })

  return app
}
