/**
 * HTTP API contract — shared shapes between client and server.
 * Single source of truth: change a request/response shape here, both ends update.
 */

import type { Annotation } from './annotation.js'
import type { PlanItemState } from './plan.js'
import type { ExtractResult, Signoff } from './domain.js'

// GET /api/file
export interface FileResponse {
  path: string
  content: string
}

// POST /api/save
export interface SaveRequest {
  content: string
}

export interface SaveResponse {
  ok: true
}

// GET /api/annotations
export interface AnnotationsResponse {
  annotations: Annotation[]
}

// POST /api/annotations
export interface AnnotationsRequest {
  annotations: Annotation[]
}

// GET /api/plan-state
export interface PlanStateResponse {
  planState: PlanItemState[]
}

// POST /api/plan-state
export interface PlanStateRequest {
  planState: PlanItemState[]
}

// GET /api/extract — recomputed each call, never persisted.
export interface ExtractResponse {
  result: ExtractResult
}

// GET /api/sessions/:sessionId/signoffs
export interface SignoffsResponse {
  signoffs: Signoff[]
}

// POST /api/sessions/:sessionId/signoffs
export interface SignoffsRequest {
  signoffs: Signoff[]
}

// POST /api/rewrite
export interface RewriteItem {
  id: string
  selection: string
  instruction: string
}

export interface RewriteRequest {
  fullDoc: string
  items: RewriteItem[]
}

export interface RewriteResultEntry {
  id: string
  rewritten: string
}

export interface RewriteResponse {
  results: RewriteResultEntry[]
}

// POST /api/sessions/:sessionId/rewrite-apply — rewrite + splice + save + re-extract.
// No fullDoc: the server reads the current document so the frontend can't push a
// stale full source. `selection` is both the LLM input and the drift-guard expectation.
export interface RewriteApplyItem {
  id: string
  srcStart: number
  srcEnd: number
  selection: string
  instruction: string
}

export interface RewriteApplyRequest {
  items: RewriteApplyItem[]
}

export interface RewriteApplyResponse {
  result: ExtractResult
  content: string
}

// POST /api/review-normalize
export interface ReviewNormalizeRequest {
  fullDoc: string
}

export interface ReviewNormalizeResponse {
  content: string
}

export type AiProvider = 'codex-cli' | 'claude-code-cli'
export type AiState = 'unknown' | 'untested' | 'testing' | 'ready' | 'error' | 'running'

export interface AiConfig {
  provider: AiProvider
  timeoutMs: number
  codex: {
    command: string
    model: string
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh'
    sandbox: 'read-only'
  }
  claude: {
    command: string
    args: string[]
  }
}

export interface AiConfigResponse {
  config: AiConfig
  source?: 'config' | 'default'
  error?: string
}

export interface AiConfigRequest {
  config: AiConfig
}

export interface AiStatusResponse {
  provider: AiProvider
  label: string
  state: AiState
  available: boolean
  reason?: string
  lastCheckedAt?: string
}

// GET /api/session
export interface SessionResponse {
  id: string
  filePath: string
  fileName: string
  startedAt: string
  lastHeartbeatAt: string
  dirty: boolean
  exportedAt?: string
  agentContextPath?: string
}

// POST /api/session/close
export interface CloseSessionRequest {
  exportAgentContext: boolean
}

// POST /api/session/export
export interface ExportSessionResponse {
  agentContextPath: string
  exportedAt: string
}

export interface OpenSessionRequest {
  filePath: string
}

export interface OpenSessionResponse {
  sessionId: string
  url: string
}

export interface ConnectSessionResponse {
  clientId: string
  session: SessionResponse
}

export interface HeartbeatSessionRequest {
  clientId: string
}

export interface DisconnectSessionRequest {
  clientId: string
}

export interface DoneSessionResponse {
  ok: true
  outputPath: string
}

// Generic error
export interface ErrorResponse {
  error: string
}
