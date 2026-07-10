/**
 * Unit tests for server/adapters/feedback-sink-fs.ts (the standalone FeedbackSink).
 *
 * All tests inject a temporary XDG_STATE_HOME so they never touch the real XDG
 * state directory.
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createFsFeedbackSink } from '../../server/adapters/feedback-sink-fs.js'
import type { FeedbackEntry } from '../../types/ports.js'

async function tempEnv(): Promise<NodeJS.ProcessEnv> {
  const xdg = await mkdtemp(join(tmpdir(), 'scribepad-feedback-'))
  return { XDG_STATE_HOME: xdg }
}

function inboxPath(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_STATE_HOME!, 'scribepad', 'feedback', 'inbox.jsonl')
}

async function readInboxLines(env: NodeJS.ProcessEnv): Promise<FeedbackEntry[]> {
  const raw = await readFile(inboxPath(env), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FeedbackEntry)
}

describe('createFsFeedbackSink — minimal entry (CLI-style)', () => {
  it('appends one inbox line with a generated id + ts and no attachmentsDir', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const result = await sink.submit({ source: 'cli', text: 'export button does nothing' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const lines = await readInboxLines(env)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.id).toBe(result.value.id)
    expect(lines[0]!.source).toBe('cli')
    expect(lines[0]!.text).toBe('export button does nothing')
    expect(typeof lines[0]!.ts).toBe('string')
    expect(new Date(lines[0]!.ts).toString()).not.toBe('Invalid Date')
    expect(lines[0]!.attachmentsDir).toBeUndefined()
  })
})

describe('createFsFeedbackSink — append semantics', () => {
  it('appends multiple entries without clobbering earlier ones', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    await sink.submit({ source: 'cli', text: 'first' })
    await sink.submit({ source: 'panel', text: 'second', category: 'ux' })

    const lines = await readInboxLines(env)
    expect(lines.map((l) => l.text)).toEqual(['first', 'second'])
    expect(lines[1]!.category).toBe('ux')
  })
})

describe('createFsFeedbackSink — passthrough fields', () => {
  it('stores docId/sessionId/context verbatim without interpreting them', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const context = {
      scribepadCommit: 'abc123',
      viewport: '1280x800',
      activeSection: 'goals',
      consoleErrors: ['TypeError: x is not a function'],
    }
    await sink.submit({
      source: 'panel',
      text: 'extraction missed a goal',
      category: 'extract-bug',
      docId: 'doc-1',
      sessionId: 'sess-1',
      context,
    })

    const lines = await readInboxLines(env)
    expect(lines[0]!.docId).toBe('doc-1')
    expect(lines[0]!.sessionId).toBe('sess-1')
    expect(lines[0]!.context).toEqual(context)
  })
})

describe('createFsFeedbackSink — attachments', () => {
  it('writes only the attachment fields provided, under attachments/<id>/', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const result = await sink.submit(
      { source: 'panel', text: 'doc looks wrong' },
      { docSnapshot: '# Doc\n\ncontent', reviewState: '{"annotations":[],"signoffs":[]}' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dir = join(env.XDG_STATE_HOME!, 'scribepad', 'feedback', 'attachments', result.value.id)
    expect(existsSync(join(dir, 'doc.md'))).toBe(true)
    expect(existsSync(join(dir, 'review-state.json'))).toBe(true)
    expect(existsSync(join(dir, 'dom.html'))).toBe(false)
    expect(existsSync(join(dir, 'extract.json'))).toBe(false)

    expect(await readFile(join(dir, 'doc.md'), 'utf8')).toBe('# Doc\n\ncontent')
    expect(await readFile(join(dir, 'review-state.json'), 'utf8')).toBe(
      '{"annotations":[],"signoffs":[]}',
    )

    const lines = await readInboxLines(env)
    expect(lines[0]!.attachmentsDir).toBe(dir)
  })

  it('writes dom.html when domSnapshot is provided', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const result = await sink.submit(
      { source: 'panel', text: 'dom looks wrong' },
      { domSnapshot: '<div>x</div>' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dir = join(env.XDG_STATE_HOME!, 'scribepad', 'feedback', 'attachments', result.value.id)
    expect(await readFile(join(dir, 'dom.html'), 'utf8')).toBe('<div>x</div>')
  })

  it('does not create an attachments directory when attachment is omitted', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const result = await sink.submit({ source: 'cli', text: 'no attachments' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dir = join(env.XDG_STATE_HOME!, 'scribepad', 'feedback', 'attachments', result.value.id)
    expect(existsSync(dir)).toBe(false)
  })

  it('leaves no inbox line when the attachment write fails partway', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })
    const feedbackDir = join(env.XDG_STATE_HOME!, 'scribepad', 'feedback')
    await mkdir(feedbackDir, { recursive: true })
    // Block the attachments subdirectory from ever being creatable, forcing
    // writeAttachments to fail regardless of the (randomly generated) id.
    await writeFile(join(feedbackDir, 'attachments'), 'not a directory', 'utf8')

    const result = await sink.submit(
      { source: 'panel', text: 'attachment write should fail' },
      { docSnapshot: '# doc' },
    )
    expect(result.ok).toBe(false)

    // The whole submission failed — there must be no orphan inbox line
    // pointing at an attachments bundle that never got written.
    expect(existsSync(inboxPath(env))).toBe(false)
  })

  it('does not create an attachments directory when attachment fields are all empty/undefined', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const result = await sink.submit({ source: 'cli', text: 'empty attachment object' }, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const dir = join(env.XDG_STATE_HOME!, 'scribepad', 'feedback', 'attachments', result.value.id)
    expect(existsSync(dir)).toBe(false)

    const lines = await readInboxLines(env)
    expect(lines[0]!.attachmentsDir).toBeUndefined()
  })
})

describe('createFsFeedbackSink — id uniqueness', () => {
  it('generates distinct ids for concurrent submits', async () => {
    const env = await tempEnv()
    const sink = createFsFeedbackSink({ env })

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sink.submit({ source: 'cli', text: `entry ${i}` })),
    )
    const ids = results.map((r) => (r.ok ? r.value.id : ''))
    expect(new Set(ids).size).toBe(5)
  })
})
