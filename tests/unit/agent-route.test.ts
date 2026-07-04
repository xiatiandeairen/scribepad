import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { sessionsRoute } from '../../server/routes/sessions.js'
import { SessionManager } from '../../server/services/session-manager.js'
import type { AppContext } from '../../server/app.js'
import type { AgentEvent, AgentRequest } from '../../types/api.js'
import type { LlmRunner } from '../../types/ports.js'

const DANGLING_DOC = [
  '# Plan',
  '',
  '## 目标',
  '- **G1** 基础目标，可判定：X。',
  '- **G2** 依赖 G9 的扩展目标，可判定：Y。',
  '',
  '## 做法',
  '1. 依据 G1 完成迁移。',
  '',
  '## 验收',
  '- [ ] 依据 G1 验收。',
].join('\n')

/** Parse an SSE response body into the AgentEvent list it carried. */
function parseSseEvents(body: string): AgentEvent[] {
  return body
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join(''),
    )
    .filter((data) => data.length > 0)
    .map((data) => JSON.parse(data) as AgentEvent)
}

async function setup(doc: string, llm: LlmRunner) {
  const dir = await mkdtemp(join(tmpdir(), 'scribepad-agent-route-'))
  const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
  const filePath = join(dir, 'plan.md')
  await writeFile(filePath, doc, 'utf8')
  const manager = new SessionManager({
    repoRoot: dir,
    env: { XDG_STATE_HOME: xdg },
    llmRunner: llm,
  })
  const { sessionId } = manager.openSession(filePath)

  const ctx = { sessionManager: manager } as unknown as AppContext
  const app = new Hono()
  app.route('/api', sessionsRoute(ctx))
  return { app, sessionId }
}

async function postAgent(app: Hono, sessionId: string, request: AgentRequest) {
  return app.request(`/api/sessions/${sessionId}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
}

const throwingLlm: LlmRunner = {
  async run() {
    throw new Error('command path must not call the LLM')
  },
}

const okLlm: LlmRunner = {
  async run() {
    return { ok: true, value: JSON.stringify({ paragraphs: ['答复。'], actions: [] }) }
  },
}

describe('POST /sessions/:id/agent (SSE)', () => {
  it('streams progress* → final for a command and never calls the LLM', async () => {
    const { app, sessionId } = await setup(DANGLING_DOC, throwingLlm)
    const res = await postAgent(app, sessionId, { type: 'command', id: 'ai-refs' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const events = parseSseEvents(await res.text())
    // Sequence: at least one progress, exactly one terminal final.
    expect(events.filter((e) => e.type === 'progress').length).toBeGreaterThanOrEqual(1)
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1)
    expect(events.at(-1)!.type).toBe('final')

    const final = events.at(-1)!
    if (final.type === 'final') {
      expect(final.actions[0]!.pt).toBe('G2') // dangling-ref jump target
    }
  })

  it('streams a chat reply built from the LLM', async () => {
    const { app, sessionId } = await setup(DANGLING_DOC, okLlm)
    const res = await postAgent(app, sessionId, { type: 'chat', text: '你好' })
    const events = parseSseEvents(await res.text())
    expect(events.at(-1)).toEqual({ type: 'final', paragraphs: ['答复。'], actions: [] })
  })

  it('returns 404 for an unknown session (before opening the stream)', async () => {
    const { app } = await setup(DANGLING_DOC, throwingLlm)
    const res = await postAgent(app, 'sess-nonexistent', { type: 'command', id: 'ai-refs' })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('selection-op risk mutates the document and streams a mutated final with pt', async () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
    const source = readFileSync(join(repoRoot, 'tests/fixtures/plan-auth-soc2.md'), 'utf8')
    const riskLlm: LlmRunner = {
      async run() {
        return {
          ok: true,
          value: JSON.stringify({ risk: '缓存击穿', impact: '延迟升高', mitigation: '单飞兜底' }),
        }
      },
    }
    const { app, sessionId } = await setup(source, riskLlm)
    const res = await postAgent(app, sessionId, {
      type: 'selection-op',
      op: 'risk',
      quote: '缓存风险',
    })
    const events = parseSseEvents(await res.text())
    const final = events.at(-1)!
    expect(final.type).toBe('final')
    if (final.type === 'final') {
      expect(final.mutated).toBe(true)
      expect(final.actions[0]!.pt).toBe('R6')
    }
  })
})
