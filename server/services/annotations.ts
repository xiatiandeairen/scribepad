/**
 * services/annotations — document state JSON CRUD + state machine validation.
 *
 * Reads/writes document state under XDG state home.
 * `writeAnnotations` defends against illegal state transitions by diffing
 * each incoming annotation against the previous sidecar entry (matched by id).
 *
 * State machine (see docs/plan.md §1.4; AnnotationState in types/annotation.ts):
 *   draft     — newly created; user hasn't issued AI rewrite yet
 *   discussed — AI rewrite in flight or returned, awaiting user decision
 *   decided   — locked to prevent AI drift; AI rewrite filtered server-side
 *
 * Plan.md 的 "thinking"/"deciding" 是 UI 展示态; 持久化仍统一折叠到
 * `discussed`,再用 `ai_suggestion` 是否存在区分。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Annotation, AnnotationState, Sidecar } from '../../types/annotation.js'
import type { PlanItemState } from '../../types/plan.js'
import { docRelativePath, documentStatePath, legacySidecarPath } from '../paths.js'

export function sidecarPath(
  docPath: string,
  repoRoot: string = dirname(docPath),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return documentStatePath(repoRoot, docPath, env)
}

/**
 * Legal state transitions. Encoded as a set of `${prev}->${next}` keys.
 *
 * Allowed:
 *   draft     → discussed   (user submits instruction, AI rewrite kicks off)
 *   discussed → decided     (user accepts AI suggestion; lock the segment)
 *   decided   → draft       (user unlocks a previously-decided segment)
 *   discussed → draft       (user cancels mid-loop, e.g. Esc during loading)
 *   draft     → decided     (direct lock without AI rewrite — "拍板")
 *
 * "接受改写" 只会写 `status='applied'`; 不再引入额外的 executed 状态。
 * 因此非法转移主要是锁定环之外的 state 跳变。
 */
const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  'draft->discussed',
  'discussed->decided',
  'decided->draft',
  'discussed->draft',
  'draft->decided',
])

/**
 * Validate a state transition. Returns true if legal (or a no-op), false otherwise.
 *
 * - `prev === undefined` means a brand-new annotation; any state is allowed
 *   for the initial value (caller decides — typically `draft`).
 * - `prev === next` is always legal (idempotent write).
 *
 * Exported for unit testing (tests/unit/state-machine.test.ts, Task 12).
 */
export function validateStateTransition(
  prev: AnnotationState | undefined,
  next: AnnotationState,
): boolean {
  if (prev === undefined) return true
  if (prev === next) return true
  return LEGAL_TRANSITIONS.has(`${prev}->${next}`)
}

export async function readAnnotations(
  docPath: string,
  repoRoot: string = dirname(docPath),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Annotation[]> {
  const data = await readSidecar(docPath, repoRoot, env)
  return data.annotations ?? []
}

export async function readPlanState(
  docPath: string,
  repoRoot: string = dirname(docPath),
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlanItemState[]> {
  const data = await readSidecar(docPath, repoRoot, env)
  return data.planState ?? []
}

async function readSidecar(
  docPath: string,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<Sidecar> {
  const p = sidecarPath(docPath, repoRoot, env)
  if (!existsSync(p)) {
    const legacy = legacySidecarPath(docPath)
    if (existsSync(legacy)) {
      const raw = await readFile(legacy, 'utf8')
      const migrated = withDocumentMeta(JSON.parse(raw) as Sidecar, docPath, repoRoot)
      await writeSidecar(docPath, repoRoot, migrated, env)
      return migrated
    }
    return withDocumentMeta({ version: 4, annotations: [] }, docPath, repoRoot)
  }
  const raw = await readFile(p, 'utf8')
  return withDocumentMeta(JSON.parse(raw) as Sidecar, docPath, repoRoot)
}

export async function writeAnnotations(
  docPath: string,
  annotations: Annotation[],
  repoRoot: string = dirname(docPath),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Defend against illegal state transitions. Match incoming annotations
  // against existing sidecar entries by id; new ids skip validation.
  const existing = await readAnnotations(docPath, repoRoot, env)
  const prevById = new Map(existing.map((a) => [a.id, a]))

  for (const next of annotations) {
    const prev = prevById.get(next.id)
    if (!prev) continue
    if (prev.state === next.state) continue
    if (!validateStateTransition(prev.state, next.state)) {
      throw new Error(
        `Illegal state transition for annotation ${next.id}: ${prev.state} -> ${next.state}`,
      )
    }
  }

  const existingData = await readSidecar(docPath, repoRoot, env)
  const data: Sidecar = withDocumentMeta(
    { ...existingData, version: 4, annotations },
    docPath,
    repoRoot,
  )
  if (existingData.planState) data.planState = existingData.planState
  await writeSidecar(docPath, repoRoot, data, env)
}

export async function writePlanState(
  docPath: string,
  planState: PlanItemState[],
  repoRoot: string = dirname(docPath),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const existingData = await readSidecar(docPath, repoRoot, env)
  const data: Sidecar = withDocumentMeta(
    { ...existingData, version: 4, planState },
    docPath,
    repoRoot,
  )
  data.annotations = existingData.annotations ?? []
  await writeSidecar(docPath, repoRoot, data, env)
}

async function writeSidecar(
  docPath: string,
  repoRoot: string,
  data: Sidecar,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const p = sidecarPath(docPath, repoRoot, env)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(withDocumentMeta(data, docPath, repoRoot), null, 2), 'utf8')
}

function withDocumentMeta(data: Sidecar, docPath: string, repoRoot: string): Sidecar {
  return {
    ...data,
    version: 4,
    docPath,
    docRelativePath: docRelativePath(repoRoot, docPath),
    annotations: data.annotations ?? [],
  }
}
