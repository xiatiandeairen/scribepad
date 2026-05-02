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
 *   executed  — rewrite has been applied to the .md source
 *
 * Plan.md §1.4 uses transitional names "thinking"/"deciding" for the in-flight
 * AI loop; both collapse to `discussed` in the persistent schema.
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
 *   decided   → executed    (applied to source; rewrite written to .md)
 *   discussed → executed    (⌘↵ accept+apply path)
 *
 * Rejected: executed → anything (terminal), and any other combo
 * (e.g. executed → draft, draft → executed without going through decided).
 */
const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  'draft->discussed',
  'discussed->decided',
  'decided->draft',
  'discussed->draft',
  'draft->decided',
  'decided->executed',
  'discussed->executed',
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

  const data: Sidecar = { version: 2, annotations }
  await writeFile(sidecarPath(docPath), JSON.stringify(data, null, 2), 'utf8')
}
