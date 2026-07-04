/**
 * H2 section splitting + classification into the 8 InfoKind roles.
 *
 * Migrated and widened from plan-inspector's splitH2Sections /
 * classifyReviewSection / normalizeHeading: the alias table now covers all 8
 * plan sections instead of the legacy 5. Unclassifiable H2 blocks are dropped
 * (a weakly-structured doc simply yields fewer sections — never a throw).
 */
import type { Nodes, Root } from 'mdast'
import type { InfoKind } from '../../types/domain.js'
import { textOf } from './text.js'

interface SectionAlias {
  kind: InfoKind
  aliases: string[]
}

const SECTION_ALIASES: SectionAlias[] = [
  { kind: 'goal', aliases: ['目标', 'goal'] },
  { kind: 'scope', aliases: ['边界', '范围', 'scope'] },
  { kind: 'decision', aliases: ['决策', 'decisions', 'decision'] },
  { kind: 'behavior', aliases: ['做法', '方案', 'approach', 'solution'] },
  { kind: 'verification', aliases: ['验收', 'acceptance'] },
  { kind: 'risk', aliases: ['风险', 'risks', 'risk'] },
  { kind: 'precondition', aliases: ['前置', 'preconditions', 'precondition'] },
  { kind: 'open-question', aliases: ['待确认', 'open questions', 'open-question'] },
]

/** One classified H2 section: its role, source order, heading text and body nodes. */
export interface SectionSource {
  kind: InfoKind
  heading: string
  order: number
  nodes: Nodes[]
}

/** Split the tree at H2 boundaries and keep only sections whose heading classifies. */
export function splitSections(tree: Root): SectionSource[] {
  const sections: SectionSource[] = []
  let order = 0

  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index]!
    if (node.type !== 'heading' || node.depth !== 2) continue

    const heading = textOf(node).trim()
    const kind = classifySection(heading)
    if (!kind) continue

    const nodes: Nodes[] = []
    for (let next = index + 1; next < tree.children.length; next += 1) {
      const child = tree.children[next]!
      if (child.type === 'heading' && child.depth <= 2) break
      nodes.push(child)
    }
    sections.push({ kind, heading, order, nodes })
    order += 1
  }

  return sections
}

/** Map a heading to an InfoKind via the alias table, or undefined when unknown. */
export function classifySection(heading: string): InfoKind | undefined {
  const normalized = normalizeHeading(heading)
  for (const section of SECTION_ALIASES) {
    if (section.aliases.some((alias) => normalizeHeading(alias) === normalized)) {
      return section.kind
    }
  }
  return undefined
}

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[\s#\d.、-]+/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}
