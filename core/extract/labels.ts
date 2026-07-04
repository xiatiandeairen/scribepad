/**
 * Grounding primitives: label recognition + cross-reference scanning +
 * navigation over the extracted reference graph.
 *
 * Label syntax is `^[GDRPQB]\d+$` — the five stable roles G/D/R/P/Q plus B,
 * which labels a *verified bug* living in the goal section (so the goal section
 * owns two prefixes, G for gates and B for bugs, both mapping to `goal`). A
 * point only *owns* a label when the prefix matches its section kind — a
 * `**G2**` prefix inside a verification item is a reference to goal G2, not a
 * label that item owns (this is the REF-03 prefix/kind rule expressed at
 * extraction time, and it stops two verification items colliding on one id).
 * Step / verification / section nav labels (S / A / §) are frontend pseudo-
 * labels derived from ordinals, not backend labels — hence absent here.
 */
import type { ExtractedItem, ExtractResult, InfoKind } from '../../types/domain.js'

/**
 * The single source of truth for label prefix → kind. Both extraction (label
 * ownership) and verification (REF-03 prefix/kind check) read this — keep it
 * one map so the two never drift.
 */
export const PREFIX_KIND: Record<string, InfoKind> = {
  G: 'goal',
  B: 'goal',
  D: 'decision',
  R: 'risk',
  P: 'precondition',
  Q: 'open-question',
}

const LABEL_LEAD = /^([GDRPQB]\d+)\b/
/** Global; only ever consumed via `String.matchAll`, which copies it (no shared lastIndex). */
export const LABEL_TOKEN = /\b[GDRPQB]\d+\b/g

/** True when a label's prefix maps to the given section kind. */
export function prefixMatchesKind(label: string, kind: InfoKind): boolean {
  const prefix = label.charAt(0)
  return PREFIX_KIND[prefix] === kind
}

/**
 * The label this point owns, if any. Reads a leading label token (from a bold
 * prefix, table first column, or heading prefix — all already flattened to
 * plain text) and keeps it only when its prefix matches `kind`.
 */
export function labelOf(kind: InfoKind, text: string): string | undefined {
  const match = LABEL_LEAD.exec(text)
  if (!match) return undefined
  const candidate = match[1]!
  return prefixMatchesKind(candidate, kind) ? candidate : undefined
}

/**
 * All label tokens referenced in `text`, excluding `selfLabel` (a point never
 * references itself). Dangling refs — targets never defined as a point — are
 * kept verbatim; validation of them is a downstream concern, not extraction.
 */
export function scanRefs(text: string, selfLabel: string | undefined): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(LABEL_TOKEN)) {
    const token = match[0]
    if (token === selfLabel || seen.has(token)) continue
    seen.add(token)
    refs.push(token)
  }
  return refs
}

/** Index points by their label. Later definitions win (duplicates are a validation concern). */
export function byLabel(result: ExtractResult): Record<string, ExtractedItem> {
  const index: Record<string, ExtractedItem> = {}
  for (const point of result.points) {
    if (point.label) index[point.label] = point
  }
  return index
}

/**
 * Points reachable from `id` within `depth` hops of the reference graph —
 * both out-edges (this point's refs) and in-edges (points that ref this one).
 * The seed point itself is excluded from the result. This is the context-pack
 * seed: given a point, collect its grounding and its dependents.
 */
export function relatedPoints(result: ExtractResult, id: string, depth = 1): ExtractedItem[] {
  const index = byLabel(result)
  const seed = result.points.find((point) => point.id === id || point.label === id)
  if (!seed) return []

  const collected = new Map<string, ExtractedItem>()
  let frontier = [seed]
  for (let hop = 0; hop < depth; hop += 1) {
    const next: ExtractedItem[] = []
    for (const point of frontier) {
      for (const ref of point.refs) {
        const target = index[ref]
        if (target) addRelated(collected, target, next)
      }
      for (const other of result.points) {
        if (point.label && other.refs.includes(point.label)) {
          addRelated(collected, other, next)
        }
      }
    }
    frontier = next
  }

  collected.delete(seed.id)
  return [...collected.values()]
}

function addRelated(
  collected: Map<string, ExtractedItem>,
  point: ExtractedItem,
  next: ExtractedItem[],
): void {
  if (collected.has(point.id)) return
  collected.set(point.id, point)
  next.push(point)
}
