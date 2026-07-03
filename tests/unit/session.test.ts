import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { outputPathFor, SessionManager } from '../../server/services/session-manager'
import { docIdFor, documentStatePath, repoIdFor } from '../../server/paths'

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
