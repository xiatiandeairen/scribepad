import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSidecarStore } from '../../server/adapters/store-sidecar.js'
import { documentStatePath } from '../../server/paths.js'
import type { Annotation } from '../../types/annotation.js'
import type { Signoff } from '../../types/domain.js'
import type { ReviewState } from '../../types/ports.js'

async function setup(): Promise<{ repoRoot: string; env: NodeJS.ProcessEnv; docPath: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'scribepad-store-'))
  const xdg = await mkdtemp(join(tmpdir(), 'scribepad-state-'))
  const docPath = join(repoRoot, 'plan.md')
  await writeFile(docPath, '# Plan\n', 'utf8')
  return { repoRoot, env: { XDG_STATE_HOME: xdg }, docPath }
}

function annotation(id: string): Annotation {
  return {
    id,
    anchor: { srcStart: 0, srcEnd: 5, text: 'Hello' },
    state: 'draft',
    status: 'open',
    history: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ai_suggestion: null,
  }
}

function signoff(pointId: string): Signoff {
  return { pointId, label: pointId.toUpperCase(), signedAt: '2026-01-01T00:00:00.000Z' }
}

describe('createSidecarStore', () => {
  it('returns an empty state when the state file does not exist', async () => {
    const { repoRoot, env, docPath } = await setup()
    const result = await createSidecarStore({ repoRoot, env }).load(docPath)
    expect(result).toEqual({ ok: true, value: { annotations: [], signoffs: [] } })
  })

  it('round-trips the current ReviewState contract', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })
    const state: ReviewState = { annotations: [annotation('a-1')], signoffs: [signoff('g1')] }
    expect((await store.save(docPath, state)).ok).toBe(true)
    expect(await store.load(docPath)).toEqual({ ok: true, value: state })
  })

  it('preserves one owned field while the other is updated', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })
    await store.save(docPath, { annotations: [], signoffs: [signoff('g1')] })
    const loaded = await store.load(docPath)
    if (!loaded.ok) throw new Error(loaded.error.message)
    await store.save(docPath, { ...loaded.value, annotations: [annotation('a-1')] })
    expect(await store.load(docPath)).toEqual({
      ok: true,
      value: { annotations: [annotation('a-1')], signoffs: [signoff('g1')] },
    })
  })

  it('removes retired fields on the next save', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })
    await store.save(docPath, { annotations: [annotation('a-1')], signoffs: [] })
    const path = documentStatePath(repoRoot, docPath, env)
    const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    record.planState = [{ id: 'old' }]
    record.confirmStates = [{ itemId: 'old' }]
    await writeFile(path, JSON.stringify(record), 'utf8')

    await store.save(docPath, { annotations: [annotation('a-2')], signoffs: [] })
    const after = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(after).not.toHaveProperty('planState')
    expect(after).not.toHaveProperty('confirmStates')
  })
})
