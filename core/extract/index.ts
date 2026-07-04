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
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { DecisionCard, ExtractResult, ExtractedItem } from '../../types/domain.js'
import { extractDecisions } from './decisions.js'
import { pointsFromSection } from './points.js'
import { splitSections } from './sections.js'

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

  return { points, decisions }
}
