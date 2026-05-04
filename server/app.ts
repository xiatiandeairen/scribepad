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

  // Prod-only static serving (review G3 #1).
  // Skip entirely in dev — dev clients live on Vite (:5173) and proxy /api → here.
  // Otherwise stale dist/client (from a prior build) would shadow the live Vite UI
  // and confuse developers who hit :3000 by mistake.
  const isProd = process.env.NODE_ENV === 'production'
  const clientDir = resolve(process.cwd(), 'dist/client')
  const indexHtml = resolve(clientDir, 'index.html')

  if (isProd && existsSync(clientDir)) {
    app.use('/*', serveStatic({ root: './dist/client' }))
    if (existsSync(indexHtml)) {
      app.get('/*', serveStatic({ path: './dist/client/index.html' }))
    }
  } else if (isProd) {
    console.warn(
      `[scribepad] prod mode but dist/client not found at ${clientDir}; run \`npm run build\` first.`,
    )
  } else {
    // Dev: catch any non-/api GET and tell the user to use Vite.
    app.get('/*', (c) =>
      c.text(
        '[scribepad dev] this server only serves /api/* in dev mode.\nOpen the SPA at http://localhost:5173/',
        404,
      ),
    )
  }

  return app
}
