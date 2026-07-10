/**
 * P7 slice 2 — new frontend (client-next/) AI + write-path + persistence wiring.
 *
 * The runtime paths (createRealAgent's live SSE, rewrite-apply / annotations /
 * signoffs round-trips) need a browser + server and are covered by the backend
 * contract tests. What is unit-testable here is the pure derivation the frontend
 * layers those channels on. As in slice 1, we evaluate the *shipped* client-next
 * source with a stand-in window and assert against the exact code the browser
 * ships (no build step):
 *
 *  1. parseSseChunk        — SSE byte buffer → AgentEvent[] (cross-chunk half-frame safe)
 *  2. applyAgentEvent      — AgentEvent → onThinking / onReply / onMutated mapping
 *  3. computeSrcRange      — selection + anchor → markdown src range (+ whole-point degrade)
 *  4. note ⇄ annotation    — frontend card ⇄ backend Annotation round-trip
 *  5. buildNoteHighlights  — notes → AnnoText highlight table (structured anchor)
 *  6. toggleSignoff        — label toggle over Signoff[]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

type AgentEvent =
  | { type: 'progress'; label: string }
  | { type: 'final'; paragraphs: string[]; actions: unknown[]; mutated?: true }
type SseParse = { events: AgentEvent[]; rest: string }
type ReplyCb = { onThinking: (l: string | null) => void; onReply: (m: unknown) => void }
type Anchor = { srcStart: number; srcEnd: number; text: string }
type SrcRange = { srcStart: number; srcEnd: number; selection: string }
type Note = {
  id: string
  pt: string | null
  quote: string
  body: string
  status: string
  anchor: Anchor
  kind?: string
  draft?: boolean
  createdAt?: string
}

type Net = {
  parseSseChunk: (buffer: string) => SseParse
  applyAgentEvent: (ev: unknown, cb: ReplyCb, onMutated?: () => void) => void
  computeSrcRange: (selection: string, anchor: Anchor) => SrcRange
  noteToAnnotation: (note: Note) => Record<string, unknown>
  annotationToNote: (a: Record<string, unknown>) => Note
  buildNoteHighlights: (notes: Note[]) => Record<string, { id: string; anchorText: string }>
  toggleSignoff: (
    signoffs: Array<{ pointId: string; label: string; signedAt: string }>,
    label: string,
  ) => Array<{ pointId: string; label: string; signedAt: string }>
}

// Evaluate the shipped client-next sources with a stand-in window; harvest exports.
function loadNet(): Net {
  const win: Record<string, unknown> = {}
  for (const file of ['client-next/agent-service.jsx', 'client-next/review-net.jsx']) {
    const code = readFileSync(`${repoRoot}/${file}`, 'utf8')
    new Function('window', code)(win)
  }
  return win as unknown as Net
}

const net = loadNet()
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

describe('parseSseChunk: SSE frame parsing', () => {
  it('parses one complete data frame', () => {
    const { events, rest } = net.parseSseChunk(frame({ type: 'progress', label: '思考中' }))
    expect(events).toEqual([{ type: 'progress', label: '思考中' }])
    expect(rest).toBe('')
  })

  it('parses multiple frames in one buffer in order', () => {
    const buf = frame({ type: 'progress', label: 'a' }) + frame({ type: 'progress', label: 'b' })
    const { events, rest } = net.parseSseChunk(buf)
    expect(events.map((e) => (e.type === 'progress' ? e.label : ''))).toEqual(['a', 'b'])
    expect(rest).toBe('')
  })

  it('holds an unterminated half-frame in rest, then stitches it across chunks', () => {
    const full = frame({ type: 'final', paragraphs: ['done'], actions: [], mutated: true })
    const cut = Math.floor(full.length / 2)
    const first = net.parseSseChunk(full.slice(0, cut))
    expect(first.events).toEqual([])
    const second = net.parseSseChunk(first.rest + full.slice(cut))
    expect(second.events).toEqual([
      { type: 'final', paragraphs: ['done'], actions: [], mutated: true },
    ])
    expect(second.rest).toBe('')
  })

  it('skips non-JSON frames (e.g. an event:error text frame)', () => {
    const buf = 'event: error\ndata: boom\n\n' + frame({ type: 'progress', label: 'ok' })
    const { events } = net.parseSseChunk(buf)
    expect(events).toEqual([{ type: 'progress', label: 'ok' }])
  })
})

describe('applyAgentEvent: event → callback mapping', () => {
  it('routes progress to onThinking(label) only', () => {
    const cb = { onThinking: vi.fn(), onReply: vi.fn() }
    net.applyAgentEvent({ type: 'progress', label: '核对依据链' }, cb)
    expect(cb.onThinking).toHaveBeenCalledWith('核对依据链')
    expect(cb.onReply).not.toHaveBeenCalled()
  })

  it('routes final to onThinking(null) + onReply({body,acts})', () => {
    const cb = { onThinking: vi.fn(), onReply: vi.fn() }
    const acts = [{ icon: 'edit', kind: 'edit', title: 't', sub: 's' }]
    net.applyAgentEvent({ type: 'final', paragraphs: ['p1', 'p2'], actions: acts }, cb)
    expect(cb.onThinking).toHaveBeenCalledWith(null)
    expect(cb.onReply).toHaveBeenCalledWith({ body: ['p1', 'p2'], acts })
  })

  it('fires onMutated only when final carries mutated', () => {
    const cb = { onThinking: vi.fn(), onReply: vi.fn() }
    const onMutated = vi.fn()
    net.applyAgentEvent({ type: 'final', paragraphs: [], actions: [] }, cb, onMutated)
    expect(onMutated).not.toHaveBeenCalled()
    net.applyAgentEvent(
      { type: 'final', paragraphs: [], actions: [], mutated: true },
      cb,
      onMutated,
    )
    expect(onMutated).toHaveBeenCalledTimes(1)
  })
})

describe('computeSrcRange: selection + anchor → markdown src range', () => {
  const anchor: Anchor = { srcStart: 100, srcEnd: 111, text: 'hello world' }

  it('maps a substring selection to a precise offset range', () => {
    expect(net.computeSrcRange('world', anchor)).toEqual({
      srcStart: 106,
      srcEnd: 111,
      selection: 'world',
    })
  })

  it('trims the selection and keeps selection === source slice', () => {
    const r = net.computeSrcRange('  hello  ', anchor)
    expect(r).toEqual({ srcStart: 100, srcEnd: 105, selection: 'hello' })
    expect(anchor.text.slice(r.srcStart - anchor.srcStart, r.srcEnd - anchor.srcStart)).toBe(
      r.selection,
    )
  })

  it('degrades to the whole point range when the selection is not a substring', () => {
    expect(net.computeSrcRange('missing', anchor)).toEqual({
      srcStart: 100,
      srcEnd: 111,
      selection: 'hello world',
    })
  })

  it('degrades on empty selection', () => {
    expect(net.computeSrcRange('   ', anchor)).toEqual({
      srcStart: 100,
      srcEnd: 111,
      selection: 'hello world',
    })
  })
})

describe('note ⇄ annotation round-trip', () => {
  it('preserves pt / body / status / anchor through both directions', () => {
    const note: Note = {
      id: 'n1',
      pt: 'D3',
      kind: 'decision',
      quote: '砍掉整条线',
      body: '留一条日志埋点',
      status: 'open',
      anchor: { srcStart: 42, srcEnd: 48, text: '砍掉整条线' },
      draft: false,
      createdAt: '2026-07-04T00:00:00.000Z',
    }
    const ann = net.noteToAnnotation(note) as {
      target: { type: string; planItemId: string; kind: string }
      status: string
      anchor: Anchor
    }
    expect(ann.target).toMatchObject({ type: 'plan-item', planItemId: 'D3', kind: 'decision' })
    expect(ann.status).toBe('open')
    expect(ann.anchor).toEqual(note.anchor)

    const back = net.annotationToNote(ann as unknown as Record<string, unknown>)
    expect(back.pt).toBe('D3')
    expect(back.body).toBe('留一条日志埋点')
    expect(back.status).toBe('open')
    expect(back.anchor).toEqual(note.anchor)
  })

  it('maps a resolved note to a dismissed annotation and a selection target', () => {
    const note: Note = {
      id: 'n2',
      pt: null,
      quote: 'q',
      body: '',
      status: 'done',
      anchor: { srcStart: 0, srcEnd: 1, text: 'x' },
    }
    const ann = net.noteToAnnotation(note) as { status: string; target: { type: string } }
    expect(ann.status).toBe('dismissed')
    expect(ann.target).toEqual({ type: 'selection' })
    expect(net.annotationToNote(ann as unknown as Record<string, unknown>).status).toBe('done')
  })
})

describe('buildNoteHighlights: notes → AnnoText highlight table', () => {
  it('keys open notes by pt with the anchor text, and drops resolved ones', () => {
    const notes: Note[] = [
      {
        id: 'n1',
        pt: 'D3',
        quote: 'q1',
        body: '',
        status: 'open',
        anchor: { srcStart: 0, srcEnd: 2, text: 'aa' },
      },
      {
        id: 'n2',
        pt: 'R2',
        quote: 'q2',
        body: '',
        status: 'done',
        anchor: { srcStart: 0, srcEnd: 2, text: 'bb' },
      },
    ]
    expect(net.buildNoteHighlights(notes)).toEqual({ D3: { id: 'n1', anchorText: 'aa' } })
  })
})

describe('toggleSignoff: label toggle over Signoff[]', () => {
  it('adds a signoff when absent and removes it when present', () => {
    const added = net.toggleSignoff([], 'P1')
    expect(added.map((s) => s.label)).toEqual(['P1'])
    expect(added[0]).toMatchObject({ pointId: 'P1', label: 'P1' })
    expect(typeof added[0].signedAt).toBe('string')
    expect(net.toggleSignoff(added, 'P1')).toEqual([])
  })
})
