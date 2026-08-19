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
import { sessionsRoute } from './routes/sessions.js'
import { aiRoute } from './routes/ai.js'
import { feedbackRoute } from './routes/feedback.js'
import type { SessionManager } from './services/session-manager.js'
import type { ScribepadConfig } from './config.js'
import type { AiConfig } from '../types/api.js'
import type { FeedbackSink } from '../types/ports.js'

export interface AppContext {
  sessionManager: SessionManager
  repoRoot: string
  getConfig: () => ScribepadConfig
  updateAiConfig: (ai: AiConfig) => Promise<void>
  /** Request graceful shutdown after the current HTTP response is sent. */
  requestClose?: () => void
  /**
   * Optional so index.ts (the composition root) isn't forced to wire it up —
   * the feedback route falls back to the default fs-backed adapter when
   * absent. Unlike `sessionManager`, feedback has no per-request state to own,
   * so there's nothing gained by mandating construction at the composition
   * root instead of lazily inside the route.
   */
  feedbackSink?: FeedbackSink
}

export function createApp(ctx: AppContext) {
  const app = new Hono()

  // API routes — must take precedence over the static catch-all below.
  app.route('/api', aiRoute(ctx))
  app.route('/api', sessionsRoute(ctx))
  app.route('/api', feedbackRoute(ctx))

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
