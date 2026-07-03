/**
 * Unit tests for server/adapters/store-sidecar.ts (the standalone ReviewStore).
 *
 * All tests inject a temporary repoRoot + XDG_STATE_HOME so they never touch
 * the real XDG state directory.
 */
import { describe, it, expect } from 'vitest'
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createSidecarStore } from '../../server/adapters/store-sidecar.js'
import { documentStatePath } from '../../server/paths.js'
import type { Annotation } from '../../types/annotation.js'
import type { ConfirmState } from '../../types/domain.js'
import type { PlanItemState } from '../../types/plan.js'
import type { ReviewState } from '../../types/ports.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scribepad-store-'))
}

async function setup(): Promise<{ repoRoot: string; env: NodeJS.ProcessEnv; docPath: string }> {
  const repoRoot = await tempDir()
  const xdg = await tempDir()
  const docPath = join(repoRoot, 'plan.md')
  await writeFile(docPath, '# Plan\n', 'utf8')
  return { repoRoot, env: { XDG_STATE_HOME: xdg }, docPath }
}

function makeAnnotation(id: string): Annotation {
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

function makePlanItem(id: string): PlanItemState {
  return { id, status: 'locked', textHash: 'abc123', updatedAt: '2026-01-01' }
}

function makeConfirmState(itemId: string): ConfirmState {
  return {
    itemId,
    status: 'confirmed',
    confidence: 0.42,
    textHash: 'hash-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('createSidecarStore — load missing sidecar', () => {
  it('returns ok with an empty state when no sidecar file exists', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })

    const res = await store.load(docPath)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value).toEqual<ReviewState>({
      annotations: [],
      planState: [],
      confirmStates: [],
    })
  })
})

describe('createSidecarStore — round-trip', () => {
  it('loads back the same state that was saved', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })

    const state: ReviewState = {
      annotations: [makeAnnotation('a-1')],
      planState: [makePlanItem('scope:1')],
      confirmStates: [makeConfirmState('item-1')],
    }
    const saved = await store.save(docPath, state)
    expect(saved.ok).toBe(true)

    const res = await store.load(docPath)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value).toEqual(state)
  })
})

describe('createSidecarStore — fields do not clobber each other', () => {
  it('load-modify-save of one field preserves the other two', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })

    await store.save(docPath, {
      annotations: [],
      planState: [makePlanItem('scope:1')],
      confirmStates: [makeConfirmState('item-1')],
    })

    // Realistic caller: load current state, change only annotations, save back.
    const loaded = await store.load(docPath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    await store.save(docPath, { ...loaded.value, annotations: [makeAnnotation('a-1')] })

    const res = await store.load(docPath)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.annotations.map((a) => a.id)).toEqual(['a-1'])
    expect(res.value.planState.map((p) => p.id)).toEqual(['scope:1'])
    expect(res.value.confirmStates.map((c) => c.itemId)).toEqual(['item-1'])
  })
})

describe('createSidecarStore — missing confirmStates in file', () => {
  it('defaults confirmStates to an empty list when the field is absent', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })

    // Write a sidecar (via the store) that has no confirmStates, then hand-edit
    // is unnecessary: save with an empty confirmStates and confirm read default.
    await store.save(docPath, {
      annotations: [makeAnnotation('a-1')],
      planState: [],
      confirmStates: [],
    })

    // Simulate an older file on disk: overwrite it without the confirmStates key.
    const p = documentStatePath(repoRoot, docPath, env)
    const onDisk = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>
    delete onDisk.confirmStates
    await writeFile(p, JSON.stringify(onDisk), 'utf8')

    const res = await store.load(docPath)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.confirmStates).toEqual([])
  })
})

describe('createSidecarStore — legacy sidecar migration', () => {
  it('reads a legacy in-repo sidecar and migrates it to the XDG path', async () => {
    const { repoRoot, env, docPath } = await setup()
    const store = createSidecarStore({ repoRoot, env })

    const legacyPath = join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
    await writeFile(
      legacyPath,
      JSON.stringify({ version: 4, annotations: [makeAnnotation('legacy-1')] }),
      'utf8',
    )

    const res = await store.load(docPath)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.annotations.map((a) => a.id)).toEqual(['legacy-1'])

    // After the first load the state now lives at the new XDG path.
    expect(existsSync(documentStatePath(repoRoot, docPath, env))).toBe(true)
  })
})
