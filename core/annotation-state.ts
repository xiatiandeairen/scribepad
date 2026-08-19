/**
 * annotation-state — pure state machine for the annotation lifecycle.
 *
 * Extracted verbatim from server/services/annotations.ts during the P3a
 * hexagonal split: the transition rules are the domain core and must stay
 * IO-free (E0 boundary — core imports only types/ and zod). The server service
 * centralizes the annotation lifecycle for every caller.
 *
 * State machine (docs/design/architecture.md; AnnotationState in types/annotation.ts):
 *   draft     — newly created; user hasn't issued AI rewrite yet
 *   discussed — AI rewrite in flight or returned, awaiting user decision
 *   decided   — locked to prevent AI drift; AI rewrite filtered server-side
 */
import type { AnnotationState } from '../types/annotation.js'

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
 */
export function validateStateTransition(
  prev: AnnotationState | undefined,
  next: AnnotationState,
): boolean {
  if (prev === undefined) return true
  if (prev === next) return true
  return LEGAL_TRANSITIONS.has(`${prev}->${next}`)
}
