import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { Annotation } from '../../types/annotation.js'
import type { SessionResponse } from '../../types/api.js'
import type { DocSource, ReviewState, ReviewStore } from '../../types/ports.js'
import { createFsDocSource } from '../adapters/docsource-fs.js'
import { createSidecarStore } from '../adapters/store-sidecar.js'
import { validateStateTransition } from '../../core/annotation-state.js'
import { rewriteItems } from './rewrite.js'
import type { AiConfig, RewriteItem, RewriteResultEntry } from '../../types/api.js'
import type { PlanItemState } from '../../types/plan.js'
import { documentStatePath, exportPathFor } from '../paths.js'

export interface ClientState {
  id: string
  connectedAt: string
  lastSeenAt: string
}

export interface DocumentSession {
  id: string
  filePath: string
  repoRoot: string
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
  repoRoot?: string
  env?: NodeJS.ProcessEnv
  now?: () => Date
  baseUrl?: () => string
  getAiConfig?: () => AiConfig
  /** Injected at the composition root; defaults to the fs-backed source. */
  docSource?: DocSource
  /** Injected at the composition root; defaults to the sidecar-backed store. */
  reviewStore?: ReviewStore
}

type DoneResult = { outputPath: string }
type DoneWaiter = {
  resolve: (result: DoneResult) => void
  reject: (error: Error) => void
}

export class SessionManager {
  private readonly repoRoot: string
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => Date
  private readonly baseUrl: () => string
  private readonly getAiConfig: (() => AiConfig) | undefined
  private readonly docSource: DocSource
  private readonly reviewStore: ReviewStore
  private readonly sessions = new Map<string, DocumentSession>()
  private readonly sessionsByPath = new Map<string, string>()
  private readonly doneWaiters = new Map<string, DoneWaiter[]>()
  private fallbackSessionId: string | undefined
  private lastActivityAt: string
  private hasEverHadActiveSession = false

  constructor(options: SessionManagerOptions = {}) {
    this.repoRoot = resolve(options.repoRoot ?? process.cwd())
    this.env = options.env ?? process.env
    this.now = options.now ?? (() => new Date())
    this.baseUrl = options.baseUrl ?? (() => 'http://127.0.0.1:0')
    this.getAiConfig = options.getAiConfig
    this.docSource = options.docSource ?? createFsDocSource()
    this.reviewStore =
      options.reviewStore ?? createSidecarStore({ repoRoot: this.repoRoot, env: this.env })
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
      repoRoot: this.repoRoot,
      sidecarPath: documentStatePath(this.repoRoot, absolutePath, this.env),
      outputPath: outputPathFor(this.repoRoot, absolutePath, this.env),
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
    const result = await this.docSource.read(session.filePath)
    if (!result.ok) throw new Error(result.error.message)
    return { path: result.value.docId, content: result.value.content }
  }

  async saveFile(id: string, content: string): Promise<void> {
    const session = this.getSession(id)
    await this.writeDoc(session.filePath, content)
    session.dirty = true
    this.touch(session)
  }

  async readAnnotations(id: string): Promise<Annotation[]> {
    const session = this.getSession(id)
    this.touch(session)
    return (await this.loadState(session.filePath)).annotations
  }

  async writeAnnotations(id: string, annotations: Annotation[]): Promise<void> {
    const session = this.getSession(id)
    const state = await this.loadState(session.filePath)
    // Preserve the pre-refactor guard: reject illegal lifecycle transitions
    // (matched by id) before persisting. New ids skip validation.
    const prevById = new Map(state.annotations.map((a) => [a.id, a]))
    for (const next of annotations) {
      const prev = prevById.get(next.id)
      if (prev && prev.state !== next.state && !validateStateTransition(prev.state, next.state)) {
        throw new Error(
          `Illegal state transition for annotation ${next.id}: ${prev.state} -> ${next.state}`,
        )
      }
    }
    await this.saveState(session.filePath, { ...state, annotations })
    session.dirty = true
    this.touch(session)
  }

  async readPlanState(id: string): Promise<PlanItemState[]> {
    const session = this.getSession(id)
    this.touch(session)
    return (await this.loadState(session.filePath)).planState
  }

  async writePlanState(id: string, planState: PlanItemState[]): Promise<void> {
    const session = this.getSession(id)
    const state = await this.loadState(session.filePath)
    await this.saveState(session.filePath, { ...state, planState })
    session.dirty = true
    this.touch(session)
  }

  async rewrite(id: string, fullDoc: string, items: RewriteItem[]): Promise<RewriteResultEntry[]> {
    const session = this.getSession(id)
    const existing = (await this.loadState(session.filePath)).annotations
    this.touch(session)
    const aiConfig = this.getAiConfig?.()
    if (!aiConfig) throw new Error('AI config unavailable')
    return rewriteItems(fullDoc, items, existing, aiConfig)
  }

  async done(id: string, content?: string): Promise<DoneResult> {
    const session = this.getSession(id)
    session.status = 'closing'
    if (content !== undefined) {
      await this.writeDoc(session.filePath, content)
    }
    const readResult = await this.docSource.read(session.filePath)
    if (!readResult.ok) throw new Error(readResult.error.message)
    const finalContent = readResult.value.content
    await mkdir(dirname(session.outputPath), { recursive: true })
    await writeFile(session.outputPath, finalContent, 'utf8')
    session.exportedAt = this.now().toISOString()
    session.dirty = false
    session.status = 'closed'
    session.clients.clear()
    this.sessionsByPath.delete(session.filePath)
    this.lastActivityAt = this.now().toISOString()
    const result = { outputPath: session.outputPath }
    this.resolveDoneWaiters(id, result)
    return result
  }

  waitForDone(id: string): Promise<DoneResult> {
    const session = this.sessions.get(id)
    if (!session) {
      return Promise.reject(new Error(`Session not found: ${id}`))
    }
    if (session.status === 'closed' && session.exportedAt) {
      return Promise.resolve({ outputPath: session.outputPath })
    }
    return new Promise<DoneResult>((resolve, reject) => {
      const waiters = this.doneWaiters.get(id) ?? []
      waiters.push({ resolve, reject })
      this.doneWaiters.set(id, waiters)
    })
  }

  shouldShutdown(options: { initialIdleMs: number; activeIdleMs: number }): boolean {
    const active = [...this.sessions.values()].some((session) => session.status === 'active')
    if (active) return false
    const idleMs = this.hasEverHadActiveSession ? options.activeIdleMs : options.initialIdleMs
    return this.now().getTime() - Date.parse(this.lastActivityAt) > idleMs
  }

  private async writeDoc(filePath: string, content: string): Promise<void> {
    if (!this.docSource.write) throw new Error('document source is read-only')
    const result = await this.docSource.write(filePath, content)
    if (!result.ok) throw new Error(result.error.message)
  }

  private async loadState(filePath: string): Promise<ReviewState> {
    const result = await this.reviewStore.load(filePath)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  private async saveState(filePath: string, state: ReviewState): Promise<void> {
    const result = await this.reviewStore.save(filePath, state)
    if (!result.ok) throw new Error(result.error.message)
  }

  private touch(session: DocumentSession): void {
    const now = this.now().toISOString()
    session.lastActivityAt = now
    this.lastActivityAt = now
  }

  private sessionUrl(id: string): string {
    return `${this.baseUrl()}/s/${encodeURIComponent(id)}`
  }

  private resolveDoneWaiters(id: string, result: DoneResult): void {
    const waiters = this.doneWaiters.get(id)
    if (!waiters) return
    this.doneWaiters.delete(id)
    for (const waiter of waiters) {
      waiter.resolve(result)
    }
  }
}

export function outputPathFor(
  repoRoot: string,
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return exportPathFor(repoRoot, filePath, env)
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
