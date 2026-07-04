/**
 * Internal text primitives shared by the extractor modules.
 *
 * `hash` / `slug` are byte-for-byte the algorithm used by the legacy
 * src/lib/plan-inspector.ts so labelled ids and textHashes stay comparable
 * across the old and new extraction paths during the Strangler migration.
 */
import type { Nodes } from 'mdast'

/** Concatenate all leaf text under a node (ignores markdown emphasis markers). */
export function textOf(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as Nodes[]).map(textOf).join('')
  }
  return ''
}

/** Collapse runs of whitespace to single spaces and trim. */
export function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 31-multiplier base36 hash — matches plan-inspector's textHash / slug. */
export function hash(value: string): string {
  let n = 0
  for (let i = 0; i < value.length; i += 1) {
    n = (n * 31 + value.charCodeAt(i)) >>> 0
  }
  return n.toString(36)
}

/** Stable key for a group title (used in the fallback id). */
export function slug(value: string): string {
  return hash(compact(value))
}
