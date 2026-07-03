/**
 * Characterization tests for server/services/annotations.ts.
 *
 * Locks the current sidecar round-trip behaviour as a regression net for
 * upcoming refactors. Tests record what the code DOES — including the
 * write-preserves-other-field invariant — even if a behaviour is imperfect.
 *
 * All tests inject a temporary XDG_STATE_HOME so they never touch real state.
 */
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  readAnnotations,
  readPlanState,
  sidecarPath,
  writeAnnotations,
  writePlanState,
} from '../../server/services/annotations.js'
import type { Annotation, Sidecar } from '../../types/annotation.js'
import type { PlanItemState } from '../../types/plan.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scribepad-ann-char-'))
}

function makeAnnotation(id: string): Annotation {
  return {
    id,
    anchor: { srcStart: 0, srcEnd: 10, text: 'Hello' },
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

// ---------------------------------------------------------------------------
// readAnnotations — missing sidecar
// ---------------------------------------------------------------------------

describe('readAnnotations — missing sidecar', () => {
  it('returns empty array when sidecar file does not exist', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    const result = await readAnnotations(docPath, dir, { XDG_STATE_HOME: xdg })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// readPlanState — missing sidecar
// ---------------------------------------------------------------------------

describe('readPlanState — missing sidecar', () => {
  it('returns empty array when sidecar file does not exist', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    const result = await readPlanState(docPath, dir, { XDG_STATE_HOME: xdg })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// writeAnnotations / readAnnotations round-trip
// ---------------------------------------------------------------------------

describe('writeAnnotations / readAnnotations round-trip', () => {
  it('reads back the same annotations after writing', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    const ann = makeAnnotation('a-1')
    await writeAnnotations(docPath, [ann], dir, env)

    const result = await readAnnotations(docPath, dir, env)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a-1')
    expect(result[0].state).toBe('draft')
    expect(result[0].status).toBe('open')
  })

  it('overwrites previous annotations on subsequent write', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    await writeAnnotations(docPath, [makeAnnotation('a-1')], dir, env)
    await writeAnnotations(docPath, [makeAnnotation('b-1'), makeAnnotation('b-2')], dir, env)

    const result = await readAnnotations(docPath, dir, env)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.id)).toEqual(['b-1', 'b-2'])
  })
})

// ---------------------------------------------------------------------------
// writePlanState / readPlanState round-trip
// ---------------------------------------------------------------------------

describe('writePlanState / readPlanState round-trip', () => {
  it('reads back the same plan state after writing', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    const item = makePlanItem('scope:1')
    await writePlanState(docPath, [item], dir, env)

    const result = await readPlanState(docPath, dir, env)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(item)
  })

  it('overwrites previous plan state on subsequent write', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    await writePlanState(docPath, [makePlanItem('scope:1')], dir, env)
    await writePlanState(docPath, [makePlanItem('scope:2'), makePlanItem('scope:3')], dir, env)

    const result = await readPlanState(docPath, dir, env)
    expect(result).toHaveLength(2)
    expect(result.map((i) => i.id)).toEqual(['scope:2', 'scope:3'])
  })
})

// ---------------------------------------------------------------------------
// Critical invariant: write one field does not clobber the other
// ---------------------------------------------------------------------------

describe('write preserves other field — critical invariant', () => {
  it('writeAnnotations preserves existing planState', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    await writePlanState(docPath, [makePlanItem('scope:1')], dir, env)
    await writeAnnotations(docPath, [makeAnnotation('a-1')], dir, env)

    const planState = await readPlanState(docPath, dir, env)
    expect(planState).toHaveLength(1)
    expect(planState[0].id).toBe('scope:1')
  })

  it('writePlanState preserves existing annotations', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    await writeAnnotations(docPath, [makeAnnotation('a-1')], dir, env)
    await writePlanState(docPath, [makePlanItem('scope:2')], dir, env)

    const annotations = await readAnnotations(docPath, dir, env)
    expect(annotations).toHaveLength(1)
    expect(annotations[0].id).toBe('a-1')
  })

  it('both fields coexist after interleaved writes', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'doc.md')
    await writeFile(docPath, '# Doc\n', 'utf8')

    await writeAnnotations(docPath, [makeAnnotation('a-1')], dir, env)
    await writePlanState(docPath, [makePlanItem('scope:1')], dir, env)
    await writeAnnotations(docPath, [makeAnnotation('a-2'), makeAnnotation('a-3')], dir, env)

    const raw = JSON.parse(await readFile(sidecarPath(docPath, dir, env), 'utf8')) as Sidecar

    expect(raw.annotations).toHaveLength(2)
    expect((raw.planState ?? []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// withDocumentMeta — observable effects on the written sidecar JSON
// ---------------------------------------------------------------------------

describe('withDocumentMeta — sidecar JSON metadata', () => {
  it('written sidecar contains version=4, docPath, and docRelativePath', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'readme.md')
    await writeFile(docPath, '# Readme\n', 'utf8')

    await writeAnnotations(docPath, [], dir, env)

    const raw = JSON.parse(await readFile(sidecarPath(docPath, dir, env), 'utf8')) as Sidecar & {
      docPath?: string
      docRelativePath?: string
    }

    expect(raw.version).toBe(4)
    expect(raw.docPath).toBe(docPath)
    expect(raw.docRelativePath).toBe('readme.md')
  })

  it('sidecar created by writePlanState also carries metadata', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'plan.md')
    await writeFile(docPath, '# Plan\n', 'utf8')

    await writePlanState(docPath, [makePlanItem('scope:1')], dir, env)

    const raw = JSON.parse(await readFile(sidecarPath(docPath, dir, env), 'utf8')) as Sidecar & {
      docPath?: string
    }

    expect(raw.version).toBe(4)
    expect(raw.docPath).toBe(docPath)
  })
})

// ---------------------------------------------------------------------------
// Legacy sidecar migration
// ---------------------------------------------------------------------------

describe('legacy sidecar migration', () => {
  it('reads annotations from the legacy sidecar path when new path does not exist', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'plan.md')
    await writeFile(docPath, '# Plan\n', 'utf8')

    // Write legacy sidecar at <docDir>/.<filename>.annotations.json
    const legacyPath = join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
    await writeFile(
      legacyPath,
      JSON.stringify({ version: 4 as const, annotations: [makeAnnotation('legacy-1')] }),
      'utf8',
    )

    const result = await readAnnotations(docPath, dir, env)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('legacy-1')
  })

  it('migrates legacy sidecar to new XDG path on first read', async () => {
    const dir = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_STATE_HOME: xdg }
    const docPath = join(dir, 'plan.md')
    await writeFile(docPath, '# Plan\n', 'utf8')

    const legacyPath = join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
    await writeFile(
      legacyPath,
      JSON.stringify({ version: 4 as const, annotations: [makeAnnotation('legacy-2')] }),
      'utf8',
    )

    await readAnnotations(docPath, dir, env)

    // After first read the new path should exist
    expect(existsSync(sidecarPath(docPath, dir, env))).toBe(true)
  })
})
