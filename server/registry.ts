import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { OpenSessionResponse } from '../types/api.js'
import { runtimeRegistryPath } from './paths.js'

export interface ServerRegistry {
  pid: number
  port: number
  url: string
  startedAt: string
  repoRoot: string
}

export function findRepoRoot(start: string): string {
  let cur = resolve(start)
  while (true) {
    if (existsSync(join(cur, '.git'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return resolve(start)
    cur = parent
  }
}

export function registryPath(repoRoot: string): string {
  return runtimeRegistryPath(repoRoot)
}

export async function readRegistry(repoRoot: string): Promise<ServerRegistry | null> {
  try {
    const raw = await readFile(registryPath(repoRoot), 'utf8')
    return JSON.parse(raw) as ServerRegistry
  } catch {
    return null
  }
}

export async function writeRegistry(repoRoot: string, registry: ServerRegistry): Promise<void> {
  const path = registryPath(repoRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(registry, null, 2), 'utf8')
}

export async function cleanupRegistry(repoRoot: string): Promise<void> {
  await rm(registryPath(repoRoot), { force: true })
}

export async function isServerAlive(registry: ServerRegistry): Promise<boolean> {
  try {
    process.kill(registry.pid, 0)
  } catch {
    return false
  }
  try {
    const res = await fetch(`${registry.url}/api/healthz`)
    return res.ok
  } catch {
    return false
  }
}

export async function openDocumentOnServer(
  baseUrl: string,
  filePath: string,
): Promise<OpenSessionResponse> {
  const res = await fetch(`${baseUrl}/api/sessions/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as OpenSessionResponse
}
