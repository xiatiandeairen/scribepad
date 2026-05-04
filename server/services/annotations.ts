/**
 * services/annotations — sidecar JSON CRUD + state machine validation.
 *
 * Reads/writes `.{filename}.annotations.json` next to the doc.
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
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import type { Annotation, AnnotationState, Sidecar } from '../../types/annotation.js'

export function sidecarPath(docPath: string): string {
  return join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
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

export async function readAnnotations(docPath: string): Promise<Annotation[]> {
  const p = sidecarPath(docPath)
  if (!existsSync(p)) return []
  const raw = await readFile(p, 'utf8')
  const data = JSON.parse(raw) as Sidecar
  return data.annotations ?? []
}

export async function writeAnnotations(docPath: string, annotations: Annotation[]): Promise<void> {
  // Defend against illegal state transitions. Match incoming annotations
  // against existing sidecar entries by id; new ids skip validation.
  const existing = await readAnnotations(docPath)
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

  const data: Sidecar = { version: 3, annotations }
  await writeFile(sidecarPath(docPath), JSON.stringify(data, null, 2), 'utf8')
}
