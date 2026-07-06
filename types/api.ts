/**
 * HTTP API contract — shared shapes between client and server.
 * Single source of truth: change a request/response shape here, both ends update.
 */

import type { Annotation } from './annotation.js'
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

// GET /api/sessions/:sessionId/extract — recomputed each call, never persisted.
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

export interface OpenSessionRequest {
  filePath: string
}

export interface OpenSessionResponse {
  sessionId: string
  // Human-clickable `/next/?doc=<path>` panel URL; opens this document on the
  // shared server. (The retired SPA's `/s/:id` route is gone.) Machine callers
  // use `sessionId`; the CLI reuse branch prints `url`.
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

// POST /api/sessions/:sessionId/agent — the single AI channel (SSE response).
//
// All AI behaviour flows through one endpoint: the client posts an AgentRequest
// and reads back a stream of AgentEvent (progress* → final). The four request
// shapes mirror the frontend's agent.send() sources; the server dispatches on
// `type` (+ `op` / `id`). command / selection-op:explain are wired in P5;
// selection-op dcard|risk|open are real, persisted document edits in P6 (final
// carries `mutated: true`); analyze-notes stays a v2 not-implemented `final`.

/** One note fed to analyze-notes. Loose by design — the feature is a v2 placeholder. */
export interface AgentNote {
  pt?: string
  text?: string
}

export type AgentRequest =
  | { type: 'chat'; text: string; quote?: string }
  | { type: 'selection-op'; op: 'dcard' | 'risk' | 'open' | 'explain'; quote: string }
  | { type: 'analyze-notes'; notes: AgentNote[] }
  | { type: 'command'; id: 'ai-review' | 'ai-refs' }

/**
 * One action card in a final agent reply. `pt` (when present) is a real label
 * the frontend can click to jump to a tab; `sec` jumps to a section. The server
 * must never emit a `pt` that does not resolve to a defined label.
 */
export interface AgentAction {
  icon: string
  kind: string
  title: string
  sub: string
  pt?: string
  sec?: string
}

/**
 * One server-sent event on the agent stream. `progress` is a coarse, honest
 * phase label (assembling context / calling / …), emitted zero or more times;
 * `final` is the single terminal reply and closes the stream. `mutated` is set
 * (true, additive) only when the reply changed the document on disk — a P6
 * selection-op edit — so the frontend knows to refetch the extraction.
 */
export type AgentEvent =
  | { type: 'progress'; label: string }
  | { type: 'final'; paragraphs: string[]; actions: AgentAction[]; mutated?: true }

// Generic error
export interface ErrorResponse {
  error: string
}
