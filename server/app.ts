/**
 * server/app.ts — Hono app factory.
 * Mounts route modules; each route receives the AppContext via closure.
 *
 * In prod (single-server mode), also serves the built SPA from `dist/client/`
 * with an index.html fallback so client-side routes resolve. In dev, when
 * `dist/client` is absent, static serving is skipped (Vite proxy handles it).
 */
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileRoute } from './routes/file.js'
import { annotationsRoute } from './routes/annotations.js'
import { rewriteRoute } from './routes/rewrite.js'

export interface AppContext {
  /** Absolute path to the markdown file being served. */
  filePath: string
}

export function createApp(ctx: AppContext) {
  const app = new Hono()

  // API routes — must take precedence over the static catch-all below.
  app.route('/api', fileRoute(ctx))
  app.route('/api', annotationsRoute(ctx))
  app.route('/api', rewriteRoute(ctx))

  app.get('/healthz', (c) => c.json({ ok: true }))

  // Prod static serving (review G3 #1).
  // Resolve relative to cwd so `node dist/server/index.js` from project root finds dist/client.
  const clientDir = resolve(process.cwd(), 'dist/client')
  const indexHtml = resolve(clientDir, 'index.html')

  if (existsSync(clientDir)) {
    // Serve static assets from dist/client/. `root` is relative to cwd.
    app.use('/*', serveStatic({ root: './dist/client' }))

    // SPA index fallback: any non-/api request that didn't match a static file
    // falls through to index.html so client-side routes render.
    if (existsSync(indexHtml)) {
      app.get('/*', serveStatic({ path: './dist/client/index.html' }))
    }
  } else {
    console.warn(
      `[scribepad] dist/client not found at ${clientDir}; skipping static serving (dev mode — use Vite proxy)`,
    )
  }

  return app
}
