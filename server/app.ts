/**
 * server/app.ts — Hono app factory.
 * Mounts route modules; each route receives the AppContext via closure.
 *
 * Serves the no-build Claude Design frontend (client-next/) as static files at
 * /next/*. There is no bundled SPA anymore — the CLI panel is /next/.
 */
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileRoute } from './routes/file.js'
import { annotationsRoute } from './routes/annotations.js'
import { rewriteRoute } from './routes/rewrite.js'
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
}

export function createApp(ctx: AppContext) {
  const app = new Hono()

  // API routes — must take precedence over the static catch-all below.
  app.route('/api', fileRoute(ctx))
  app.route('/api', annotationsRoute(ctx))
  app.route('/api', rewriteRoute(ctx))
  app.route('/api', aiRoute(ctx))
  app.route('/api', sessionRoute(ctx))
  app.route('/api', sessionsRoute(ctx))

  app.get('/healthz', (c) => c.json({ ok: true }))
  app.get('/api/healthz', (c) => c.json({ ok: true }))

  // No-build Claude Design frontend (D-5): serve client-next/ at /next/* in both
  // dev and prod. No build step, no bundler; mounted after /api so route
  // precedence is /api → /next. Absent client-next/ (e.g. published npm package)
  // just 404s — no build coupling.
  const nextDir = resolve(ctx.repoRoot, 'client-next')
  if (existsSync(nextDir)) {
    app.use(
      '/next/*',
      serveStatic({ root: nextDir, rewriteRequestPath: (p) => p.replace(/^\/next/, '') }),
    )
  }

  return app
}
