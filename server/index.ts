/**
 * server/index.ts — CLI entry point.
 *
 * `scribepad <path-to-markdown>` opens a document session on the project-local
 * scribepad server. If the server is already running, this process reuses it
 * and exits after printing the session URL.
 */
import { serve } from '@hono/node-server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import {
  cleanupRegistry,
  findRepoRoot,
  isServerAlive,
  openDocumentOnServer,
  readRegistry,
  writeRegistry,
} from './registry.js'
import { SessionManager } from './services/session-manager.js'
import { DEFAULT_CONFIG, loadConfig, writeProjectLocalAiConfig } from './config.js'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: scribepad <path-to-markdown>')
  process.exit(1)
}

const filePath = resolve(arg)
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

const explicitPort = process.env.PORT ? Number(process.env.PORT) : undefined
const sessionMode = explicitPort === undefined
const repoRoot = findRepoRoot(process.cwd())
let config = await loadConfig({ env: process.env, repoRoot }).catch((error: unknown) => {
  console.warn(String((error as Error).message ?? error))
  console.warn('[scribepad] falling back to default config')
  return { ...DEFAULT_CONFIG }
})

if (sessionMode) {
  const existing = await readRegistry(repoRoot)
  if (!process.env.SCRIBEPAD_FORCE_SERVER && existing && (await isServerAlive(existing))) {
    try {
      const opened = await openDocumentOnServer(existing.url, filePath)
      console.log(`[scribepad] ${opened.url}`)
      process.exit(0)
    } catch (error: unknown) {
      console.warn(
        `[scribepad] ignoring stale server registry: ${String((error as Error).message ?? error)}`,
      )
      await cleanupRegistry(repoRoot)
    }
  }
  if (existing) await cleanupRegistry(repoRoot)
}
let baseUrl = 'http://127.0.0.1:0'
const sessionManager = new SessionManager({
  repoRoot,
  baseUrl: () => baseUrl,
  getAiConfig: () => config.ai,
})

let shutdownStarted = false

function requestClose(reason = 'server closed'): void {
  if (shutdownStarted) return
  shutdownStarted = true
  console.log(`[scribepad] ${reason}`)
  setTimeout(() => {
    server.close(() => process.exit(0))
  }, 25)
}

const app = createApp({
  sessionManager,
  repoRoot,
  getConfig: () => config,
  updateAiConfig: async (ai) => {
    await writeProjectLocalAiConfig(repoRoot, ai)
    config = { ...config, ai }
  },
  requestClose: sessionMode ? () => requestClose() : undefined,
  serveClient: sessionMode,
})

const port = explicitPort ?? 0
const server = serve({ fetch: app.fetch, port, hostname: config.host }, (info) => {
  baseUrl = `http://${config.host}:${info.port}`
  const opened = sessionManager.openSession(filePath)
  console.log(`[scribepad] serving ${filePath}`)
  console.log(`[scribepad] ${opened.url}`)
  if (sessionMode) {
    console.log('[scribepad] server is shared by document sessions in this repo')
    void writeRegistry(repoRoot, {
      pid: process.pid,
      port: info.port,
      url: baseUrl,
      startedAt: new Date().toISOString(),
      repoRoot,
    })
  }
})

if (sessionMode) {
  const timer = setInterval(() => {
    if (
      sessionManager.shouldShutdown({
        initialIdleMs: config.initialIdleMs,
        activeIdleMs: config.activeIdleMs,
      })
    ) {
      clearInterval(timer)
      void cleanupRegistry(repoRoot)
      requestClose('server idle timeout; shutting down')
    }
  }, 5_000)
  timer.unref()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void cleanupRegistry(repoRoot)
    requestClose(`${signal} received; shutting down`)
  })
}
