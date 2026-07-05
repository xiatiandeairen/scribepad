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
  read(docId: string): Promise<Result<DocContent, DocError>>
  write?(docId: string, content: string): Promise<Result<void, DocError>>
}
