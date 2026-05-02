/**
 * server/index.ts — entry point.
 * Parses CLI arg (markdown file path), mounts on a target file, starts hono on :3000.
 *
 * Usage: scribepad <path-to-markdown>
 *
 * v0.2 will wire real route handlers; this is foundation skeleton.
 */
import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createApp } from './app.js'

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

const app = createApp({ filePath })
const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port })
console.log(`[scribepad] serving ${filePath}`)
console.log(`[scribepad] http://localhost:${port}`)
