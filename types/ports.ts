/**
 * Driven ports — what the portable core needs from the outside world.
 *
 * The core depends only on these interfaces; concrete adapters (execa / sidecar /
 * fs) are injected at the composition root. This is what lets the core be imported
 * into the PM project without scribepad's HTTP server or React client — the two
 * evolution paths (standalone / integration) differ only in which adapters get
 * injected. See docs/architecture.md.
 */
import type { Result } from './result.js'
import type { Annotation } from './annotation.js'
import type { Signoff } from './domain.js'

// ── LlmRunner ──────────────────────────────────────────────────────────────

export interface LlmRunRequest {
  prompt: string
  timeoutMs?: number
}

export type LlmErrorKind = 'timeout' | 'spawn' | 'nonzero-exit' | 'empty-output'

export interface LlmError {
  kind: LlmErrorKind
  message: string
}

/**
 * Runs one agent task against an external LLM and returns raw text.
 *
 * The provider (which CLI / model) is baked into the adapter instance at
 * construction; callers pass only the prompt. Never throws for LLM failures —
 * returns `Err` on timeout / spawn failure / non-zero exit / empty output, so the
 * runner can decide whether to retry.
 */
export interface LlmRunner {
  run(req: LlmRunRequest): Promise<Result<string, LlmError>>
}

// ── ReviewStore ──────────────────────────────────────────────────────────────

/**
 * Persisted *user state* for one document. Extraction results are never stored
 * here (recomputed); only what the user decided. In standalone this maps to the
 * sidecar JSON; in integration it maps to the PM project's database.
 */
export interface ReviewState {
  annotations: Annotation[]
  signoffs: Signoff[]
}

export type StoreErrorKind = 'read' | 'write' | 'corrupt'

export interface StoreError {
  kind: StoreErrorKind
  message: string
}

export interface ReviewStore {
  load(docId: string): Promise<Result<ReviewState, StoreError>>
  save(docId: string, state: ReviewState): Promise<Result<void, StoreError>>
}

// ── DocSource ──────────────────────────────────────────────────────────────

export interface DocContent {
  docId: string
  content: string
}

export type DocErrorKind = 'not-found' | 'read' | 'write'

export interface DocError {
  kind: DocErrorKind
  message: string
}

/**
 * Provides document content. `write` is optional — present only when the source
 * is mutable (standalone fs), absent for a read-only integration source.
 */
export interface DocSource {
  exists(docId: string): Promise<boolean>
  read(docId: string): Promise<Result<DocContent, DocError>>
  write?(docId: string, content: string): Promise<Result<void, DocError>>
}

// ── ExportSink ──────────────────────────────────────────────────────────────

export type ExportErrorKind = 'write'

export interface ExportError {
  kind: ExportErrorKind
  message: string
}

/**
 * Emits the approved final document as a standalone export artifact at a
 * caller-computed `outputPath`.
 *
 * Deliberately distinct from `DocSource.write`, which mutates the *source*
 * document under review (its docId is the source path). An export is a *new*
 * derived product — the agent-context file — whose destination is independent of
 * whether the source is mutable: `done()` may export even when the source is a
 * read-only integration source. In standalone this writes under XDG state home;
 * an integration can route exports to its own store without opening up source
 * writes. Never throws — returns `Err` on write failure.
 */
export interface ExportSink {
  export(outputPath: string, content: string): Promise<Result<void, ExportError>>
}

// ── FeedbackSink ───────────────────────────────────────────────────────────

/**
 * One reviewer-reported problem, queued for later triage. Deliberately
 * self-contained: everything needed to understand and reproduce the report
 * lives on the entry (or its attachments) so triage never has to go back and
 * ask the reporter "what were you looking at?" — panel/CLI sources capture
 * whatever context is available at submit time, and `category` is a free-form
 * string (no enum) so callers aren't blocked from reporting by an unlisted
 * kind of feedback.
 */
export interface FeedbackEntry {
  id: string
  ts: string
  source: 'panel' | 'cli'
  category?: string
  text: string
  docId?: string
  sessionId?: string
  /** Panel-only metadata passed through verbatim; the sink never interprets it. */
  context?: {
    scribepadCommit?: string
    viewport?: string
    activeSection?: string
    consoleErrors?: string[]
  }
  /** Present only when `submit` was given a non-empty attachment. */
  attachmentsDir?: string
}

/**
 * Point-in-time copies of session state, taken by the caller (typically the
 * server, via SessionManager) at submit time so a later triage pass sees
 * exactly what the reporter saw — not whatever the session has drifted to
 * since. Every field is optional; the sink persists only what it's given.
 */
export interface FeedbackAttachment {
  /** Full document content at submit time. */
  docSnapshot?: string
  /** Serialized annotations + signoffs at submit time. */
  reviewState?: string
  /** DOM subtree snapshot supplied by a UI-sourced report. */
  domSnapshot?: string
  /** Extract output in effect at submit time. */
  extractSnapshot?: string
}

export type FeedbackErrorKind = 'write'

export interface FeedbackError {
  kind: FeedbackErrorKind
  message: string
}

/**
 * Appends one feedback report to the central inbox and, when `attachment`
 * carries any non-empty field, persists a same-`id` attachments bundle
 * alongside it. `entry` excludes `id` / `ts` / `attachmentsDir` — the sink
 * assigns those so every caller (HTTP route, CLI) gets identical id/timestamp
 * semantics instead of reimplementing them. Never throws — returns `Err` on
 * write failure.
 */
export interface FeedbackSink {
  submit(
    entry: Omit<FeedbackEntry, 'id' | 'ts' | 'attachmentsDir'>,
    attachment?: FeedbackAttachment,
  ): Promise<Result<{ id: string }, FeedbackError>>
}
