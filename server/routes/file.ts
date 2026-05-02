/**
 * routes/file — GET /api/file, POST /api/save
 *
 * Foundation skeleton: route shape declared, services wired but unimplemented.
 * v0.2 will fill service bodies.
 */
import { Hono } from 'hono'
import type { AppContext } from '../app.js'
import { readDocument, saveDocument } from '../services/document.js'
import type { FileResponse, SaveRequest, SaveResponse } from '../../types/api.js'

export function fileRoute(ctx: AppContext) {
  const app = new Hono()

  app.get('/file', async (c) => {
    const doc = await readDocument(ctx.filePath)
    const body: FileResponse = { path: doc.path, content: doc.content }
    return c.json(body)
  })

  app.post('/save', async (c) => {
    const req = (await c.req.json()) as SaveRequest
    await saveDocument(ctx.filePath, req.content)
    const body: SaveResponse = { ok: true }
    return c.json(body)
  })

  return app
}
