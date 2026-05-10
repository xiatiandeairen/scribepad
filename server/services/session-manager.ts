import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { Annotation } from '../../types/annotation.js'
import type { SessionResponse } from '../../types/api.js'
import {
  readAnnotations,
  readPlanState,
  sidecarPath,
  writeAnnotations,
  writePlanState,
} from './annotations.js'
import { readDocument, saveDocument } from './document.js'
import { rewriteItems } from './rewrite.js'
import type { RewriteItem, RewriteResultEntry } from '../../types/api.js'
import type { PlanItemState } from '../../types/plan.js'

export interface ClientState {
  id: string
  connectedAt: string
  lastSeenAt: string
}

export interface DocumentSession {
  id: string
  filePath: string
  sidecarPath: string
  outputPath: string
  status: 'active' | 'closing' | 'closed'
  startedAt: string
  lastActivityAt: string
  dirty: boolean
  exportedAt?: string
  clients: Map<string, ClientState>
}

export interface SessionManagerOptions {
  now?: () => Date
  baseUrl?: () => string
}

export class SessionManager {
  private readonly now: () => Date
  private readonly baseUrl: () => string
  private readonly sessions = new Map<string, DocumentSession>()
  private readonly sessionsByPath = new Map<string, string>()
  private fallbackSessionId: string | undefined
  private lastActivityAt: string
  private hasEverHadActiveSession = false

  constructor(options: SessionManagerOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.baseUrl = options.baseUrl ?? (() => 'http://127.0.0.1:0')
    this.lastActivityAt = this.now().toISOString()
  }

  openSession(filePath: string): { sessionId: string; url: string } {
    const absolutePath = resolve(filePath)
    if (!existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`)
    }

    const existingId = this.sessionsByPath.get(absolutePath)
    const existing = existingId ? this.sessions.get(existingId) : undefined
    if (existing && existing.status !== 'closed') {
      this.touch(existing)
      return { sessionId: existing.id, url: this.sessionUrl(existing.id) }
    }

    const now = this.now().toISOString()
    const id = makeId('sess')
    const session: DocumentSession = {
      id,
      filePath: absolutePath,
      sidecarPath: sidecarPath(absolutePath),
      outputPath: outputPathFor(absolutePath),
      status: 'active',
      startedAt: now,
      lastActivityAt: now,
      dirty: false,
      clients: new Map(),
    }
    this.sessions.set(id, session)
    this.sessionsByPath.set(absolutePath, id)
    this.fallbackSessionId ??= id
    this.hasEverHadActiveSession = true
    this.lastActivityAt = now
    return { sessionId: id, url: this.sessionUrl(id) }
  }

  getFallbackSession(): DocumentSession {
    const id = this.fallbackSessionId
    const session = id ? this.sessions.get(id) : undefined
    if (!session) throw new Error('No document session is open')
    return session
  }

  getSession(id: string): DocumentSession {
    const session = this.sessions.get(id)
    if (!session || session.status === 'closed') {
      throw new Error(`Session not found: ${id}`)
    }
    return session
  }

  getSessionResponse(id: string): SessionResponse {
    return toResponse(this.getSession(id))
  }

  connect(id: string): { clientId: string; session: SessionResponse } {
    const session = this.getSession(id)
    const now = this.now().toISOString()
    const clientId = makeId('client')
    session.clients.set(clientId, { id: clientId, connectedAt: now, lastSeenAt: now })
    this.touch(session)
    return { clientId, session: toResponse(session) }
  }

  heartbeat(id: string, clientId: string): SessionResponse {
    const session = this.getSession(id)
    const client = session.clients.get(clientId)
    if (client) {
      client.lastSeenAt = this.now().toISOString()
    }
    this.touch(session)
    return toResponse(session)
  }

  disconnect(id: string, clientId: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.clients.delete(clientId)
    this.touch(session)
  }

  async readFile(id: string) {
    const session = this.getSession(id)
    this.touch(session)
    return readDocument(session.filePath)
  }

  async saveFile(id: string, content: string): Promise<void> {
    const session = this.getSession(id)
    await saveDocument(session.filePath, content)
    session.dirty = true
    this.touch(session)
  }

  async readAnnotations(id: string): Promise<Annotation[]> {
    const session = this.getSession(id)
    this.touch(session)
    return readAnnotations(session.filePath)
  }

  async writeAnnotations(id: string, annotations: Annotation[]): Promise<void> {
    const session = this.getSession(id)
    await writeAnnotations(session.filePath, annotations)
    session.dirty = true
    this.touch(session)
  }

  async readPlanState(id: string): Promise<PlanItemState[]> {
    const session = this.getSession(id)
    this.touch(session)
    return readPlanState(session.filePath)
  }

  async writePlanState(id: string, planState: PlanItemState[]): Promise<void> {
    const session = this.getSession(id)
    await writePlanState(session.filePath, planState)
    session.dirty = true
    this.touch(session)
  }

  async rewrite(id: string, fullDoc: string, items: RewriteItem[]): Promise<RewriteResultEntry[]> {
    const session = this.getSession(id)
    const existing = await readAnnotations(session.filePath)
    this.touch(session)
    return rewriteItems(fullDoc, items, existing)
  }

  async done(id: string, content?: string): Promise<{ outputPath: string }> {
    const session = this.getSession(id)
    session.status = 'closing'
    if (content !== undefined) {
      await saveDocument(session.filePath, content)
    }
    const finalContent = await readFile(session.filePath, 'utf8')
    await writeFile(session.outputPath, finalContent, 'utf8')
    session.exportedAt = this.now().toISOString()
    session.dirty = false
    session.status = 'closed'
    session.clients.clear()
    this.sessionsByPath.delete(session.filePath)
    this.lastActivityAt = this.now().toISOString()
    return { outputPath: session.outputPath }
  }

  shouldShutdown(options: { initialIdleMs: number; activeIdleMs: number }): boolean {
    const active = [...this.sessions.values()].some((session) => session.status === 'active')
    if (active) return false
    const idleMs = this.hasEverHadActiveSession ? options.activeIdleMs : options.initialIdleMs
    return this.now().getTime() - Date.parse(this.lastActivityAt) > idleMs
  }

  private touch(session: DocumentSession): void {
    const now = this.now().toISOString()
    session.lastActivityAt = now
    this.lastActivityAt = now
  }

  private sessionUrl(id: string): string {
    return `${this.baseUrl()}/s/${encodeURIComponent(id)}`
  }
}

export function outputPathFor(filePath: string): string {
  const dir = dirname(filePath)
  const base = basename(filePath)
  const ext = extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  return join(dir, `${stem}.agent.md`)
}

function toResponse(session: DocumentSession): SessionResponse {
  const response: SessionResponse = {
    id: session.id,
    filePath: session.filePath,
    fileName: basename(session.filePath),
    startedAt: session.startedAt,
    lastHeartbeatAt: session.lastActivityAt,
    dirty: session.dirty,
  }
  if (session.exportedAt) response.exportedAt = session.exportedAt
  response.agentContextPath = session.outputPath
  return response
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now()}-${rand}`
}
