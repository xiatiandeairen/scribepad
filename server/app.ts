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
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileRoute } from './routes/file.js'
import { annotationsRoute } from './routes/annotations.js'
import { planStateRoute } from './routes/plan-state.js'
import { rewriteRoute } from './routes/rewrite.js'
import { reviewNormalizeRoute } from './routes/review-normalize.js'
import { sessionRoute } from './routes/session.js'
import { sessionsRoute } from './routes/sessions.js'
import { aiRoute } from './routes/ai.js'
import type { SessionManager } from './services/session-manager.js'
import type { ScribepadConfig } from './config.js'
import type { AiConfig } from '../types/api.js'

export interface AppContext {
  sessionManager: SessionManager
  repoRoot: string
  getConfig: () => ScribepadConfig
  updateAiConfig: (ai: AiConfig) => Promise<void>
  /** Request graceful shutdown after the current HTTP response is sent. */
  requestClose?: () => void
  /** Serve the built SPA outside NODE_ENV=production, used by CLI session mode. */
  serveClient?: boolean
}

export function createApp(ctx: AppContext) {
  const app = new Hono()

  // API routes — must take precedence over the static catch-all below.
  app.route('/api', fileRoute(ctx))
  app.route('/api', annotationsRoute(ctx))
  app.route('/api', planStateRoute(ctx))
  app.route('/api', rewriteRoute(ctx))
  app.route('/api', reviewNormalizeRoute(ctx))
  app.route('/api', aiRoute(ctx))
  app.route('/api', sessionRoute(ctx))
  app.route('/api', sessionsRoute(ctx))

  app.get('/healthz', (c) => c.json({ ok: true }))
  app.get('/api/healthz', (c) => c.json({ ok: true }))

  // No-build Claude Design frontend (D-5): serve client-next/ at /next/* in both
  // dev and prod. Independent of the SPA block below (no build step, no bundler);
  // mounted after /api and before the SPA catch-all so route precedence is
  // /api → /next → SPA fallback. Absent client-next/ (e.g. published npm package)
  // just 404s — no build coupling.
  const nextDir = resolve(ctx.repoRoot, 'client-next')
  if (existsSync(nextDir)) {
    app.use(
      '/next/*',
      serveStatic({ root: nextDir, rewriteRequestPath: (p) => p.replace(/^\/next/, '') }),
    )
  }

  // Prod-only static serving (review G3 #1).
  // Skip entirely in dev — dev clients live on Vite (:5173) and proxy /api → here.
  // Otherwise stale dist/client (from a prior build) would shadow the live Vite UI
  // and confuse developers who hit :3000 by mistake.
  const isProd = process.env.NODE_ENV === 'production'
  const shouldServeClient = isProd || ctx.serveClient === true
  const serverDir = dirname(fileURLToPath(import.meta.url))
  const clientDir = resolve(serverDir, '../client')
  const indexHtml = resolve(clientDir, 'index.html')

  if (shouldServeClient && existsSync(clientDir)) {
    app.use('/*', serveStatic({ root: clientDir }))
    if (existsSync(indexHtml)) {
      app.get('/*', serveStatic({ path: indexHtml }))
    }
  } else if (shouldServeClient) {
    console.warn(`[scribepad] client build not found at ${clientDir}; run \`npm run build\` first.`)
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
