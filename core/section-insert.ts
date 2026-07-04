/**
 * core/section-insert — locate where to append a new item to a plan section and
 * the stable label the new item should carry.
 *
 * Pure (E0): reads an ExtractResult only, no mdast re-parse. The insertion offset
 * is derived from the anchors the extractor already computed — the max `srcEnd`
 * among the target kind's anchored points, i.e. just past the section's last
 * item. The extractor anchors each item at exactly the granularity P6 needs
 * (table rows for risk, H3 cards for decision, list/paragraph items for
 * open-question), so one rule serves all three ops. The offset feeds an
 * insertion-shaped EditAt into applyRewrites (srcStart === srcEnd, selection '').
 */
import type { ExtractResult, InfoKind } from '../types/domain.js'
import type { Result } from '../types/result.js'
import { err, ok } from './result.js'

/** op → the section kind its new item lands in. */
export const SELECTION_OP_KIND: Record<'dcard' | 'risk' | 'open', InfoKind> = {
  dcard: 'decision',
  risk: 'risk',
  open: 'open-question',
}

/** The label prefix each appendable kind owns (decision D, risk R, open-question Q). */
const KIND_PREFIX: Partial<Record<InfoKind, string>> = {
  decision: 'D',
  risk: 'R',
  'open-question': 'Q',
}

/** The target section has no anchored point to append after (missing or empty). */
export interface SectionInsertError {
  kind: 'section-missing'
  message: string
}

/**
 * The next stable label for `kind`: its prefix followed by one past the highest
 * existing ordinal (D1–D4 → D5). Falls back to `<prefix>1` when the kind has no
 * labelled point yet. Throws on an unmapped kind (a programmer error — only the
 * three appendable kinds are supported).
 */
export function nextLabel(result: ExtractResult, kind: InfoKind): string {
  const prefix = KIND_PREFIX[kind]
  if (!prefix) throw new Error(`nextLabel: kind ${kind} has no label prefix`)
  let max = 0
  for (const point of result.points) {
    const label = point.label
    if (!label || label.charAt(0) !== prefix) continue
    const ordinal = Number.parseInt(label.slice(1), 10)
    if (Number.isInteger(ordinal) && ordinal > max) max = ordinal
  }
  return `${prefix}${max + 1}`
}

/**
 * The source offset at which to append a new item to the section owning `kind`:
 * just past the `srcEnd` of that kind's last anchored point. Returns
 * `Err('section-missing')` when no such point exists, so the caller degrades
 * rather than inserting at a guessed offset.
 */
export function locateSectionInsertAt(
  result: ExtractResult,
  kind: InfoKind,
): Result<number, SectionInsertError> {
  let at: number | undefined
  for (const point of result.points) {
    if (point.kind !== kind || !point.anchor) continue
    if (at === undefined || point.anchor.srcEnd > at) at = point.anchor.srcEnd
  }
  if (at === undefined) {
    return err({
      kind: 'section-missing',
      message: `no anchored ${kind} point to append after — target section missing or empty`,
    })
  }
  return ok(at)
}
