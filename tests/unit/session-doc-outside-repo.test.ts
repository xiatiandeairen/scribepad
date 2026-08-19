/**
 * Integration coverage for the "plan doc lives outside the reviewed repo"
 * scenario: `repoRoot` is a project's git root, but `docPath` is a file under
 * `$XDG_STATE_HOME/scribepad/plans/<encoded-repo-path>/...` — a location the
 * scribepad plan-storage redesign moves plan docs to, entirely outside any
 * repoRoot tree.
 *
 * Drives the full session lifecycle through SessionManager (the same surface
 * the HTTP routes call) and asserts every write lands where docIdFor's hash
 * says it should — never beside the document itself. See
 * `server/paths.ts` docIdFor/documentStatePath/exportPathFor: they hash
 * `relative(repoRoot, docPath)`, so a docPath outside repoRoot only changes
 * the hashed input (relative() returns a `../../...`-laden string) — the hash
 * output, and therefore every path built from it, is unaffected.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../server/services/session-manager.js'
import { documentStatePath, exportPathFor } from '../../server/paths.js'
import type { LlmRunner } from '../../types/ports.js'
import type { Annotation } from '../../types/annotation.js'
import type { Signoff } from '../../types/domain.js'

const repoRootFixtures = fileURLToPath(new URL('../../', import.meta.url))
function readFixture(name: string): string {
  return readFileSync(join(repoRootFixtures, name), 'utf8')
}

function fakeLlm(entries: Array<{ id: string; rewritten: string }>): LlmRunner {
  return { run: async () => ({ ok: true, value: JSON.stringify(entries) }) }
}

function makeAnnotation(id: string): Annotation {
  return {
    id,
    anchor: { srcStart: 0, srcEnd: 5, text: '# 本地' },
    state: 'draft',
    status: 'open',
    history: [],
    created_at: '2026-07-10T00:00:00.000Z',
    ai_suggestion: null,
  }
}

function makeSignoff(pointId: string): Signoff {
  return { pointId, label: pointId.toUpperCase(), signedAt: '2026-07-10T00:00:00.000Z' }
}

/**
 * Mirrors the real plan-storage layout: `$XDG_STATE_HOME/scribepad/plans/
 * <repoRoot with "/" -> "-">/<date>-<topic>.md` — the same encoding
 * `~/.claude/projects/` uses for its own per-cwd session directories.
 */
function planDocPath(xdg: string, repoRoot: string): string {
  const encodedRepoRoot = repoRoot.replace(/\//g, '-')
  return join(xdg, 'scribepad', 'plans', encodedRepoRoot, '2026-07-10-outside-repo-plan.md')
}

describe('SessionManager — docPath outside repoRoot (XDG plan-storage location)', () => {
  async function setup() {
    const repoRoot = await mkdtemp(join(tmpdir(), 'scribepad-repo-'))
    const xdg = await mkdtemp(join(tmpdir(), 'scribepad-xdg-'))
    const docPath = planDocPath(xdg, repoRoot)
    await mkdir(dirname(docPath), { recursive: true })
    await writeFile(docPath, readFixture('tests/fixtures/plan-light.md'), 'utf8')
    return { repoRoot, xdg, docPath, env: { XDG_STATE_HOME: xdg } }
  }

  it('walks open -> extract -> annotate -> signoff -> rewrite-apply -> done, all state landing under XDG, none beside the doc', async () => {
    const { repoRoot, xdg, docPath, env } = await setup()
    const expectedSidecarPath = documentStatePath(repoRoot, docPath, env)
    const expectedExportPath = exportPathFor(repoRoot, docPath, env)

    // Sanity: the doc really is outside repoRoot, and the computed sidecar /
    // export paths land under XDG state — nowhere near the doc's own directory.
    expect(docPath.startsWith(repoRoot)).toBe(false)
    expect(expectedSidecarPath.startsWith(xdg)).toBe(true)
    expect(expectedExportPath.startsWith(xdg)).toBe(true)
    expect(dirname(expectedSidecarPath)).not.toBe(dirname(docPath))

    const manager = new SessionManager({
      repoRoot,
      env,
      llmRunner: fakeLlm([{ id: 'r-1', rewritten: '将现有硬编码配置项提取为环境变量。' }]),
      now: () => new Date('2026-07-10T12:00:00.000Z'),
    })

    // 1. open — session records the hashed sidecar/export paths, not
    // anything derived from the doc's own directory.
    const opened = await manager.openSession(docPath)
    const session = manager.getSession(opened.sessionId)
    expect(session.sidecarPath).toBe(expectedSidecarPath)
    expect(session.outputPath).toBe(expectedExportPath)

    // 2. extract — reads the doc content fine from outside repoRoot.
    const extracted = await manager.extract(opened.sessionId)
    expect(extracted.points.length).toBeGreaterThan(0)

    // 3. annotate — round-trips through the canonical XDG state store.
    await manager.writeAnnotations(opened.sessionId, [makeAnnotation('a-1')])
    await expect(manager.readAnnotations(opened.sessionId)).resolves.toEqual([
      makeAnnotation('a-1'),
    ])
    expect(existsSync(expectedSidecarPath)).toBe(true)

    // 4. signoff — persists to the same sidecar record, preserving the
    // annotation written in step 3 (round-trip preservation invariant, G5).
    await manager.writeSignoffs(opened.sessionId, [makeSignoff('g1')])
    await expect(manager.readSignoffs(opened.sessionId)).resolves.toEqual([makeSignoff('g1')])
    await expect(manager.readAnnotations(opened.sessionId)).resolves.toEqual([
      makeAnnotation('a-1'),
    ])

    // 5. rewrite-apply — the LLM-driven splice reads and writes the doc at
    // its real (outside-repo) location; nothing is written to repoRoot.
    const original = await readFile(docPath, 'utf8')
    const selection = '将现有硬编码配置提取到环境变量'
    const srcStart = original.indexOf(selection)
    expect(srcStart).toBeGreaterThanOrEqual(0)
    const { content: rewrittenContent } = await manager.rewriteApply(opened.sessionId, [
      {
        id: 'r-1',
        srcStart,
        srcEnd: srcStart + selection.length,
        selection,
        instruction: 'simplify',
      },
    ])
    expect(rewrittenContent).toContain('将现有硬编码配置项提取为环境变量。')
    await expect(readFile(docPath, 'utf8')).resolves.toBe(rewrittenContent)

    // 6. done — exports the final content to exportPathFor's XDG path, not
    // beside the doc, and closes the session.
    const done = await manager.done(opened.sessionId)
    expect(done.outputPath).toBe(expectedExportPath)
    await expect(readFile(done.outputPath, 'utf8')).resolves.toBe(rewrittenContent)
    expect(() => manager.getSession(opened.sessionId)).toThrow(/Session not found/)
  })
})
