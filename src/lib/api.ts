/**
 * Thin typed fetch wrappers around `/api/*`.
 *
 * Relative paths only — Vite dev server proxies `/api` → backend; in prod the
 * Hono server serves both `/api/*` and the static client from one origin.
 *
 * Each call throws `Error(json.error || statusText)` on non-2xx. No retry,
 * no caching, no abort — keep minimal.
 */

import type { Annotation } from '../../types/annotation.js'
import type {
  AiConfig,
  AiConfigResponse,
  AiStatusResponse,
  AnnotationsResponse,
  ConnectSessionResponse,
  DoneSessionResponse,
  ErrorResponse,
  ExportSessionResponse,
  FileResponse,
  HeartbeatSessionRequest,
  PlanStateResponse,
  ReviewNormalizeResponse,
  RewriteRequest,
  RewriteResponse,
  SaveResponse,
  SessionResponse,
} from '../../types/api.js'
import type { PlanItemState } from '../../types/plan.js'

async function parseOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = JSON.parse(text) as ErrorResponse
      if (body && typeof body.error === 'string' && body.error) {
        message = body.error
      }
    } catch {
      // body wasn't JSON — fall back to statusText
    }
    throw new Error(message)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`API returned non-JSON response for ${res.url}`)
  }
}

function scoped(path: string, sessionId?: string): string {
  return sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}${path}` : `/api${path}`
}

export async function getFile(sessionId?: string): Promise<FileResponse> {
  const res = await fetch(scoped('/file', sessionId))
  return parseOrThrow<FileResponse>(res)
}

export async function saveDocument(content: string, sessionId?: string): Promise<SaveResponse> {
  const res = await fetch(scoped('/save', sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return parseOrThrow<SaveResponse>(res)
}

export async function getAnnotations(sessionId?: string): Promise<AnnotationsResponse> {
  const res = await fetch(scoped('/annotations', sessionId))
  return parseOrThrow<AnnotationsResponse>(res)
}

export async function saveAnnotations(
  annotations: Annotation[],
  sessionId?: string,
): Promise<{ ok: true }> {
  const res = await fetch(scoped('/annotations', sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  })
  return parseOrThrow<{ ok: true }>(res)
}

export async function getPlanState(sessionId?: string): Promise<PlanStateResponse> {
  const res = await fetch(scoped('/plan-state', sessionId))
  return parseOrThrow<PlanStateResponse>(res)
}

export async function savePlanState(
  planState: PlanItemState[],
  sessionId?: string,
): Promise<{ ok: true }> {
  const res = await fetch(scoped('/plan-state', sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planState }),
  })
  return parseOrThrow<{ ok: true }>(res)
}

export async function requestRewrite(
  req: RewriteRequest,
  sessionId?: string,
): Promise<RewriteResponse> {
  const res = await fetch(scoped('/rewrite', sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return parseOrThrow<RewriteResponse>(res)
}

export async function normalizeReviewDocument(
  fullDoc: string,
  sessionId?: string,
): Promise<ReviewNormalizeResponse> {
  const res = await fetch(scoped('/review-normalize', sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullDoc }),
  })
  return parseOrThrow<ReviewNormalizeResponse>(res)
}

export async function getAiConfig(): Promise<AiConfigResponse> {
  const res = await fetch('/api/ai/config')
  return parseOrThrow<AiConfigResponse>(res)
}

export async function saveAiConfig(config: AiConfig): Promise<AiConfigResponse> {
  const res = await fetch('/api/ai/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
  return parseOrThrow<AiConfigResponse>(res)
}

export async function getAiStatus(): Promise<AiStatusResponse> {
  const res = await fetch('/api/ai/status')
  return parseOrThrow<AiStatusResponse>(res)
}

export async function testAiConfig(): Promise<AiStatusResponse> {
  const res = await fetch('/api/ai/test', { method: 'POST' })
  return parseOrThrow<AiStatusResponse>(res)
}

export async function getSession(): Promise<SessionResponse> {
  const res = await fetch('/api/session')
  return parseOrThrow<SessionResponse>(res)
}

export async function heartbeatSession(): Promise<SessionResponse> {
  const res = await fetch('/api/session/heartbeat', { method: 'POST' })
  return parseOrThrow<SessionResponse>(res)
}

export async function exportSession(): Promise<ExportSessionResponse> {
  const res = await fetch('/api/session/export', { method: 'POST' })
  return parseOrThrow<ExportSessionResponse>(res)
}

export async function closeSession(exportAgentContext: boolean): Promise<{ ok: true }> {
  const res = await fetch('/api/session/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exportAgentContext }),
  })
  return parseOrThrow<{ ok: true }>(res)
}

export async function getDocumentSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
  return parseOrThrow<SessionResponse>(res)
}

export async function connectDocumentSession(sessionId: string): Promise<ConnectSessionResponse> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/connect`, {
    method: 'POST',
  })
  return parseOrThrow<ConnectSessionResponse>(res)
}

export async function heartbeatDocumentSession(
  sessionId: string,
  clientId: string,
): Promise<SessionResponse> {
  const req: HeartbeatSessionRequest = { clientId }
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return parseOrThrow<SessionResponse>(res)
}

export function disconnectDocumentSession(sessionId: string, clientId: string): void {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/disconnect`
  const body = JSON.stringify({ clientId })
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    return
  }
  void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
}

export async function doneDocumentSession(
  sessionId: string,
  content: string,
): Promise<DoneSessionResponse> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return parseOrThrow<DoneSessionResponse>(res)
}
