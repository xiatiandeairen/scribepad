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
  AnnotationsResponse,
  ErrorResponse,
  FileResponse,
  RewriteRequest,
  RewriteResponse,
  SaveResponse,
} from '../../types/api.js'

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = (await res.json()) as ErrorResponse
      if (body && typeof body.error === 'string' && body.error) {
        message = body.error
      }
    } catch {
      // body wasn't JSON — fall back to statusText
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export async function getFile(): Promise<FileResponse> {
  const res = await fetch('/api/file')
  return parseOrThrow<FileResponse>(res)
}

export async function saveDocument(content: string): Promise<SaveResponse> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return parseOrThrow<SaveResponse>(res)
}

export async function getAnnotations(): Promise<AnnotationsResponse> {
  const res = await fetch('/api/annotations')
  return parseOrThrow<AnnotationsResponse>(res)
}

export async function saveAnnotations(annotations: Annotation[]): Promise<{ ok: true }> {
  const res = await fetch('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  })
  return parseOrThrow<{ ok: true }>(res)
}

export async function requestRewrite(req: RewriteRequest): Promise<RewriteResponse> {
  const res = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return parseOrThrow<RewriteResponse>(res)
}
