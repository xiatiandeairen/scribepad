import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { outputPathFor, SessionManager } from '../../server/services/session-manager'
import { sidecarPath } from '../../server/services/annotations'

describe('outputPathFor', () => {
  it('writes next to the source markdown with .agent.md suffix', () => {
    expect(outputPathFor('/repo/docs/plan.md')).toBe('/repo/docs/plan.agent.md')
  })
})

describe('SessionManager', () => {
  it('opens different files as different sessions on one server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const a = join(dir, 'a.md')
    const b = join(dir, 'b.md')
    await writeFile(a, '# A\n', 'utf8')
    await writeFile(b, '# B\n', 'utf8')

    const manager = new SessionManager({ baseUrl: () => 'http://127.0.0.1:3000' })
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

    const manager = new SessionManager({ baseUrl: () => 'http://127.0.0.1:3000' })
    const first = manager.openSession(filePath)
    const second = manager.openSession(filePath)

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.url).toBe(first.url)
  })

  it('tracks clients per document session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')

    const manager = new SessionManager()
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
    const manager = new SessionManager({ now: () => now })
    manager.openSession(filePath)

    now = new Date('2026-05-05T12:10:00.000Z')
    expect(manager.shouldShutdown({ initialIdleMs: 60_000, activeIdleMs: 60_000 })).toBe(false)
  })

  it('done writes final markdown content to .agent.md and closes only that session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-session-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n\nFinal content.\n', 'utf8')
    await writeFile(
      sidecarPath(filePath),
      JSON.stringify({
        version: 4,
        annotations: [],
      }),
      'utf8',
    )

    const manager = new SessionManager({
      now: () => new Date('2026-05-05T12:00:00.000Z'),
    })
    const opened = manager.openSession(filePath)
    const done = await manager.done(opened.sessionId)

    expect(done.outputPath).toBe(join(dir, 'plan.agent.md'))
    await expect(readFile(done.outputPath, 'utf8')).resolves.toBe('# Plan\n\nFinal content.\n')
    expect(() => manager.getSession(opened.sessionId)).toThrow(/Session not found/)
  })

  it('uses active idle timeout after all active sessions are done', async () => {
    let now = new Date('2026-05-05T12:00:00.000Z')
    const dir = await mkdtemp(join(tmpdir(), 'scribepad-manager-'))
    const filePath = join(dir, 'plan.md')
    await writeFile(filePath, '# Plan\n', 'utf8')
    const manager = new SessionManager({ now: () => now })
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
