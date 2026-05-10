/**
 * HTTP API contract — shared shapes between client and server.
 * Single source of truth: change a request/response shape here, both ends update.
 */

import type { Annotation } from './annotation.js'
import type { PlanItemState } from './plan.js'

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
