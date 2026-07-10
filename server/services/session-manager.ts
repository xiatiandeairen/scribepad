import { basename, resolve } from 'node:path'
import type { Annotation } from '../../types/annotation.js'
import type { SessionResponse } from '../../types/api.js'
import type { Signoff } from '../../types/domain.js'
import type {
  DocSource,
  ExportSink,
  LlmRunner,
  ReviewState,
  ReviewStore,
} from '../../types/ports.js'
import { createFsDocSource } from '../adapters/docsource-fs.js'
import { createFsExportSink } from '../adapters/export-sink-fs.js'
import { createSidecarStore } from '../adapters/store-sidecar.js'
import { createExecaRunner } from '../adapters/llm-execa.js'
import { validateStateTransition } from '../../core/annotation-state.js'
import { applyRewrites, rewriteItems } from '../../core/rewrite.js'
import type { EditAt, RewriteApplyError } from '../../core/rewrite.js'
import { extract } from '../../core/extract/index.js'
import { locateSectionInsertAt, nextLabel, SELECTION_OP_KIND } from '../../core/section-insert.js'
import {
  renderSelectionFragment,
  runSelectionEditTask,
} from '../../core/agent/tasks/selectionEdit.js'
import type { SelectionOp } from '../../core/agent/tasks/selectionEdit.js'
import type {
  AiConfig,
  RewriteApplyItem,
  RewriteApplyResponse,
  RewriteItem,
  RewriteResultEntry,
} from '../../types/api.js'
import type { ExtractResult } from '../../types/domain.js'
import { documentStatePath, exportPathFor } from '../paths.js'

/**
 * A rewrite-apply was rejected by the pure splice guard (drift / overlap /
 * out-of-bounds). Carries the core error's `kind` so the route can map it to a
 * 409 Conflict, distinct from an LLM failure (500).
 */
export class RewriteApplyConflictError extends Error {
  readonly kind: RewriteApplyError['kind']
  constructor(error: RewriteApplyError) {
    super(error.message)
    this.name = 'RewriteApplyConflictError'
    this.kind = error.kind
  }
}

/**
 * A selection-op (P6) could not be applied for a reason other than the splice
 * guard: the target section is missing/empty, or the LLM failed to produce the
 * fragment. Distinct from RewriteApplyConflictError (splice drift/overlap) so the
 * dispatcher can tell "nothing to append to" from "document changed under us".
 */
export class SelectionOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SelectionOpError'
  }
}

/** Result of a selection-op closed loop — the new label plus the mutated document. */
export interface SelectionOpResult {
  /** The label assigned to the newly inserted item (e.g. D5 / R6 / Q6). */
  newLabel: string
  /** Fresh extraction of the mutated document. */
  result: ExtractResult
  /** The full document content after the insert. */
  content: string
}

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
  /** Injected at the composition root; defaults to the fs-backed export sink. */
  exportSink?: ExportSink
  /** Injected for tests; defaults to a per-call execa runner from the AI config. */
  llmRunner?: LlmRunner
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
  private readonly exportSink: ExportSink
  private readonly llmRunner: LlmRunner | undefined
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
    this.exportSink = options.exportSink ?? createFsExportSink()
    this.llmRunner = options.llmRunner
    this.lastActivityAt = this.now().toISOString()
  }

  async openSession(filePath: string): Promise<{ sessionId: string; url: string }> {
    const absolutePath = resolve(filePath)
    // Existence check goes through the DocSource port (a read-only / remote
    // source has no local file to stat): a not-found read means "no such
    // document"; any other read fault surfaces its own message.
    const read = await this.docSource.read(absolutePath)
    if (!read.ok) {
      if (read.error.kind === 'not-found') {
        throw new Error(`File not found: ${absolutePath}`)
      }
      throw new Error(read.error.message)
    }

    const existingId = this.sessionsByPath.get(absolutePath)
    const existing = existingId ? this.sessions.get(existingId) : undefined
    if (existing && existing.status !== 'closed') {
      this.touch(existing)
      return { sessionId: existing.id, url: this.docPanelUrl(absolutePath) }
    }

    const now = this.now().toISOString()
    const id = makeId('sess')
    const session: DocumentSession = {
      id,
      filePath: absolutePath,
      repoRoot: this.repoRoot,
      sidecarPath: documentStatePath(this.repoRoot, absolutePath, this.env),
      outputPath: exportPathFor(this.repoRoot, absolutePath, this.env),
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
    return { sessionId: id, url: this.docPanelUrl(absolutePath) }
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

  /** Extract the current document into an ExtractResult. Recomputed each call — never persisted. */
  async extract(id: string): Promise<ExtractResult> {
    const session = this.getSession(id)
    this.touch(session)
    const result = await this.docSource.read(session.filePath)
    if (!result.ok) throw new Error(result.error.message)
    return extract(result.value.content)
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

  async readSignoffs(id: string): Promise<Signoff[]> {
    const session = this.getSession(id)
    this.touch(session)
    return (await this.loadState(session.filePath)).signoffs
  }

  async writeSignoffs(id: string, signoffs: Signoff[]): Promise<void> {
    const session = this.getSession(id)
    const state = await this.loadState(session.filePath)
    await this.saveState(session.filePath, { ...state, signoffs })
    session.dirty = true
    this.touch(session)
  }

  async rewrite(id: string, fullDoc: string, items: RewriteItem[]): Promise<RewriteResultEntry[]> {
    const session = this.getSession(id)
    this.touch(session)
    const aiConfig = this.getAiConfig?.()
    if (!aiConfig) throw new Error('AI config unavailable')
    const llm = this.llmRunner ?? createExecaRunner(aiConfig)
    return rewriteItems(fullDoc, items, llm)
  }

  /**
   * Rewrite-and-persist closed loop: read the current doc → rewrite each item's
   * selection via the LLM → splice the results back into the source → save →
   * re-extract. Returns the fresh ExtractResult + new full content for the
   * frontend to re-render.
   *
   * Reads the current document itself (no fullDoc from the client) so a stale
   * source can't clobber concurrent edits; the per-edit anchors still carry
   * `selection` for the drift guard. Throws RewriteApplyConflictError when the
   * splice guard rejects (drift / overlap / out-of-bounds) — nothing is written
   * in that case. Write failures and read-only sources surface as errors too.
   */
  async rewriteApply(id: string, items: RewriteApplyItem[]): Promise<RewriteApplyResponse> {
    const session = this.getSession(id)
    this.touch(session)
    const readResult = await this.docSource.read(session.filePath)
    if (!readResult.ok) throw new Error(readResult.error.message)
    const doc = readResult.value.content

    const llm = this.resolveLlm()
    const rewritten = await rewriteItems(
      doc,
      items.map((it) => ({ id: it.id, selection: it.selection, instruction: it.instruction })),
      llm,
    )
    const rewrittenById = new Map(rewritten.map((r) => [r.id, r.rewritten]))
    const edits: EditAt[] = items.map((it) => ({
      srcStart: it.srcStart,
      srcEnd: it.srcEnd,
      selection: it.selection,
      rewritten: rewrittenById.get(it.id) ?? '',
    }))

    const applied = applyRewrites(doc, edits)
    if (!applied.ok) throw new RewriteApplyConflictError(applied.error)

    await this.writeDoc(session.filePath, applied.value)
    session.dirty = true
    return { result: extract(applied.value), content: applied.value }
  }

  /**
   * Selection-op closed loop (P6): read the current doc → extract → pick the next
   * label + insertion offset for the op's target section → LLM drafts the item's
   * content → render + splice via applyRewrites (an insertion-shaped edit) → save
   * → re-extract. Reuses P4's applyRewrites; never re-implements the splice.
   *
   * Reads the current document itself so a stale source can't clobber concurrent
   * edits. Nothing is written unless the whole pipeline succeeds: a missing target
   * section or an LLM failure throws SelectionOpError, a splice guard rejection
   * throws RewriteApplyConflictError — in every failure the document is untouched.
   */
  async applySelectionOp(id: string, op: SelectionOp, quote: string): Promise<SelectionOpResult> {
    const session = this.getSession(id)
    this.touch(session)
    const readResult = await this.docSource.read(session.filePath)
    if (!readResult.ok) throw new Error(readResult.error.message)
    const doc = readResult.value.content
    const before = extract(doc)

    const kind = SELECTION_OP_KIND[op]
    const located = locateSectionInsertAt(before, kind)
    if (!located.ok) throw new SelectionOpError(located.error.message)
    const label = nextLabel(before, kind)

    const drafted = await runSelectionEditTask(
      op,
      { quote, extract: before, label },
      this.resolveLlm(),
    )
    if (!drafted.ok) {
      throw new SelectionOpError(
        `selection-op ${op} draft failed (${drafted.error.kind}): ${drafted.error.message}`,
      )
    }

    const fragment = renderSelectionFragment(drafted.value, label)
    const edit: EditAt = {
      srcStart: located.value,
      srcEnd: located.value,
      selection: '',
      rewritten: fragment,
    }
    const applied = applyRewrites(doc, [edit])
    if (!applied.ok) throw new RewriteApplyConflictError(applied.error)

    await this.writeDoc(session.filePath, applied.value)
    session.dirty = true
    return { newLabel: label, result: extract(applied.value), content: applied.value }
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
    const exported = await this.exportSink.export(session.outputPath, finalContent)
    if (!exported.ok) throw new Error(exported.error.message)
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

  /**
   * The LLM runner for this session — the injected fake in tests, otherwise a
   * per-call execa adapter built from the AI config. Throws when no config is
   * available. Public so the agent SSE route can resolve it lazily (only chat /
   * explain paths need it; zero-LLM commands never call this).
   */
  getLlmRunner(): LlmRunner {
    return this.resolveLlm()
  }

  private resolveLlm(): LlmRunner {
    if (this.llmRunner) return this.llmRunner
    const aiConfig = this.getAiConfig?.()
    if (!aiConfig) throw new Error('AI config unavailable')
    return createExecaRunner(aiConfig)
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

  /**
   * Human-clickable panel URL that reopens `filePath` on the shared server. The
   * retired React SPA owned `/s/:id`; the live entry point is `/next`, where
   * `?doc=<path>` overrides the server's default document (review-app.jsx bootstrap
   * feeds the value straight to POST /api/sessions/open). The absolute path — not
   * a basename — is encoded so the round-trip resolves the same session
   * regardless of the reader's cwd.
   */
  private docPanelUrl(filePath: string): string {
    return `${this.baseUrl()}/next/?doc=${encodeURIComponent(filePath)}`
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
