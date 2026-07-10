/**
 * Unit tests for server/routes/feedback.ts — POST /api/feedback.
 *
 * Uses a fake FeedbackSink (records submit() calls) and a real SessionManager
 * backed by a tmpdir, so sessionId-driven server-side enrichment exercises the
 * actual readFile/readAnnotations/readSignoffs paths.
 */
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { feedbackRoute } from '../../server/routes/feedback.js'
import { SessionManager } from '../../server/services/session-manager.js'
import type { AppContext } from '../../server/app.js'
import type { FeedbackAttachment, FeedbackEntry, FeedbackSink } from '../../types/ports.js'

interface RecordedSubmit {
  entry: Omit<FeedbackEntry, 'id' | 'ts' | 'attachmentsDir'>
  attachment: FeedbackAttachment | undefined
}

function makeFakeSink(): { sink: FeedbackSink; calls: RecordedSubmit[] } {
  const calls: RecordedSubmit[] = []
  const sink: FeedbackSink = {
    async submit(entry, attachment) {
      calls.push({ entry, attachment })
      return { ok: true, value: { id: 'fb-fixed-1' } }
    },
  }
  return { sink, calls }
}

async function setupApp(sink: FeedbackSink) {
  const dir = await mkdtemp(join(tmpdir(), 'scribepad-feedback-route-'))
  const xdg = await mkdtemp(join(tmpdir(), 'scribepad-feedback-route-xdg-'))
  const filePath = join(dir, 'plan.md')
  await writeFile(filePath, '# Plan\n\ngoal text', 'utf8')
  const manager = new SessionManager({ repoRoot: dir, env: { XDG_STATE_HOME: xdg } })
  const { sessionId } = await manager.openSession(filePath)

  const ctx = { sessionManager: manager, feedbackSink: sink } as unknown as AppContext
  const app = new Hono()
  app.route('/api', feedbackRoute(ctx))
  return { app, sessionId }
}

function postFeedback(app: Hono, body: unknown) {
  return app.request('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/feedback — validation', () => {
  it('rejects a missing text field with 400', async () => {
    const { sink } = makeFakeSink()
    const { app } = await setupApp(sink)
    const res = await postFeedback(app, { category: 'ux' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty/whitespace-only text field with 400', async () => {
    const { sink } = makeFakeSink()
    const { app } = await setupApp(sink)
    const res = await postFeedback(app, { text: '   ' })
    expect(res.status).toBe(400)
  })

  it('rejects a malformed (non-JSON) body with 400 instead of 500', async () => {
    const { sink } = makeFakeSink()
    const { app } = await setupApp(sink)
    const res = await app.request('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/feedback — without sessionId', () => {
  it('submits without enrichment and returns 201 + id', async () => {
    const { sink, calls } = makeFakeSink()
    const { app } = await setupApp(sink)
    const res = await postFeedback(app, { text: 'no session here', category: 'idea' })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'fb-fixed-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.entry.source).toBe('panel')
    expect(calls[0]!.entry.sessionId).toBeUndefined()
    expect(calls[0]!.attachment).toBeUndefined()
  })
})

describe('POST /api/feedback — with sessionId', () => {
  it('enriches with the session doc + review state via SessionManager', async () => {
    const { sink, calls } = makeFakeSink()
    const { app, sessionId } = await setupApp(sink)
    const res = await postFeedback(app, {
      text: 'goal extraction looks off',
      category: 'extract-bug',
      sessionId,
      viewport: '1280x800',
      activeSection: 'goals',
      consoleErrors: ['TypeError: boom'],
    })

    expect(res.status).toBe(201)
    expect(calls).toHaveLength(1)
    const { entry, attachment } = calls[0]!
    expect(entry.sessionId).toBe(sessionId)
    expect(entry.context).toEqual({
      viewport: '1280x800',
      activeSection: 'goals',
      consoleErrors: ['TypeError: boom'],
    })
    expect(attachment?.docSnapshot).toBe('# Plan\n\ngoal text')
    expect(attachment?.reviewState).toBe(JSON.stringify({ annotations: [], signoffs: [] }))
  })

  it('degrades gracefully (submits without doc/review-state attachment) for an unknown sessionId', async () => {
    const { sink, calls } = makeFakeSink()
    const { app } = await setupApp(sink)
    const res = await postFeedback(app, {
      text: 'reporting against a stale session',
      sessionId: 'sess-does-not-exist',
    })

    expect(res.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.attachment?.docSnapshot).toBeUndefined()
    expect(calls[0]!.attachment?.reviewState).toBeUndefined()
  })

  it('passes dom through as domSnapshot alongside session enrichment', async () => {
    const { sink, calls } = makeFakeSink()
    const { app, sessionId } = await setupApp(sink)
    await postFeedback(app, { text: 'dom capture', sessionId, dom: '<div>x</div>' })

    expect(calls[0]!.attachment?.domSnapshot).toBe('<div>x</div>')
  })
})

describe('POST /api/feedback — sink failure', () => {
  it('returns 500 when the sink returns Err', async () => {
    const failingSink: FeedbackSink = {
      async submit() {
        return { ok: false, error: { kind: 'write', message: 'disk full' } }
      },
    }
    const { app } = await setupApp(failingSink)
    const res = await postFeedback(app, { text: 'will fail' })
    expect(res.status).toBe(500)
  })
})
