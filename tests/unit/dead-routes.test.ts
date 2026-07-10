/**
 * tests/unit/dead-routes — locks the app's mounted route surface to the
 * sessions-scoped API + the two standalone endpoints that stay live
 * (GET /api/session, ai.ts). Cleanup pass: server/routes/file.ts,
 * annotations.ts, rewrite.ts, and the heartbeat/close endpoints in
 * session.ts had no production caller (client-next uses the
 * sessions/:id/* equivalents) and must 404 once removed.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import type { AppContext } from '../../server/app.js'
import { SessionManager } from '../../server/services/session-manager.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

function buildApp() {
  const manager = new SessionManager({ repoRoot })
  const ctx = {
    sessionManager: manager,
    repoRoot,
    getConfig: () => ({}),
    updateAiConfig: async () => {},
  } as unknown as AppContext
  return createApp(ctx)
}

describe('dead routes are gone', () => {
  it('404s the standalone /api/file endpoints', async () => {
    const app = buildApp()
    expect((await app.request('/api/file')).status).toBe(404)
    expect((await app.request('/api/save', { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('404s the standalone /api/annotations endpoints', async () => {
    const app = buildApp()
    expect((await app.request('/api/annotations')).status).toBe(404)
    expect((await app.request('/api/annotations', { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('404s the standalone /api/rewrite endpoint', async () => {
    const app = buildApp()
    expect((await app.request('/api/rewrite', { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('404s /api/session/heartbeat and /api/session/close', async () => {
    const app = buildApp()
    expect((await app.request('/api/session/heartbeat', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/api/session/close', { method: 'POST' })).status).toBe(404)
  })

  it('keeps GET /api/session alive', async () => {
    const app = buildApp()
    // No session opened yet — the live handler still responds (404 with a
    // JSON body from getFallbackSession's own guard), never Hono's generic 404.
    const res = await app.request('/api/session')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'session is not enabled' })
  })
})
