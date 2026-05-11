import { describe, expect, it } from 'vitest'
import { validateNormalizedReview } from '../../src/lib/review-normalize-validation'

describe('validateNormalizedReview', () => {
  it('accepts normalized documents that produce review checkpoints', () => {
    const doc = [
      '## 目标',
      '',
      '- 明确 review 目录。',
      '',
      '## 范围',
      '',
      '包含:',
      '',
      '- Review 面板。',
      '',
      '## 方案',
      '',
      '### 预览确认',
      '',
      '- 规范化后先预览。',
      '',
      '## 验收',
      '',
      '### 基础验收',
      '',
      '- 用户确认后才写回。',
    ].join('\n')

    expect(() => validateNormalizedReview(doc, doc)).not.toThrow()
  })

  it('rejects unknown review headings', () => {
    const normalized = ['## 风险', '', '- 不应生成旧目录。'].join('\n')
    expect(() => validateNormalizedReview(normalized, normalized)).toThrow('非标准目录')
  })

  it('rejects results without checkpoints', () => {
    const normalized = ['## 目标', '', '暂无'].join('\n')
    expect(() => validateNormalizedReview(normalized, normalized)).toThrow('为空')
  })
})
