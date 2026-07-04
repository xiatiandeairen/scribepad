/**
 * core/extract — parse a plan markdown document into an ExtractResult.
 *
 * Pure and framework-free (E0): the only dependencies are the mdast parsing
 * stack (allowed into core alongside types/ and zod) plus GFM so that tables
 * and `- [ ]` task lists resolve. The result is never persisted — callers
 * recompute it each run.
 *
 * Non-8-section or weakly-structured documents degrade to a partial/empty
 * result; extraction never throws on shape.
 */
import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { DecisionCard, DocMeta, ExtractResult, ExtractedItem } from '../../types/domain.js'
import { extractDecisions } from './decisions.js'
import { pointsFromSection } from './points.js'
import { splitSections } from './sections.js'
import { compact, textOf } from './text.js'

export { byLabel, relatedPoints } from './labels.js'
export { classifySection, splitSections } from './sections.js'

/** Extract points + decision cards from a plan markdown source. */
export function extract(source: string): ExtractResult {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })

  const points: ExtractedItem[] = []
  const decisions: DecisionCard[] = []

  for (const section of splitSections(tree)) {
    if (section.kind === 'decision') {
      const extracted = extractDecisions(section)
      points.push(...extracted.points)
      decisions.push(...extracted.cards)
    } else {
      points.push(...pointsFromSection(section))
    }
  }

  const meta = docMeta(tree)
  return meta ? { points, decisions, meta } : { points, decisions }
}

/**
 * Document-level meta: the H1 title and the intro blockquote right after it (the
 * `>` line before the first H2). Returns undefined when there is no H1, so a
 * plain-text doc degrades cleanly. A doc with an H1 but no blockquote still
 * yields `{ title }`.
 */
function docMeta(tree: Root): DocMeta | undefined {
  const meta: DocMeta = {}
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1 && meta.title === undefined) {
      meta.title = compact(textOf(node))
    } else if (node.type === 'blockquote' && meta.intro === undefined && meta.title !== undefined) {
      meta.intro = compact(textOf(node))
    } else if (node.type === 'heading' && node.depth === 2) {
      break
    }
  }
  return meta.title === undefined && meta.intro === undefined ? undefined : meta
}
