/**
 * server/app.ts — Hono app factory.
 * Mounts route modules; each route receives the AppContext via closure.
 *
 * v0.2 will fill route implementations; this is foundation skeleton.
 */
import { Hono } from 'hono'
import { fileRoute } from './routes/file.js'
import { annotationsRoute } from './routes/annotations.js'
import { rewriteRoute } from './routes/rewrite.js'

export interface AppContext {
  /** Absolute path to the markdown file being served. */
  filePath: string
}

export function createApp(ctx: AppContext) {
  const app = new Hono()

  app.route('/api', fileRoute(ctx))
  app.route('/api', annotationsRoute(ctx))
  app.route('/api', rewriteRoute(ctx))

  app.get('/healthz', (c) => c.json({ ok: true }))

  return app
}
