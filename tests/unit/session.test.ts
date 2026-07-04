import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  outputPathFor,
  RewriteApplyConflictError,
  SelectionOpError,
  SessionManager,
} from '../../server/services/session-manager'
import { docIdFor, documentStatePath, repoIdFor } from '../../server/paths'
import { extract } from '../../core/extract/index.js'
import type { Signoff } from '../../types/domain.js'
import type { LlmRunner } from '../../types/ports.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
function readFixture(name: string): string {
  return readFileSync(join(repoRoot, name), 'utf8')
}

function makeSignoff(pointId: string): Signoff {
  return { pointId, label: pointId.toUpperCase(), signedAt: '2026-01-01T00:00:00.000Z' }
}

describe('outputPathFor', () => {
  it('writes exports under XDG state for the repo and document', async () => {
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const path = outputPathFor('/repo', '/repo/docs/plan.md', { XDG_STATE_HOME: xdg })
    expect(path).toBe(
      join(
        xdg,
        'scribepad',
        repoIdFor('/repo'),
        'exports',
        docIdFor('/repo', '/repo/docs/plan.md'),
        'latest.agent.md',
      ),
    )
  })
})

describe('SessionManager', () => {
  it('opens different files as different sessions on one server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const a = join(dir, 'a.md')
    const b = join(dir, 'b.md')
    await writeFile(a, '# A\n', 'utf8')
    await writeFile(b, '# B\n', 'utf8')

    const manager = new SessionManager({ repoRoot: dir, baseUrl: () => 'http://127.0.0.1:3000' })
    const first = manager.openSession(a)
    const second = manager.openSession(b)

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.url).toContain('/s/')
    expect(second.url).toContain('/s/')
    await expect(manager.readFile(first.sessionId)).resolves.toMatchObject({ content: '# A\n' })
    await expect(manager.readFile(second.sessionId)).resolves.toMatchObject({ content: '# B\n' })
  })

  it('reuses an active session for the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')

    const manager = new SessionManager({ repoRoot: dir, baseUrl: () => 'http://127.0.0.1:3000' })
    const first = manager.openSession(filePath)
    const second = manager.openSession(filePath)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.url).toBe(first.url)
  })

  it('tracks clients per document session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')

    const manager = new SessionManager({ repoRoot: dir })
    const opened = manager.openSession(filePath)
    const connected = manager.connect(opened.sessionId)
    manager.heartbeat(opened.sessionId, connected.clientId)
    manager.disconnect(opened.sessionId, connected.clientId)

    expect(manager.getSession(opened.sessionId).clients.size).toBe(0)
  })

  it('keeps server alive while any session is active', async () => {
    let now = new Date('2026-05-05T12:00:00.000Z')
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')
    const manager = new SessionManager({ repoRoot: dir, now: () => now })
    manager.openSession(filePath)

    now = new Date('2026-05-05T12:10:00.000Z')
    expect(manager.shouldShutdown({ initialIdleMs: 60_000, activeIdleMs: 60_000 })).toBe(false)
  })

  it('done writes final markdown content to .agent.md and closes only that session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-session-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    const statePath = documentStatePath(dir, filePath, { XDG_STATE_HOME: xdg })
    await writeFile(filePath, '# Plan\n\nFinal content.\n', 'utf8')
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(
      statePath,
      JSON.stringify({
        version: 4,
        annotations: [],
      }),
      'utf8',
    )

    const manager = new SessionManager({
      repoRoot: dir,
      env: { XDG_STATE_HOME: xdg },
      now: () => new Date('2026-05-05T12:00:00.000Z'),
    })
    const opened = manager.openSession(filePath)
    const done = await manager.done(opened.sessionId)

    expect(done.outputPath).toBe(outputPathFor(dir, filePath, { XDG_STATE_HOME: xdg }))
    await expect(readFile(done.outputPath, 'utf8')).resolves.toBe('# Plan\n\nFinal content.\n')
    expect(() => manager.getSession(opened.sessionId)).toThrow(/Session not found/)
  })

  it('waitForDone resolves when the session is done', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-wait-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n\nReviewed.\n', 'utf8')

    const manager = new SessionManager({
      repoRoot: dir,
      env: { XDG_STATE_HOME: xdg },
      now: () => new Date('2026-05-05T12:00:00.000Z'),
    })
    const opened = manager.openSession(filePath)
    const waiting = manager.waitForDone(opened.sessionId)
    const done = await manager.done(opened.sessionId)

    await expect(waiting).resolves.toEqual(done)
  })

  it('waitForDone returns immediately for an already done session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-wait-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n\nReviewed.\n', 'utf8')

    const manager = new SessionManager({
      repoRoot: dir,
      env: { XDG_STATE_HOME: xdg },
      now: () => new Date('2026-05-05T12:00:00.000Z'),
    })
    const opened = manager.openSession(filePath)
    const done = await manager.done(opened.sessionId)

    await expect(manager.waitForDone(opened.sessionId)).resolves.toEqual(done)
  })

  it('uses active idle timeout after all active sessions are done', async () => {
    let now = new Date('2026-05-05T12:00:00.000Z')
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')
    const manager = new SessionManager({ repoRoot: dir, now: () => now })
    const opened = manager.openSession(filePath)
    await manager.done(opened.sessionId)

    now = new Date('2026-05-05T12:02:59.000Z')
    expect(manager.shouldShutdown({ initialIdleMs: 10 * 60_000, activeIdleMs: 3 * 60_000 })).toBe(
      false,
    )

    now = new Date('2026-05-05T12:03:01.000Z')
    expect(manager.shouldShutdown({ initialIdleMs: 10 * 60_000, activeIdleMs: 3 * 60_000 })).toBe(
      true,
    )
  })
})

describe('SessionManager — readSignoffs / writeSignoffs', () => {
  async function setupSession() {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-signoffs-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')
    const manager = new SessionManager({ repoRoot: dir, env: { XDG_STATE_HOME: xdg } })
    const { sessionId } = manager.openSession(filePath)
    return { manager, sessionId }
  }

  it('returns an empty list when no signoffs have been written', async () => {
    const { manager, sessionId } = await setupSession()
    await expect(manager.readSignoffs(sessionId)).resolves.toEqual([])
  })

  it('round-trips signoffs: POST then GET returns the same list', async () => {
    const { manager, sessionId } = await setupSession()
    const signoffs = [makeSignoff('g1'), makeSignoff('g2')]
    await manager.writeSignoffs(sessionId, signoffs)
    await expect(manager.readSignoffs(sessionId)).resolves.toEqual(signoffs)
  })

  it('writeSignoffs preserves existing annotations in the same document', async () => {
    const { manager, sessionId } = await setupSession()
    // Write annotations first via writeAnnotations to populate the store.
    // Use an empty list — the invariant is that signoff writes don't erase them.
    await manager.writeAnnotations(sessionId, [])
    await manager.writeSignoffs(sessionId, [makeSignoff('g1')])
    // Annotations should still be an empty list, not undefined / clobbered.
    await expect(manager.readAnnotations(sessionId)).resolves.toEqual([])
    await expect(manager.readSignoffs(sessionId)).resolves.toEqual([makeSignoff('g1')])
  })

  it('throws for an unknown sessionId (→ 404 at the route level)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-signoffs-'))
    const manager = new SessionManager({ repoRoot: dir })
    await expect(manager.readSignoffs('sess-nonexistent')).rejects.toThrow(/Session not found/)
    await expect(manager.writeSignoffs('sess-nonexistent', [])).rejects.toThrow(/Session not found/)
  })
})

describe('SessionManager — extract', () => {
  it('returns a full ExtractResult with all 8 InfoKind for the auth-soc2 fixture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-extract-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, readFixture('plan-auth-soc2.md'), 'utf8')

    const manager = new SessionManager({ repoRoot: dir, env: { XDG_STATE_HOME: xdg } })
    const { sessionId } = manager.openSession(filePath)
    const result = await manager.extract(sessionId)

    expect(result.points.length).toBeGreaterThan(0)
    const kinds = new Set(result.points.map((p) => p.kind))
    expect([...kinds].sort()).toEqual([
      'behavior',
      'decision',
      'goal',
      'open-question',
      'precondition',
      'risk',
      'scope',
      'verification',
    ])
  })

  it('throws for an unknown sessionId (→ 404 at the route level)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-extract-'))
    const manager = new SessionManager({ repoRoot: dir })
    await expect(manager.extract('sess-nonexistent')).rejects.toThrow(/Session not found/)
  })
})

describe('SessionManager — rewriteApply', () => {
  function fakeLlm(entries: Array<{ id: string; rewritten: string }>): LlmRunner {
    return { run: async () => ({ ok: true, value: JSON.stringify(entries) }) }
  }

  async function setupSession(content: string, llm: LlmRunner) {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-apply-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, content, 'utf8')
    const manager = new SessionManager({
      repoRoot: dir,
      env: { XDG_STATE_HOME: xdg },
      llmRunner: llm,
    })
    const { sessionId } = manager.openSession(filePath)
    return { manager, sessionId, filePath }
  }

  it('runs the closed loop: read → rewrite → splice → save → re-extract', async () => {
    const original = '# Plan\n\nOld sentence here.\n'
    const selection = 'Old sentence here.'
    const srcStart = original.indexOf(selection)
    const { manager, sessionId, filePath } = await setupSession(
      original,
      fakeLlm([{ id: '1', rewritten: 'New sentence here.' }]),
    )

    const { result, content } = await manager.rewriteApply(sessionId, [
      { id: '1', srcStart, srcEnd: srcStart + selection.length, selection, instruction: 'improve' },
    ])

    expect(content).toBe('# Plan\n\nNew sentence here.\n')
    // Landed on disk, not just returned.
    await expect(readFile(filePath, 'utf8')).resolves.toBe('# Plan\n\nNew sentence here.\n')
    // Returned result is a fresh extraction of the new content, not the old.
    expect(result).toEqual(extract(content))
  })

  it('does not persist when an edit drifts (selection no longer matches)', async () => {
    const original = '# Plan\n\nOld sentence here.\n'
    const { manager, sessionId, filePath } = await setupSession(
      original,
      fakeLlm([{ id: '1', rewritten: 'New sentence here.' }]),
    )

    // selection claims text that is not at [8, 26) → drift guard rejects.
    await expect(
      manager.rewriteApply(sessionId, [
        { id: '1', srcStart: 8, srcEnd: 26, selection: 'Stale text here!!!', instruction: 'x' },
      ]),
    ).rejects.toBeInstanceOf(RewriteApplyConflictError)

    // Document is untouched.
    await expect(readFile(filePath, 'utf8')).resolves.toBe(original)
  })

  it('throws for an unknown sessionId (→ 404 at the route level)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-apply-'))
    const manager = new SessionManager({ repoRoot: dir })
    await expect(manager.rewriteApply('sess-nonexistent', [])).rejects.toThrow(/Session not found/)
  })
})

describe('SessionManager — applySelectionOp', () => {
  function fakeLlm(payload: unknown): LlmRunner {
    return { run: async () => ({ ok: true, value: JSON.stringify(payload) }) }
  }

  async function setupSession(content: string, llm: LlmRunner) {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-selop-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, content, 'utf8')
    const manager = new SessionManager({
      repoRoot: dir,
      env: { XDG_STATE_HOME: xdg },
      llmRunner: llm,
    })
    const { sessionId } = manager.openSession(filePath)
    return { manager, sessionId, filePath }
  }

  it('runs the closed loop for risk: draft → insert → save → re-extract as R6', async () => {
    const source = readFixture('plan-auth-soc2.md')
    const { manager, sessionId, filePath } = await setupSession(
      source,
      fakeLlm({ risk: '缓存击穿', impact: '延迟升高', mitigation: '单飞兜底' }),
    )

    const { newLabel, result, content } = await manager.applySelectionOp(
      sessionId,
      'risk',
      '缓存相关风险',
    )

    expect(newLabel).toBe('R6')
    // Landed on disk, and the new row is present in the persisted content.
    const onDisk = await readFile(filePath, 'utf8')
    expect(onDisk).toBe(content)
    expect(onDisk).toContain('| R6 |')
    expect(onDisk).toContain('缓存击穿')
    // Re-extraction surfaces the new labelled point.
    expect(result.points.some((p) => p.label === 'R6' && p.kind === 'risk')).toBe(true)
  })

  it('does not persist when the target section is missing', async () => {
    // A doc with no 风险 section → locate errors before any write.
    const source = '# Plan\n\n## 目标\n- **G1** 基础目标：X。\n'
    const { manager, sessionId, filePath } = await setupSession(
      source,
      fakeLlm({ risk: 'x', impact: 'y', mitigation: 'z' }),
    )

    await expect(manager.applySelectionOp(sessionId, 'risk', 'q')).rejects.toBeInstanceOf(
      SelectionOpError,
    )
    await expect(readFile(filePath, 'utf8')).resolves.toBe(source)
  })

  it('does not persist when the LLM fails to produce a valid fragment', async () => {
    const source = readFixture('plan-auth-soc2.md')
    const badLlm: LlmRunner = { run: async () => ({ ok: true, value: 'not json' }) }
    const { manager, sessionId, filePath } = await setupSession(source, badLlm)

    await expect(manager.applySelectionOp(sessionId, 'risk', 'q')).rejects.toBeInstanceOf(
      SelectionOpError,
    )
    await expect(readFile(filePath, 'utf8')).resolves.toBe(source)
  })

  it('throws for an unknown sessionId (→ 404 at the route level)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-selop-'))
    const manager = new SessionManager({ repoRoot: dir })
    await expect(manager.applySelectionOp('sess-nonexistent', 'risk', 'q')).rejects.toThrow(
      /Session not found/,
    )
  })
})
