/**
 * routes/annotations — GET /api/annotations, POST /api/annotations
 *
 * Foundation skeleton.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { readAnnotations, writeAnnotations } from '../services/annotations.js'
import type { AnnotationsResponse, AnnotationsRequest } from '../../types/api.js'

export function annotationsRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/annotations', async (c) => {
    const annotations = await readAnnotations(ctx.filePath)
    const body: AnnotationsResponse = { annotations }
    return c.json(body)
  })

  app.post('/annotations', async (c) => {
    const req = (await c.req.json()) as AnnotationsRequest
    await writeAnnotations(ctx.filePath, req.annotations)
    return c.json({ ok: true })
  })

  return app
}
