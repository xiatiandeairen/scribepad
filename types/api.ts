/**
 * HTTP API contract — shared shapes between client and server.
 * Single source of truth: change a request/response shape here, both ends update.
 */

import type { Annotation } from './annotation.js'

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

// Generic error
export interface ErrorResponse {
  error: string
}
