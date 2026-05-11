import { inspectPlan } from './plan-inspector'

const ALLOWED_REVIEW_HEADINGS = new Set(['目标', '范围', '方案', '验收', '待确认'])
const EMPTY_SECTION_TEXT = /^(暂无|无|none|n\/a)$/i

export function validateNormalizedReview(original: string, normalized: string): void {
  const normalizedText = normalized.trim()
  if (!normalizedText) throw new Error('规范化结果为空')

  const compactOriginal = original.replace(/\s+/g, '')
  const compactNormalized = normalizedText.replace(/\s+/g, '')
  if (compactOriginal.length > 0 && compactNormalized.length < compactOriginal.length * 0.5) {
    throw new Error('规范化结果明显短于原文，请检查后重试')
  }

  const headingMatches = [...normalizedText.matchAll(/^##\s+(.+?)\s*$/gm)]
  if (headingMatches.length === 0) throw new Error('规范化结果没有生成 Review 目录')

  const unknownHeadings = headingMatches
    .map((match) => normalizeHeading(match[1] ?? ''))
    .filter((heading) => !ALLOWED_REVIEW_HEADINGS.has(heading))
  if (unknownHeadings.length > 0) {
    throw new Error(`规范化结果包含非标准目录：${unknownHeadings.join('、')}`)
  }

  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index]
    const title = normalizeHeading(match[1] ?? '')
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = headingMatches[index + 1]?.index ?? normalizedText.length
    const body = normalizedText.slice(bodyStart, bodyEnd).trim()
    if (ALLOWED_REVIEW_HEADINGS.has(title) && (!body || EMPTY_SECTION_TEXT.test(body))) {
      throw new Error(`规范化结果中的「${title}」为空`)
    }
  }

  const review = inspectPlan(normalizedText, [], 'auto')
  if (review.summary.total === 0) throw new Error('规范化结果没有生成可 review 的确认点')
}

function normalizeHeading(value: string): string {
  return value.replace(/[：:]\s*$/, '').trim()
}
